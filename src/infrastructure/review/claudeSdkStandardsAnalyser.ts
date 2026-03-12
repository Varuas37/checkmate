import type {
  AnalyseStandardsInput,
  StandardsAnalyser,
  StandardsEvaluationOutput,
  StandardsResult,
} from "../../domain/review/index.ts";
import { readApiKeyFromStorage } from "../../shared/index.ts";
import {
  canUseApiProvider,
  resolveAiProviderState,
  resolveSecondaryProvider,
  runPreferredLocalAgentPrompt,
  shouldPreferLocalAgent,
} from "./providerRouting.ts";
import { parseStandardsRulesFromText } from "./standardsRuleTextEvaluator.ts";

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
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_SYSTEM_PROMPT =
  "You are a senior code reviewer. Return only valid JSON that matches the requested schema.";
const MAX_FILES_IN_PROMPT = 40;
const MAX_HUNKS_IN_PROMPT = 16;
const MAX_LINES_PER_HUNK = 20;

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

  return trimToNull(
    (
      import.meta as ImportMeta & {
        readonly env?: Record<string, string | undefined>;
      }
    ).env?.VITE_ANTHROPIC_API_KEY,
  );
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

function isMissingClaudeSdkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("@anthropic-ai/sdk") || message.includes("anthropic constructor");
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

function stripJsonFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

function buildPrompt(input: AnalyseStandardsInput): string {
  const rules = parseStandardsRulesFromText(input.ruleText);
  const filesById = new Map(input.files.map((file) => [file.id, file] as const));

  const filesSection = input.files
    .slice(0, MAX_FILES_IN_PROMPT)
    .map((file) => `- ${file.path} (${file.status}) +${file.additions}/-${file.deletions}`)
    .join("\n");

  const hunksSection = input.hunks
    .slice(0, MAX_HUNKS_IN_PROMPT)
    .map((hunk) => {
      const filePath = filesById.get(hunk.fileId)?.path ?? hunk.fileId;
      const lines = hunk.lines
        .slice(0, MAX_LINES_PER_HUNK)
        .map((line) => {
          const prefix = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
          return `${prefix}${line.text}`;
        })
        .join("\n");

      return `### ${filePath}\n${hunk.header}\n${lines}`;
    })
    .join("\n\n");

  const rulesSection = rules
    .map(
      (rule) =>
        `- ${rule.id} | severity=${rule.severity} | title=${rule.title} | description=${rule.description}`,
    )
    .join("\n");

  const schema = JSON.stringify(
    {
      results: [
        {
          ruleId: "rule-1",
          status: "pass|warn|fail",
          summary: "one short paragraph",
          evidence: [
            {
              filePath: "src/example.ts",
              lineNumber: 42,
              note: "What in the diff supports this conclusion",
            },
          ],
        },
      ],
    },
    null,
    2,
  );

  return [
    `Commit: ${input.commit.title}`,
    `Author: ${input.commit.authorName} <${input.commit.authorEmail}>`,
    `Standards source path: ${input.standardsSourcePath}`,
    input.commit.description.trim().length > 0 ? `Description: ${input.commit.description}` : null,
    "",
    "Standards rules:",
    rulesSection,
    "",
    "Changed files:",
    filesSection,
    "",
    "Representative diff hunks:",
    hunksSection,
    "",
    "Return ONLY JSON matching this schema (no markdown, no additional text):",
    schema,
    "",
    "Requirements:",
    "- Return exactly one result per ruleId listed above.",
    "- status must be one of: pass, warn, fail.",
    "- summary must be concrete and diff-aware.",
    "- evidence entries should cite changed filePath and specific rationale.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function parseAnalysis(
  raw: string,
  input: AnalyseStandardsInput,
): StandardsEvaluationOutput | null {
  const rules = parseStandardsRulesFromText(input.ruleText);
  if (rules.length === 0) {
    return {
      rules: [],
      results: [],
    };
  }

  try {
    const parsed: unknown = JSON.parse(stripJsonFences(raw));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const resultsRaw = (parsed as { readonly results?: unknown }).results;
    if (!Array.isArray(resultsRaw)) {
      return null;
    }

    const validStatuses = new Set(["pass", "warn", "fail"]);
    const resultByRuleId = new Map<
      string,
      {
        status: "pass" | "warn" | "fail";
        summary: string;
        evidence: StandardsResult["evidence"];
      }
    >();

    resultsRaw.forEach((item) => {
      if (!item || typeof item !== "object") {
        return;
      }

      const obj = item as Record<string, unknown>;
      const ruleId = typeof obj["ruleId"] === "string" ? obj["ruleId"].trim() : "";
      const status = typeof obj["status"] === "string" ? obj["status"].trim().toLowerCase() : "";
      const summary = typeof obj["summary"] === "string" ? obj["summary"].trim() : "";

      if (!ruleId || !validStatuses.has(status) || summary.length === 0) {
        return;
      }

      const evidenceRaw = Array.isArray(obj["evidence"]) ? (obj["evidence"] as unknown[]) : [];
      const evidence = evidenceRaw
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }

          const evidenceObj = entry as Record<string, unknown>;
          const note = typeof evidenceObj["note"] === "string" ? evidenceObj["note"].trim() : "";
          if (note.length === 0) {
            return null;
          }

          const filePath =
            typeof evidenceObj["filePath"] === "string"
              ? evidenceObj["filePath"].trim()
              : undefined;
          const lineNumber =
            typeof evidenceObj["lineNumber"] === "number" &&
            Number.isFinite(evidenceObj["lineNumber"]) &&
            evidenceObj["lineNumber"] > 0
              ? Math.floor(evidenceObj["lineNumber"])
              : undefined;

          return {
            ...(filePath && filePath.length > 0 ? { filePath } : {}),
            ...(lineNumber !== undefined ? { lineNumber } : {}),
            note,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      resultByRuleId.set(ruleId, {
        status: status as "pass" | "warn" | "fail",
        summary,
        evidence,
      });
    });

    const results: StandardsResult[] = rules.map((rule) => {
      const resolved = resultByRuleId.get(rule.id);
      if (!resolved) {
        return {
          id: `result-${input.commitId}-${rule.id}`,
          commitId: input.commitId,
          ruleId: rule.id,
          status: "warn",
          summary: `No AI assessment returned for "${rule.title}".`,
          evidence: [],
        };
      }

      return {
        id: `result-${input.commitId}-${rule.id}`,
        commitId: input.commitId,
        ruleId: rule.id,
        status: resolved.status,
        summary: resolved.summary,
        evidence: resolved.evidence,
      };
    });

    return {
      rules,
      results,
    };
  } catch {
    return null;
  }
}

export interface ClaudeSdkStandardsAnalyserOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly maxOutputTokens?: number;
  readonly createClient?: ClaudeSdkClientFactory;
}

