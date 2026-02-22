import type {
  AiFileSummary,
  AiFlowComparison,
  AiOverviewCard,
  AiSequenceStep,
  AnalyseCommitInput,
  AnalyseCommitOutput,
  CommitAnalyser,
} from "../../domain/review/index.ts";
import type { ReviewCardKind } from "../../domain/review/index.ts";
import {
  readActiveCliAgentFromStorage,
  readAiAnalysisConfigFromStorage,
  readApiKeyFromStorage,
  readCliPreferenceFromStorage,
} from "../../shared/index.ts";

// ---------------------------------------------------------------------------
// SDK client interface + factory
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Domain-adjacent local types (derived from the port, avoids extra imports)
// ---------------------------------------------------------------------------

type CommitEntity = AnalyseCommitInput["commit"];
type ChangedFile = AnalyseCommitInput["files"][number];
type DiffHunk = AnalyseCommitInput["hunks"][number];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5-20251001";

/** Max tokens for a single per-file summary call. One JSON object fits easily. */
const PER_FILE_MAX_OUTPUT_TOKENS = 512;

/** Max tokens for the final overview call (overviewCards + flowComparisons). */
const OVERVIEW_MAX_OUTPUT_TOKENS = 2048;

/**
 * Max tokens for the legacy single-call prompt used by the Tauri CLI fallback.
 * Kept high to handle larger commits via the CLI path.
 */
const FALLBACK_MAX_OUTPUT_TOKENS = 4096;

const DEFAULT_SYSTEM_PROMPT =
  "You are a senior software engineer performing a code review. Return only valid JSON matching the requested schema. No markdown fences, no extra text.";

/** Max hunks to include per individual file call. */
const MAX_HUNKS_PER_FILE = 5;
/** Max hunks included in the legacy single-call prompt. */
const MAX_HUNKS_IN_PROMPT = 10;
/** Max source lines shown per hunk across all prompt types. */
const MAX_LINES_PER_HUNK = 25;
/** Max files in the legacy single-call prompt. */
const MAX_FILES_IN_PROMPT = 20;

// ---------------------------------------------------------------------------
// File exclusion — pattern-based + churn threshold
// ---------------------------------------------------------------------------

/**
 * Patterns that are always excluded regardless of churn threshold.
 * Lock files and generated artefacts carry no useful semantic signal for AI review.
 */
const ALWAYS_EXCLUDE_PATTERNS: readonly RegExp[] = [
  // Dependency lock files
  /(?:^|\/)package-lock\.json$/,
  /(?:^|\/)yarn\.lock$/,
  /(?:^|\/)pnpm-lock\.yaml$/,
  /(?:^|\/)Cargo\.lock$/,
  /(?:^|\/)Gemfile\.lock$/,
  /(?:^|\/)composer\.lock$/,
  /(?:^|\/)poetry\.lock$/,
  /(?:^|\/)uv\.lock$/,
  /\.lock$/,
  // Vendor / generated directories
  /(?:^|\/)node_modules\//,
  /(?:^|\/)\.git\//,
  // Minified and source-map artefacts
  /\.min\.[cm]?[jt]s$/,
  /\.min\.css$/,
  /\.map$/,
  // Binary assets (images, fonts, archives)
  /\.(png|jpe?g|gif|webp|bmp|ico|svg|tiff?)$/i,
  /\.(woff2?|ttf|eot|otf)$/i,
  /\.(pdf|zip|tar|gz|bz2|7z|rar|xz)$/i,
];

function isExcludedByPattern(filePath: string): boolean {
  return ALWAYS_EXCLUDE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function isExcludedByChurn(
  additions: number,
  deletions: number,
  maxChurnThreshold: number,
): boolean {
  if (maxChurnThreshold === 0) return false;
  return additions + deletions > maxChurnThreshold;
}

function skippedFileSummary(
  file: ChangedFile,
  reason: "pattern" | "churn",
  maxChurnThreshold: number,
): AiFileSummary {
  const body =
    reason === "pattern"
      ? "Auto-excluded: lock file or generated artefact — no AI analysis needed."
      : `Auto-excluded: ${file.additions + file.deletions} lines changed exceeds the ${maxChurnThreshold}-line threshold. Review this file manually in the diff viewer.`;
  return { filePath: file.path, summary: body, riskNote: "Skipped." };
}

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("Commit analysis cancelled.");
    error.name = "AbortError";
    throw error;
  }
}

