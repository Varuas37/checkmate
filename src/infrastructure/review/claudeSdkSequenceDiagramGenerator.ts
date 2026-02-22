import type {
  AiSequenceStep,
  AnalyseCommitInput,
  SequenceDiagramGenerator,
} from "../../domain/review/index.ts";
import { readApiKeyFromStorage } from "../../shared/index.ts";

interface ClaudeSdkClient {
  readonly messages: {
    create(input: {
      readonly model: string;
      readonly max_tokens: number;
      readonly system: string;
      readonly messages: readonly {
        readonly role: "user";
        readonly content: string;
      }[];
    }): Promise<unknown>;
  };
}

type ClaudeSdkClientFactory = (apiKey: string) => Promise<ClaudeSdkClient>;

const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_OUTPUT_TOKENS = 1200;
const DEFAULT_MAX_AUTO_ATTEMPTS = 2;
const MAX_FILES_IN_PROMPT = 20;
const MAX_HUNKS_IN_PROMPT = 8;
const MAX_LINES_PER_HUNK = 16;
const MAX_STEPS = 12;
const MERMAID_SEQUENCE_SYSTEM_PROMPT =
  "You are a specialized sub-agent that produces safe Mermaid sequence-step JSON for code-review visualizations. Return only valid JSON.";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function trimToNull(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveDefaultApiKey(): string | null {
  const nodeApiKey =
    typeof process !== "undefined" ? trimToNull(process.env.ANTHROPIC_API_KEY) : null;
  if (nodeApiKey) {
    return nodeApiKey;
  }

  const viteApiKey = trimToNull(
    (
      import.meta as ImportMeta & {
        readonly env?: Record<string, string | undefined>;
      }
    ).env?.VITE_ANTHROPIC_API_KEY,
  );

  return viteApiKey;
}

function normalizeWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function sanitizeLabel(value: string, fallback: string): string {
  const cleaned = normalizeWhitespace(value)
    .replaceAll(/["`\\<>[\]{}()]/g, " ")
    .replaceAll(/[^A-Za-z0-9 _./:-]/g, " ");
  const normalized = normalizeWhitespace(cleaned);
  return normalized.length > 0 ? normalized.slice(0, 28) : fallback;
}

function sanitizeMessage(value: string, fallback: string): string {
  const cleaned = normalizeWhitespace(value)
    .replaceAll(/["`\\<>[\]{}]/g, " ")
    .replaceAll(/[^A-Za-z0-9 _./:+\-(),]/g, " ");
  const normalized = normalizeWhitespace(cleaned);
  return normalized.length > 0 ? normalized.slice(0, 84) : fallback;
}

function truncateForPrompt(value: string, max = 900): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max)}...`;
}

function buildBasePrompt(input: AnalyseCommitInput): string {
  const { commit, files, hunks } = input;

  const fileListing = files
    .slice(0, MAX_FILES_IN_PROMPT)
    .map((file) => `- ${file.path} (${file.status} +${file.additions}/-${file.deletions})`)
    .join("\n");

  const prioritizedHunks = [...hunks]
    .sort((left, right) => {
      const leftChurn = left.lines.filter((line) => line.kind !== "context").length;
      const rightChurn = right.lines.filter((line) => line.kind !== "context").length;
      return rightChurn - leftChurn;
    })
    .slice(0, MAX_HUNKS_IN_PROMPT);

  const hunkPreview = prioritizedHunks
    .map((hunk) => {
      const filePath = files.find((file) => file.id === hunk.fileId)?.path ?? hunk.fileId;
      const lines = hunk.lines
        .slice(0, MAX_LINES_PER_HUNK)
        .map((line) => {
          const marker = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
          return `${marker}${line.text}`;
        })
        .join("\n");

      return `### ${filePath} ${hunk.header}\n${lines}`;
    })
    .join("\n\n");

  const schema = JSON.stringify(
    {
      sequenceSteps: [
        {
          sourceLabel: "Reviewer",
          targetLabel: "Infrastructure",
          message: "MODIFIED localGitAdapter.ts (+15/-2)",
          filePath: "src/infrastructure/review/localGitAdapter.ts",
        },
      ],
    },
    null,
    2,
  );

  const fewShotExample = JSON.stringify(
    {
      sequenceSteps: [
        {
          sourceLabel: "UI",
          targetLabel: "ReviewStore",
          message: "DISPATCH analyseCommitRequested",
          filePath: "src/app/store/review/reviewListeners.ts",
        },
        {
          sourceLabel: "ReviewStore",
          targetLabel: "CommitAnalyser",
          message: "ANALYSE commit diff context",
          filePath: "src/infrastructure/review/claudeSdkCommitAnalyser.ts",
        },
        {
          sourceLabel: "CommitAnalyser",
          targetLabel: "OverviewPanel",
          message: "RETURN sequence-ready insights",
          filePath: "src/interface/review/components/OverviewPanel.tsx",
        },
      ],
    },
    null,
    2,
  );

  return [
    `Commit: ${commit.title}`,
    `Author: ${commit.authorName} <${commit.authorEmail}>`,
    commit.description.trim().length > 0 ? `Description: ${commit.description}` : null,
    "",
    `Changed files (${files.length} total, showing up to ${MAX_FILES_IN_PROMPT}):`,
    fileListing,
    "",
    "High-signal diff hunks:",
    hunkPreview,
    "",
    "Task:",
    "Generate sequence steps that can be transformed directly into Mermaid sequenceDiagram arrows.",
    "",
    "Strict output requirements:",
    "- Return ONLY JSON. No markdown fences, no commentary.",
    "- JSON shape must be exactly:",
    schema,
    "- sequenceSteps count: 1-12.",
    "- sourceLabel and targetLabel: concise component names (max 28 chars).",
    "- message: concise action text (max 84 chars), plain punctuation only.",
    "- filePath MUST exactly match one changed file path listed above.",
    "- Prefer end-to-end causal flow over arbitrary file order.",
    "",
    "Example valid output:",
    fewShotExample,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function buildRetryPrompt(basePrompt: string, previousResponse: string, reason: string): string {
  return [
    basePrompt,
    "",
    "Retry instruction:",
    "- The previous response was invalid.",
    `- Reason: ${reason}`,
    "- Fix and return JSON only using the required schema.",
    "- Keep each field short and safe for Mermaid text.",
    "",
    "Previous invalid response:",
    truncateForPrompt(previousResponse),
  ].join("\n");
}

function extractTextFromResponse(response: unknown): string {
  if (!response || typeof response !== "object") {
    return "";
  }

  const content = (response as { readonly content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }
      if (!block || typeof block !== "object") {
        return "";
      }
      const text = (block as { readonly text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .filter((fragment) => fragment.trim().length > 0)
    .join("\n")
    .trim();
}

function parseSequenceResponse(
  raw: string,
  allowedFilePaths: ReadonlySet<string>,
): readonly AiSequenceStep[] | null {
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    const parsed: unknown = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const sequenceStepsRaw = Array.isArray((parsed as Record<string, unknown>)["sequenceSteps"])
      ? ((parsed as Record<string, unknown>)["sequenceSteps"] as unknown[])
      : null;

    if (!sequenceStepsRaw) {
      return null;
    }

    const steps: AiSequenceStep[] = [];

    for (const item of sequenceStepsRaw) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const sourceLabelRaw = (item as Record<string, unknown>)["sourceLabel"];
      const targetLabelRaw = (item as Record<string, unknown>)["targetLabel"];
      const messageRaw = (item as Record<string, unknown>)["message"];
      const filePathRaw = (item as Record<string, unknown>)["filePath"];

      if (
        typeof sourceLabelRaw !== "string" ||
        typeof targetLabelRaw !== "string" ||
        typeof messageRaw !== "string" ||
        typeof filePathRaw !== "string"
      ) {
        continue;
      }

      const filePath = filePathRaw.trim();
      if (!allowedFilePaths.has(filePath)) {
        continue;
      }

      const sourceLabel = sanitizeLabel(sourceLabelRaw, "Component");
      const targetLabel = sanitizeLabel(targetLabelRaw, "Component");
      const message = sanitizeMessage(messageRaw, `CHANGED ${filePath.split("/").at(-1) ?? filePath}`);

      steps.push({
        sourceLabel,
        targetLabel,
        message,
        filePath,
      });
    }

    if (steps.length === 0) {
      return null;
    }

    const uniqueByKey = new Map<string, AiSequenceStep>();
    for (const step of steps) {
      const key = `${step.sourceLabel}|${step.targetLabel}|${step.message}|${step.filePath}`;
      if (!uniqueByKey.has(key)) {
        uniqueByKey.set(key, step);
      }
    }

    return [...uniqueByKey.values()].slice(0, MAX_STEPS);
  } catch {
    return null;
  }
}

function isMissingClaudeSdkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("@anthropic-ai/sdk") || message.includes("anthropic constructor");
}

async function createClaudeSdkClient(apiKey: string): Promise<ClaudeSdkClient> {
  let sdkModule: unknown;

  try {
    sdkModule = await import("@anthropic-ai/sdk");
  } catch {
    throw new Error('Claude SDK package "@anthropic-ai/sdk" is not installed.');
  }

  const candidate =
    (sdkModule as { readonly default?: unknown }).default ??
    (sdkModule as { readonly Anthropic?: unknown }).Anthropic;

  if (typeof candidate !== "function") {
    throw new Error('Unable to resolve Anthropic constructor from "@anthropic-ai/sdk".');
  }

  const ClientConstructor = candidate as new (options: {
    readonly apiKey: string;
    readonly dangerouslyAllowBrowser?: boolean;
  }) => ClaudeSdkClient;

  const client = new ClientConstructor({
    apiKey,
    dangerouslyAllowBrowser: true,
  });

  if (!client.messages || typeof client.messages.create !== "function") {
    throw new Error("Claude SDK client is missing messages.create().");
  }

  return client;
}

async function runClaudePromptViaTauri(prompt: string): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error("Claude CLI fallback is available only in Tauri runtime.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("run_claude_prompt", { prompt });
}

export interface ClaudeSdkSequenceDiagramGeneratorOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly maxOutputTokens?: number;
  readonly maxAutoAttempts?: number;
  readonly createClient?: ClaudeSdkClientFactory;
}

export class ClaudeSdkSequenceDiagramGenerator implements SequenceDiagramGenerator {
  readonly #apiKeyOverride: string | null;
  readonly #model: string;
  readonly #maxOutputTokens: number;
  readonly #maxAutoAttempts: number;
  readonly #createClient: ClaudeSdkClientFactory;

  constructor(options: ClaudeSdkSequenceDiagramGeneratorOptions = {}) {
    this.#apiKeyOverride = trimToNull(options.apiKey);
    this.#model = trimToNull(options.model) ?? DEFAULT_CLAUDE_MODEL;
    this.#maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.#maxAutoAttempts = Math.max(1, options.maxAutoAttempts ?? DEFAULT_MAX_AUTO_ATTEMPTS);
    this.#createClient = options.createClient ?? createClaudeSdkClient;
  }

  #resolveApiKey(): string | null {
    return this.#apiKeyOverride ?? readApiKeyFromStorage() ?? resolveDefaultApiKey();
  }

  async #runPrompt(prompt: string, apiKey: string | null): Promise<string> {
    if (!apiKey) {
      return runClaudePromptViaTauri(prompt);
    }

    try {
      const client = await this.#createClient(apiKey);
      const response = await client.messages.create({
        model: this.#model,
        max_tokens: this.#maxOutputTokens,
        system: MERMAID_SEQUENCE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      });

      return extractTextFromResponse(response);
    } catch (error) {
      if (!isTauriRuntime() || !isMissingClaudeSdkError(error)) {
        throw error;
      }

      return runClaudePromptViaTauri(prompt);
    }
  }

  async generateSequenceSteps(input: AnalyseCommitInput): Promise<readonly AiSequenceStep[]> {
    if (input.files.length === 0) {
      return [];
    }

    const allowedFilePaths = new Set(input.files.map((file) => file.path));
    const resolvedApiKey = this.#resolveApiKey();
    const basePrompt = buildBasePrompt(input);
    const attemptMessages: string[] = [];
    let nextPrompt = basePrompt;
    let previousResponse = "";

    for (let attempt = 1; attempt <= this.#maxAutoAttempts; attempt += 1) {
      try {
        const raw = await this.#runPrompt(nextPrompt, resolvedApiKey);
        previousResponse = raw;
        const parsed = parseSequenceResponse(raw, allowedFilePaths);

        if (parsed && parsed.length > 0) {
          return parsed;
        }

        const parseReason = "Response was not valid sequenceSteps JSON or contained disallowed file paths.";
        attemptMessages.push(`attempt ${attempt}: ${parseReason}`);
        nextPrompt = buildRetryPrompt(basePrompt, raw, parseReason);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown sequence generation error.";
        attemptMessages.push(`attempt ${attempt}: ${message}`);
        nextPrompt = buildRetryPrompt(basePrompt, previousResponse, message);
      }
    }

    const details = attemptMessages.length > 0 ? ` ${attemptMessages.join(" | ")}` : "";
    throw new Error(
      `Failed to generate a Mermaid-safe sequence after ${this.#maxAutoAttempts} attempts.${details}`,
    );
  }
}

export function createClaudeSdkSequenceDiagramGenerator(
  options: ClaudeSdkSequenceDiagramGeneratorOptions = {},
): SequenceDiagramGenerator {
  return new ClaudeSdkSequenceDiagramGenerator(options);
}