export class ClaudeSdkStandardsAnalyser implements StandardsAnalyser {
  readonly #apiKeyOverride: string | null;
  readonly #model: string;
  readonly #maxOutputTokens: number;
  readonly #createClient: ClaudeSdkClientFactory;

  constructor(options: ClaudeSdkStandardsAnalyserOptions = {}) {
    this.#apiKeyOverride = trimToNull(options.apiKey);
    this.#model = trimToNull(options.model) ?? DEFAULT_CLAUDE_MODEL;
    this.#maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.#createClient = options.createClient ?? createClaudeSdkClient;
  }

  #resolveApiKey(): string | null {
    return this.#apiKeyOverride ?? readApiKeyFromStorage() ?? resolveDefaultApiKey();
  }

  async analyseStandards(input: AnalyseStandardsInput): Promise<StandardsEvaluationOutput> {
    const prompt = buildPrompt(input);
    const resolvedApiKey = this.#resolveApiKey();
    const providerState = resolveAiProviderState(resolvedApiKey);
    const secondaryProvider = resolveSecondaryProvider(providerState);

    if (shouldPreferLocalAgent(providerState)) {
      try {
        const localResponse = await runPreferredLocalAgentPrompt(
          prompt,
          input.commit.repositoryPath,
          providerState,
        );
        const parsed = parseAnalysis(localResponse, input);
        if (!parsed) {
          throw new Error("Local-agent standards response was not valid JSON.");
        }
        return parsed;
      } catch (error) {
        if (secondaryProvider !== "api" || !canUseApiProvider(providerState)) {
          throw error;
        }
      }
    }

    if (!canUseApiProvider(providerState)) {
      const localResponse = await runPreferredLocalAgentPrompt(
        prompt,
        input.commit.repositoryPath,
        providerState,
      );
      const parsed = parseAnalysis(localResponse, input);
      if (!parsed) {
        throw new Error("Local-agent standards response was not valid JSON.");
      }
      return parsed;
    }

    try {
      const client = await this.#createClient(providerState.apiKey as string);
      const response = await client.messages.create({
        model: this.#model,
        max_tokens: this.#maxOutputTokens,
        system: DEFAULT_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      });

      const parsed = parseAnalysis(extractTextFromResponse(response), input);
      if (!parsed) {
        throw new Error("Claude standards response did not match the expected schema.");
      }

      return parsed;
    } catch (error) {
      if (secondaryProvider !== "local-agent" || !isMissingClaudeSdkError(error)) {
        throw error;
      }

      const localResponse = await runPreferredLocalAgentPrompt(
        prompt,
        input.commit.repositoryPath,
        providerState,
      );
      const parsed = parseAnalysis(localResponse, input);
      if (!parsed) {
        throw new Error("Local-agent standards response was not valid JSON.");
      }
      return parsed;
    }
  }
}

export function createClaudeSdkStandardsAnalyser(
  options: ClaudeSdkStandardsAnalyserOptions = {},
): StandardsAnalyser {
  return new ClaudeSdkStandardsAnalyser(options);
}