async function yieldToUiThread(): Promise<void> {
  if (typeof globalThis.requestAnimationFrame === "function") {
    await new Promise<void>((resolve) => {
      globalThis.requestAnimationFrame(() => resolve());
    });
    return;
  }

  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

function resolveDefaultApiKey(): string | null {
  const nodeApiKey =
    typeof process !== "undefined"
      ? trimToNull(process.env.ANTHROPIC_API_KEY)
      : null;
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
    throw new Error(
      'Unable to resolve Anthropic constructor from "@anthropic-ai/sdk".',
    );
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
  return (
    message.includes("@anthropic-ai/sdk") ||
    message.includes("anthropic constructor")
  );
}

async function runClaudePromptViaTauri(prompt: string): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error("Claude CLI fallback is available only in Tauri runtime.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("run_claude_prompt", { prompt });
}

async function runCliAgentPromptViaTauri(
  command: string,
  args: readonly string[],
  prompt: string,
): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error("CLI agent is available only in Tauri runtime.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("run_cli_agent_prompt", {
    command,
    args: [...args],
    prompt,
  });
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
      if (typeof block === "string") return block;
      if (!block || typeof block !== "object") return "";
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

// ---------------------------------------------------------------------------
// Phase 1 — per-file prompt + parser
// ---------------------------------------------------------------------------

function buildFilePrompt(
  commit: CommitEntity,
  file: ChangedFile,
  fileHunks: readonly DiffHunk[],
): string {
  const hunkText = fileHunks
    .slice(0, MAX_HUNKS_PER_FILE)
    .map((hunk) => {
      const lines = hunk.lines
        .slice(0, MAX_LINES_PER_HUNK)
        .map((l) => {
          const prefix =
            l.kind === "add" ? "+" : l.kind === "remove" ? "-" : " ";
          return `${prefix}${l.text}`;
        })
        .join("\n");
      return `${hunk.header}\n${lines}`;
    })
    .join("\n\n");

  const schema = JSON.stringify(
    { filePath: "...", summary: "...", riskNote: "..." },
    null,
    2,
  );

  return [
    `Commit: ${commit.title}`,
    `Author: ${commit.authorName} <${commit.authorEmail}>`,
    "",
    `File: ${file.path} (${file.status})  +${file.additions}/-${file.deletions}`,
    fileHunks.length > 0 ? "\nKey diff hunks:" : null,
    fileHunks.length > 0 ? hunkText : null,
    "",
    "Return ONLY valid JSON matching this schema (no markdown, no extra text):",
    schema,
    "",
    "Rules:",
    "- filePath must be exactly the file path listed above.",
    "- summary: 1-2 sentences describing what changed and why.",
    '- riskNote: 1 sentence on the main risk, or "Low risk." if none.',
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function parseFileSummaryResponse(
  raw: string,
  expectedPath: string,
): AiFileSummary | null {
  try {
    const parsed: unknown = JSON.parse(stripJsonFences(raw));
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj["summary"] !== "string" ||
      typeof obj["riskNote"] !== "string"
    )
      return null;
    return {
      filePath:
        typeof obj["filePath"] === "string" ? obj["filePath"] : expectedPath,
      summary: obj["summary"],
      riskNote: obj["riskNote"],
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — overview prompt + parser
// ---------------------------------------------------------------------------

function buildOverviewPrompt(
  commit: CommitEntity,
  fileSummaries: readonly AiFileSummary[],
): string {
  const summaryLines = fileSummaries
    .map((s) => {
      const riskSuffix =
        s.riskNote && s.riskNote.trim().toLowerCase() !== "low risk."
          ? `  Risk: ${s.riskNote}`
          : "";
      return `  ${s.filePath}: ${s.summary}${riskSuffix}`;
    })
    .join("\n");

  const schema = JSON.stringify(
    {
      overviewCards: [
        { kind: "summary|impact|risk|question", title: "...", body: "..." },
      ],
      flowComparisons: [
        {
          beforeTitle: "...",
          beforeBody: "...",
          afterTitle: "...",
          afterBody: "...",
          filePaths: ["..."],
        },
      ],
    },
    null,
    2,
  );

  return [
    `Commit: ${commit.title}`,
    `Author: ${commit.authorName} <${commit.authorEmail}>`,
    commit.description.trim().length > 0
      ? `Description: ${commit.description}`
      : null,
    "",
    `Changed files (${fileSummaries.length} total):`,
    summaryLines,
    "",
    "Return ONLY valid JSON matching this schema (no markdown, no extra text):",
    schema,
    "",
    "Rules:",
    "- overviewCards: 2-4 cards covering summary, impact, risk, and open questions.",
    "- flowComparisons: 2-6 before/after pairs describing architectural/logical flow changes for this commit.",
    "- filePaths values in flowComparisons must exactly match the listed file paths.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

const VALID_CARD_KINDS = new Set<string>([
  "summary",
  "impact",
  "risk",
  "question",
]);

function parseOverviewResponse(raw: string): {
  readonly overviewCards: readonly AiOverviewCard[];
  readonly flowComparisons: readonly AiFlowComparison[];
} {
  const empty = { overviewCards: [], flowComparisons: [] };

  try {
    const parsed: unknown = JSON.parse(stripJsonFences(raw));
    if (!parsed || typeof parsed !== "object") return empty;
    const obj = parsed as Record<string, unknown>;

    const overviewCards: AiOverviewCard[] = Array.isArray(obj["overviewCards"])
      ? (obj["overviewCards"] as unknown[])
          .filter(
            (item): item is { kind: string; title: string; body: string } =>
              !!item &&
              typeof item === "object" &&
              typeof (item as Record<string, unknown>)["kind"] === "string" &&
              VALID_CARD_KINDS.has(
                (item as Record<string, unknown>)["kind"] as string,
              ) &&
              typeof (item as Record<string, unknown>)["title"] === "string" &&
              typeof (item as Record<string, unknown>)["body"] === "string",
          )
          .map(
            (item): AiOverviewCard => ({
              kind: item.kind as ReviewCardKind,
              title: item.title,
              body: item.body,
            }),
          )
      : [];

    const flowComparisons: AiFlowComparison[] = Array.isArray(
      obj["flowComparisons"],
    )
      ? (obj["flowComparisons"] as unknown[])
          .filter(
            (
              item,
            ): item is {
              beforeTitle: string;
              beforeBody: string;
              afterTitle: string;
              afterBody: string;
              filePaths: string[];
            } =>
              !!item &&
              typeof item === "object" &&
              typeof (item as Record<string, unknown>)["beforeTitle"] ===
                "string" &&
              typeof (item as Record<string, unknown>)["beforeBody"] ===
                "string" &&
              typeof (item as Record<string, unknown>)["afterTitle"] ===
                "string" &&
              typeof (item as Record<string, unknown>)["afterBody"] ===
                "string" &&
              Array.isArray((item as Record<string, unknown>)["filePaths"]) &&
              (
                (item as Record<string, unknown>)["filePaths"] as unknown[]
              ).every((p) => typeof p === "string"),
          )
          .map(
            (item): AiFlowComparison => ({
              beforeTitle: item.beforeTitle,
              beforeBody: item.beforeBody,
              afterTitle: item.afterTitle,
              afterBody: item.afterBody,
              filePaths: item.filePaths,
            }),
          )
      : [];

    return { overviewCards, flowComparisons };
  } catch {
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Legacy single-call path (used for the Tauri CLI fallback only)
// ---------------------------------------------------------------------------

function buildLegacyPrompt(input: AnalyseCommitInput): string {
  const { commit, files, hunks } = input;

  const fileListing = files
    .slice(0, MAX_FILES_IN_PROMPT)
    .map(
      (f) =>
        `  ${f.status.padEnd(8)} ${f.path}  +${f.additions}/-${f.deletions}`,
    )
    .join("\n");

  const sortedHunks = [...hunks]
    .sort((a, b) => {
      const aChurn = a.lines.filter((l) => l.kind !== "context").length;
      const bChurn = b.lines.filter((l) => l.kind !== "context").length;
      return bChurn - aChurn;
    })
    .slice(0, MAX_HUNKS_IN_PROMPT);

  const hunkText = sortedHunks
    .map((hunk) => {
      const file = files.find((f) => f.id === hunk.fileId);
      const filePath = file?.path ?? hunk.fileId;
      const lines = hunk.lines
        .slice(0, MAX_LINES_PER_HUNK)
        .map((l) => {
          const prefix =
            l.kind === "add" ? "+" : l.kind === "remove" ? "-" : " ";
          return `${prefix}${l.text}`;
        })
        .join("\n");
      return `### ${filePath} ${hunk.header}\n${lines}`;
    })
    .join("\n\n");

  const schema = JSON.stringify(
    {
      overviewCards: [
        { kind: "summary|impact|risk|question", title: "...", body: "..." },
      ],
      flowComparisons: [
        {
          beforeTitle: "...",
          beforeBody: "...",
          afterTitle: "...",
          afterBody: "...",
          filePaths: ["..."],
        },
      ],
      fileSummaries: [{ filePath: "...", summary: "...", riskNote: "..." }],
    },
    null,
    2,
  );

  return [
    `Commit: ${commit.title}`,
    `Author: ${commit.authorName} <${commit.authorEmail}>`,
    commit.description.trim().length > 0
      ? `Description: ${commit.description}`
      : null,
    "",
    `Changed files (${files.length} total, showing up to ${MAX_FILES_IN_PROMPT}):`,
    fileListing,
    "",
    "Key diff hunks:",
    hunkText,
    "",
    "Return ONLY valid JSON matching this schema (no markdown, no extra text):",
    schema,
    "",
    "Rules:",
    "- overviewCards: 2-4 cards covering summary, impact, risk, and open questions.",
    "- flowComparisons: 2-6 before/after pairs describing architectural/logical flow changes.",
    "- fileSummaries: one entry per changed file with a concise summary and risk note.",
    "- All filePath values must exactly match one of the listed changed file paths.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function parseLegacyResponse(
  raw: string,
  commitId: string,
): AnalyseCommitOutput | null {
  try {
    const parsed: unknown = JSON.parse(stripJsonFences(raw));
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;

    const { overviewCards, flowComparisons } = parseOverviewResponse(raw);

    const sequenceSteps: AiSequenceStep[] = Array.isArray(obj["sequenceSteps"])
      ? (obj["sequenceSteps"] as unknown[])
          .filter(
            (
              item,
            ): item is {
              sourceLabel: string;
              targetLabel: string;
              message: string;
              filePath: string;
            } =>
              !!item &&
              typeof item === "object" &&
              typeof (item as Record<string, unknown>)["sourceLabel"] ===
                "string" &&
              typeof (item as Record<string, unknown>)["targetLabel"] ===
                "string" &&
              typeof (item as Record<string, unknown>)["message"] ===
                "string" &&
              typeof (item as Record<string, unknown>)["filePath"] === "string",
          )
          .map(
            (item): AiSequenceStep => ({
              ...(typeof (item as Record<string, unknown>)["token"] === "string"
                ? {
                    token: (item as Record<string, unknown>)["token"] as string,
                  }
                : {}),
              ...(typeof (item as Record<string, unknown>)["sourceId"] ===
              "string"
                ? {
                    sourceId: (item as Record<string, unknown>)[
                      "sourceId"
                    ] as string,
                  }
                : {}),
              sourceLabel: item.sourceLabel,
              ...(typeof (item as Record<string, unknown>)["targetId"] ===
              "string"
                ? {
                    targetId: (item as Record<string, unknown>)[
                      "targetId"
                    ] as string,
                  }
                : {}),
              targetLabel: item.targetLabel,
              message: item.message,
              filePath: item.filePath,
            }),
          )
      : [];

    const fileSummaries: AiFileSummary[] = Array.isArray(obj["fileSummaries"])
      ? (obj["fileSummaries"] as unknown[])
          .filter(
            (
              item,
            ): item is {
              filePath: string;
              summary: string;
              riskNote: string;
            } =>
              !!item &&
              typeof item === "object" &&
              typeof (item as Record<string, unknown>)["filePath"] ===
                "string" &&
              typeof (item as Record<string, unknown>)["summary"] ===
                "string" &&
              typeof (item as Record<string, unknown>)["riskNote"] === "string",
          )
          .map(
            (item): AiFileSummary => ({
              filePath: item.filePath,
              summary: item.summary,
              riskNote: item.riskNote,
            }),
          )
      : [];

    if (
      overviewCards.length === 0 &&
      flowComparisons.length === 0 &&
      sequenceSteps.length === 0 &&
      fileSummaries.length === 0
    ) {
      return null;
    }

    return {
      commitId,
      overviewCards,
      flowComparisons,
      sequenceSteps,
      fileSummaries,
      standardsRules: [],
      standardsResults: [],
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export interface ClaudeSdkCommitAnalyserOptions {
  readonly apiKey?: string;
  readonly model?: string;
}

export class ClaudeSdkCommitAnalyser implements CommitAnalyser {
  readonly #apiKeyOverride: string | null;
  readonly #model: string;
  readonly #createClient: ClaudeSdkClientFactory;

  constructor(options: ClaudeSdkCommitAnalyserOptions = {}) {
    this.#apiKeyOverride = trimToNull(options.apiKey);
    this.#model = trimToNull(options.model) ?? DEFAULT_CLAUDE_MODEL;
    this.#createClient = createClaudeSdkClient;
  }

  #resolveApiKey(): string | null {
    return (
      this.#apiKeyOverride ?? readApiKeyFromStorage() ?? resolveDefaultApiKey()
    );
  }

  /** Phase 1: summarise a single file. Never throws — returns a placeholder on failure. */
  async #analyseFileSdk(
    client: ClaudeSdkClient,
    commit: CommitEntity,
    file: ChangedFile,
    fileHunks: readonly DiffHunk[],
  ): Promise<AiFileSummary> {
    const prompt = buildFilePrompt(commit, file, fileHunks);
    const response = await client.messages.create({
      model: this.#model,
      max_tokens: PER_FILE_MAX_OUTPUT_TOKENS,
      system: DEFAULT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = extractTextFromResponse(response);
    return (
      parseFileSummaryResponse(raw, file.path) ?? {
        filePath: file.path,
        summary: `${file.status} — ${file.additions} additions, ${file.deletions} deletions.`,
        riskNote: "Summary unavailable.",
      }
    );
  }

  /** Phase 2: generate overviewCards + flowComparisons from collected file summaries. */
  async #generateOverviewSdk(
    client: ClaudeSdkClient,
    commit: CommitEntity,
    fileSummaries: readonly AiFileSummary[],
  ): Promise<{
    overviewCards: readonly AiOverviewCard[];
    flowComparisons: readonly AiFlowComparison[];
  }> {
    const prompt = buildOverviewPrompt(commit, fileSummaries);
    const response = await client.messages.create({
      model: this.#model,
      max_tokens: OVERVIEW_MAX_OUTPUT_TOKENS,
      system: DEFAULT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = extractTextFromResponse(response);
    return parseOverviewResponse(raw);
  }

  async analyseCommit(input: AnalyseCommitInput): Promise<AnalyseCommitOutput> {
    const resolvedApiKey = this.#resolveApiKey();
    const preferCli = readCliPreferenceFromStorage();
    const activeCliAgent = readActiveCliAgentFromStorage();

    /** Runs the configured CLI agent, with a Claude CLI fallback if the active agent fails. */
    const runViaCli = async (prompt: string): Promise<string> => {
      if (activeCliAgent && isTauriRuntime()) {
        try {
          return await runCliAgentPromptViaTauri(
            activeCliAgent.command,
            activeCliAgent.promptArgs,
            prompt,
          );
        } catch (activeCliError) {
          const normalizedCommand = activeCliAgent.command.trim().toLowerCase();
          if (normalizedCommand === "claude") {
            throw activeCliError;
          }

          try {
            return await runClaudePromptViaTauri(prompt);
          } catch (claudeFallbackError) {
            const activeMessage =
              activeCliError instanceof Error
                ? activeCliError.message
                : "CLI execution failed.";
            const claudeMessage =
              claudeFallbackError instanceof Error
                ? claudeFallbackError.message
                : "Claude fallback failed.";
            throw new Error(
              `Primary CLI agent "${activeCliAgent.name}" failed (${activeMessage}) and Claude CLI fallback failed (${claudeMessage}).`,
            );
          }
        }
      }

      return runClaudePromptViaTauri(prompt);
    };

    // -----------------------------------------------------------------------
    // Prefer CLI over API: try configured CLI first, fall back to SDK
    // -----------------------------------------------------------------------
    if (preferCli && activeCliAgent && isTauriRuntime()) {
      const legacyPrompt = buildLegacyPrompt(input);
      try {
        const cliResponse = await runViaCli(legacyPrompt);
        const parsed = parseLegacyResponse(cliResponse, input.commitId);
        if (parsed) {
          return parsed;
        }
        if (!resolvedApiKey) {
          throw new Error(
            "CLI response could not be parsed as valid analysis JSON.",
          );
        }
      } catch (error) {
        // CLI failed — fall through to SDK if key is available, else throw below.
        if (!resolvedApiKey) {
          const message =
            error instanceof Error ? error.message : "CLI execution failed.";
          throw new Error(
            `Primary CLI agent "${activeCliAgent.name}" failed and no API key is available for SDK fallback (${message}).`,
          );
        }
      }
    }

    // -----------------------------------------------------------------------
    // No API key → Tauri CLI fallback (single-call, legacy prompt)
    // -----------------------------------------------------------------------
    if (!resolvedApiKey) {
      const legacyPrompt = buildLegacyPrompt(input);
      try {
        const cliResponse = await runViaCli(legacyPrompt);
        const parsed = parseLegacyResponse(cliResponse, input.commitId);
        if (!parsed) {
          throw new Error(
            "CLI response could not be parsed as valid analysis JSON.",
          );
        }
        return parsed;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "CLI fallback failed.";
        throw new Error(
          `Commit analysis requires ANTHROPIC_API_KEY or a configured CLI agent (${message}).`,
        );
      }
    }

    // -----------------------------------------------------------------------
    // SDK path — one file at a time (keeps UI responsive) then overview call
    // -----------------------------------------------------------------------
    try {
      throwIfAborted(input.abortSignal);
      const client = await this.#createClient(resolvedApiKey);
      const { maxChurnThreshold } = readAiAnalysisConfigFromStorage();

      // Partition files: some are skipped (lock files, huge churn) and get
      // placeholder summaries without any API call.
      type FilePartition =
        | { readonly kind: "analyse"; readonly file: ChangedFile }
        | { readonly kind: "skip-pattern"; readonly file: ChangedFile }
        | { readonly kind: "skip-churn"; readonly file: ChangedFile };

      const partitioned: FilePartition[] = input.files.map((file) => {
        if (isExcludedByPattern(file.path))
          return { kind: "skip-pattern", file };
        if (
          isExcludedByChurn(file.additions, file.deletions, maxChurnThreshold)
        )
          return { kind: "skip-churn", file };
        return { kind: "analyse", file };
      });

      // Group hunks by fileId for targeted per-file prompts.
      const hunksByFileId = new Map<string, DiffHunk[]>();
      for (const hunk of input.hunks) {
        const existing = hunksByFileId.get(hunk.fileId);
        if (existing) {
          existing.push(hunk);
        } else {
          hunksByFileId.set(hunk.fileId, [hunk]);
        }
      }

      // Phase 1: analyse files lazily, one by one, yielding between files so
      // rendering and interactions stay responsive in the webview.
      const fileSummaries: AiFileSummary[] = [];
      for (const p of partitioned) {
        throwIfAborted(input.abortSignal);

        if (p.kind === "skip-pattern") {
          fileSummaries.push(
            skippedFileSummary(p.file, "pattern", maxChurnThreshold),
          );
          continue;
        }

        if (p.kind === "skip-churn") {
          fileSummaries.push(
            skippedFileSummary(p.file, "churn", maxChurnThreshold),
          );
          continue;
        }

        try {
          const summary = await this.#analyseFileSdk(
            client,
            input.commit,
            p.file,
            hunksByFileId.get(p.file.id) ?? [],
          );
          fileSummaries.push(summary);
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }

          fileSummaries.push({
            filePath: p.file.path,
            summary: "Summary unavailable.",
            riskNote: "Summary unavailable.",
          });
        }

        await yieldToUiThread();
      }

      // Phase 2: generate overview from the collected summaries.
      throwIfAborted(input.abortSignal);
      const { overviewCards, flowComparisons } =
        await this.#generateOverviewSdk(client, input.commit, fileSummaries);

      throwIfAborted(input.abortSignal);

      return {
        commitId: input.commitId,
        overviewCards,
        flowComparisons,
        sequenceSteps: [],
        fileSummaries,
        standardsRules: [],
        standardsResults: [],
      };
    } catch (error) {
      // In Tauri, fall back to CLI if the SDK module itself isn't available.
      if (!isTauriRuntime() || !isMissingClaudeSdkError(error)) {
        throw error;
      }

      const legacyPrompt = buildLegacyPrompt(input);
      const cliResponse = await runViaCli(legacyPrompt);
      const parsed = parseLegacyResponse(cliResponse, input.commitId);
      if (!parsed) {
        throw new Error(
          "CLI response could not be parsed as valid analysis JSON.",
        );
      }
      return parsed;
    }
  }
}

export function createClaudeSdkCommitAnalyser(
  options: ClaudeSdkCommitAnalyserOptions = {},
): CommitAnalyser {
  return new ClaudeSdkCommitAnalyser(options);
}
