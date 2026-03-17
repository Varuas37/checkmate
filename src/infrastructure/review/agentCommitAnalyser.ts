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
  createApiMessagesClient,
  extractTextFromClaudeResponse,
  readAiAnalysisConfigFromStorage,
  readApiKeyFromStorage,
  startLatencyTrace,
  type AiMessagesClient,
  type LatencyTrace,
} from "../../shared/index.ts";
import {
  canUseApiProvider,
  resolveAiProviderState,
  resolveSecondaryProvider,
  runPreferredLocalAgentPrompt,
  shouldPreferLocalAgent,
} from "./providerRouting.ts";

// ---------------------------------------------------------------------------
// Domain-adjacent local types (derived from the port, avoids extra imports)
// ---------------------------------------------------------------------------

type CommitEntity = AnalyseCommitInput["commit"];
type ChangedFile = AnalyseCommitInput["files"][number];
type DiffHunk = AnalyseCommitInput["hunks"][number];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PROVIDER_MODEL = "claude-haiku-4-5-20251001";

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

/** Max hunks to include per individual staged file-summary call. */
const FILE_SUMMARY_MAX_HUNKS = 3;
/** Max source lines shown per hunk in staged file-summary prompts. */
const FILE_SUMMARY_MAX_LINES_PER_HUNK = 16;
/** Max hunks included in the legacy single-call prompt. */
const MAX_HUNKS_IN_PROMPT = 10;
/** Max source lines shown per hunk across all prompt types. */
const MAX_LINES_PER_HUNK = 25;
/** Max files in the legacy single-call prompt. */
const MAX_FILES_IN_PROMPT = 20;
/** Max parallel file summary calls for SDK path. */
const FILE_SUMMARY_CONCURRENCY = 4;
/** ACP uses a pooled warm-session backend, so keep a small bounded fan-out. */
const ACP_FILE_SUMMARY_CONCURRENCY = 3;
/** CLI mode prompt budgets to keep end-to-end latency lower. */
const CLI_MAX_HUNKS_IN_PROMPT = 6;
const CLI_MAX_LINES_PER_HUNK = 12;
const CLI_MAX_FILES_IN_PROMPT = 8;

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

function nowForTrace(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
}

function durationMsSince(startedAt: number): number {
  const elapsed = nowForTrace() - startedAt;
  return Math.round(elapsed * 100) / 100;
}

async function mapWithConcurrency<TInput, TOutput>(
  input: readonly TInput[],
  options: {
    readonly concurrency: number;
    readonly signal?: AbortSignal;
    readonly mapper: (item: TInput, index: number) => Promise<TOutput>;
  },
): Promise<readonly TOutput[]> {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const results = new Array<TOutput>(input.length);
  let nextIndex = 0;
  let activeCount = 0;
  let settled = false;

  return new Promise<readonly TOutput[]>((resolve, reject) => {
    const finish = (resolver: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      if (options.signal && abortHandler) {
        options.signal.removeEventListener("abort", abortHandler);
      }
      resolver();
    };

    const fail = (error: unknown): void => {
      finish(() => {
        reject(error);
      });
    };

    const onItemDone = (): void => {
      if (settled) {
        return;
      }

      if (nextIndex >= input.length && activeCount === 0) {
        finish(() => {
          resolve(results);
        });
        return;
      }

      launch();
    };

    const launch = (): void => {
      if (settled) {
        return;
      }

      if (options.signal?.aborted) {
        const abortError = new Error("Commit analysis cancelled.");
        abortError.name = "AbortError";
        fail(abortError);
        return;
      }

      while (activeCount < concurrency && nextIndex < input.length) {
        const index = nextIndex;
        nextIndex += 1;
        activeCount += 1;

        void options.mapper(input[index] as TInput, index)
          .then((value) => {
            results[index] = value;
            activeCount -= 1;
            onItemDone();
          })
          .catch((error) => {
            fail(error);
          });
      }
    };

    const abortHandler = (): void => {
      const abortError = new Error("Commit analysis cancelled.");
      abortError.name = "AbortError";
      fail(abortError);
    };

    if (options.signal) {
      options.signal.addEventListener("abort", abortHandler, { once: true });
    }

    if (input.length === 0) {
      finish(() => {
        resolve([]);
      });
      return;
    }

    launch();
  });
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

function isMissingSdkClientError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("@anthropic-ai/sdk") ||
    message.includes("anthropic constructor")
  );
}

function stripJsonFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

function normalizeFlowTitle(value: string, fallback: string): string {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return fallback;
  }

  const withoutStagePrefix = normalized
    .replace(/^(before|after)\b\s*[:\-]?\s*/i, "")
    .trim();

  return withoutStagePrefix.length > 0 ? withoutStagePrefix : normalized;
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
    .slice()
    .sort((left, right) => {
      const leftChurn = left.lines.filter((line) => line.kind !== "context").length;
      const rightChurn = right.lines.filter((line) => line.kind !== "context").length;
      return rightChurn - leftChurn;
    })
    .slice(0, FILE_SUMMARY_MAX_HUNKS)
    .map((hunk) => {
      const lines = hunk.lines
        .slice(0, FILE_SUMMARY_MAX_LINES_PER_HUNK)
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
    {
      filePath: "...",
      summary: "...",
      riskNote: "...",
      technicalDetails: "...",
    },
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
    "- summary: 1-2 short sentences in plain product language about what happens now.",
    '- riskNote: 1 short sentence on overall behavior risk/watch-outs, or "Low risk." if none.',
    "- technicalDetails: 2-4 concise bullets or sentences covering concrete implementation changes (modules, functions, and state/flow updates).",
    "- Avoid code symbols, function names, and implementation jargon.",
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
    const technicalDetails =
      typeof obj["technicalDetails"] === "string"
        ? obj["technicalDetails"].trim()
        : "";

    return {
      filePath:
        typeof obj["filePath"] === "string" ? obj["filePath"] : expectedPath,
      summary: obj["summary"],
      riskNote: obj["riskNote"],
      ...(technicalDetails.length > 0
        ? {
            technicalDetails,
          }
        : {}),
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
  hunkHeadersByFilePath: readonly {
    readonly filePath: string;
    readonly hunkHeaders: readonly string[];
  }[],
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
  const hunkHintLines = hunkHeadersByFilePath
    .map(({ filePath, hunkHeaders }) => {
      const headers = hunkHeaders.map((header) => `    - ${header}`).join("\n");
      return `  ${filePath}:\n${headers}`;
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
          technicalDetails: "...",
          filePaths: ["..."],
          hunkHeadersByFile: [
            {
              filePath: "...",
              hunkHeaders: ["@@ ... @@", "@@ ... @@"],
            },
          ],
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
    hunkHintLines.length > 0 ? "" : null,
    hunkHintLines.length > 0 ? "Available hunk headers by file (for precise flow linking):" : null,
    hunkHintLines.length > 0 ? hunkHintLines : null,
    "",
    "Return ONLY valid JSON matching this schema (no markdown, no extra text):",
    schema,
    "",
    "Rules:",
    "- overviewCards: 2-4 cards in plain language covering summary, impact, risk, and open questions.",
    "- flowComparisons: 2-6 before/after pairs describing what used to happen vs what happens now for users/workflows.",
    "- Each flowComparisons entry must include technicalDetails with concrete implementation notes (functions/modules/logic flow touched).",
    "- beforeTitle and afterTitle must be plain feature names only (no `Before:`/`After:` prefixes).",
    "- Keep titles and bodies simple and non-technical; avoid code symbols, file names, and implementation jargon.",
    "- filePaths values in flowComparisons must exactly match the listed file paths.",
    "- hunkHeadersByFile is optional but preferred; when present, each filePath must be from filePaths and hunkHeaders must match provided headers exactly.",
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
              technicalDetails?: string;
              filePaths: string[];
              hunkHeadersByFile?: {
                filePath: string;
                hunkHeaders: string[];
              }[];
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
            (item): AiFlowComparison => {
              const beforeTitle = normalizeFlowTitle(item.beforeTitle, "Feature");
              const afterTitle = normalizeFlowTitle(item.afterTitle, beforeTitle);
              const hunkHeadersByFile = Array.isArray(item.hunkHeadersByFile)
                ? item.hunkHeadersByFile
                    .filter(
                      (entry): entry is { filePath: string; hunkHeaders: string[] } =>
                        !!entry &&
                        typeof entry === "object" &&
                        typeof (entry as Record<string, unknown>)["filePath"] === "string" &&
                        Array.isArray((entry as Record<string, unknown>)["hunkHeaders"]) &&
                        (
                          (entry as Record<string, unknown>)["hunkHeaders"] as unknown[]
                        ).every((header) => typeof header === "string"),
                    )
                    .map((entry) => ({
                      filePath: entry.filePath,
                      hunkHeaders: entry.hunkHeaders
                        .map((header) => header.replaceAll(/\s+/g, " ").trim())
                        .filter((header) => header.length > 0),
                    }))
                    .filter((entry) => entry.filePath.trim().length > 0 && entry.hunkHeaders.length > 0)
                : [];
              return {
              beforeTitle,
              beforeBody: item.beforeBody,
              afterTitle,
              afterBody: item.afterBody,
              ...(typeof item.technicalDetails === "string" &&
              item.technicalDetails.trim().length > 0
                ? {
                    technicalDetails: item.technicalDetails.trim(),
                  }
                : {}),
              ...(hunkHeadersByFile.length > 0
                ? {
                    hunkHeadersByFile,
                  }
                : {}),
              filePaths: item.filePaths,
              };
            },
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
    .slice(0, CLI_MAX_FILES_IN_PROMPT)
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
    .slice(0, CLI_MAX_HUNKS_IN_PROMPT);

  const hunkText = sortedHunks
    .map((hunk) => {
      const file = files.find((f) => f.id === hunk.fileId);
      const filePath = file?.path ?? hunk.fileId;
      const lines = hunk.lines
        .slice(0, CLI_MAX_LINES_PER_HUNK)
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
          technicalDetails: "...",
          filePaths: ["..."],
          hunkHeadersByFile: [
            {
              filePath: "...",
              hunkHeaders: ["@@ ... @@", "@@ ... @@"],
            },
          ],
        },
      ],
      fileSummaries: [
        {
          filePath: "...",
          summary: "...",
          riskNote: "...",
          technicalDetails: "...",
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
    `Changed files (${files.length} total, showing up to ${CLI_MAX_FILES_IN_PROMPT}):`,
    fileListing,
    "",
    "Key diff hunks:",
    hunkText,
    "",
    "Return ONLY valid JSON matching this schema (no markdown, no extra text):",
    schema,
    "",
    "Rules:",
    "- overviewCards: 2-4 cards in plain language covering summary, impact, risk, and open questions.",
    "- flowComparisons: 2-6 before/after pairs describing what used to happen vs what happens now for users/workflows.",
    "- flowComparisons entries should include technicalDetails with concrete implementation notes.",
    "- beforeTitle and afterTitle must be plain feature names only (no `Before:`/`After:` prefixes).",
    "- hunkHeadersByFile is optional but preferred; when present, use exact hunk headers from the diff.",
    "- fileSummaries: one entry per changed file with plain-language summary, risk note, and technicalDetails.",
    "- Avoid code symbols, function names, and implementation jargon.",
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
              technicalDetails?: string;
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
              ...(typeof item.technicalDetails === "string" &&
              item.technicalDetails.trim().length > 0
                ? {
                    technicalDetails: item.technicalDetails.trim(),
                  }
                : {}),
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

export interface AgentCommitAnalyserOptions {
  readonly apiKey?: string;
  readonly model?: string;
}

export class AgentCommitAnalyser implements CommitAnalyser {
  readonly #apiKeyOverride: string | null;
  readonly #model: string;

  constructor(options: AgentCommitAnalyserOptions = {}) {
    this.#apiKeyOverride = trimToNull(options.apiKey);
    this.#model = trimToNull(options.model) ?? DEFAULT_PROVIDER_MODEL;
  }

  #resolveApiKey(): string | null {
    return (
      this.#apiKeyOverride ?? readApiKeyFromStorage() ?? resolveDefaultApiKey()
    );
  }

  /** Phase 1: summarise a single file. Never throws — returns a placeholder on failure. */
  async #analyseFileSdk(
    client: AiMessagesClient,
    model: string,
    commit: CommitEntity,
    file: ChangedFile,
    fileHunks: readonly DiffHunk[],
  ): Promise<AiFileSummary> {
    const prompt = buildFilePrompt(commit, file, fileHunks);
    const response = await client.messages.create({
      model,
      max_tokens: PER_FILE_MAX_OUTPUT_TOKENS,
      system: DEFAULT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = extractTextFromClaudeResponse(response);
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
    client: AiMessagesClient,
    model: string,
    commit: CommitEntity,
    fileSummaries: readonly AiFileSummary[],
    hunkHeadersByFilePath: readonly {
      readonly filePath: string;
      readonly hunkHeaders: readonly string[];
    }[],
  ): Promise<{
    overviewCards: readonly AiOverviewCard[];
    flowComparisons: readonly AiFlowComparison[];
  }> {
    const prompt = buildOverviewPrompt(commit, fileSummaries, hunkHeadersByFilePath);
    const response = await client.messages.create({
      model,
      max_tokens: OVERVIEW_MAX_OUTPUT_TOKENS,
      system: DEFAULT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = extractTextFromClaudeResponse(response);
    return parseOverviewResponse(raw);
  }

  async #analyseFileLocal(
    runPrompt: (prompt: string) => Promise<string>,
    commit: CommitEntity,
    file: ChangedFile,
    fileHunks: readonly DiffHunk[],
  ): Promise<AiFileSummary> {
    const raw = await runPrompt(buildFilePrompt(commit, file, fileHunks));
    return (
      parseFileSummaryResponse(raw, file.path) ?? {
        filePath: file.path,
        summary: `${file.status} — ${file.additions} additions, ${file.deletions} deletions.`,
        riskNote: "Summary unavailable.",
      }
    );
  }

  async #generateOverviewLocal(
    runPrompt: (prompt: string) => Promise<string>,
    commit: CommitEntity,
    fileSummaries: readonly AiFileSummary[],
    hunkHeadersByFilePath: readonly {
      readonly filePath: string;
      readonly hunkHeaders: readonly string[];
    }[],
  ): Promise<{
    overviewCards: readonly AiOverviewCard[];
    flowComparisons: readonly AiFlowComparison[];
  }> {
    const raw = await runPrompt(
      buildOverviewPrompt(commit, fileSummaries, hunkHeadersByFilePath),
    );
    return parseOverviewResponse(raw);
  }

  async #runPromptDrivenAnalysis(
    input: AnalyseCommitInput,
    trace: LatencyTrace,
    options: {
      readonly fileSummaryConcurrency: number;
      readonly analyseFile: (
        file: ChangedFile,
        fileHunks: readonly DiffHunk[],
      ) => Promise<AiFileSummary>;
      readonly generateOverview: (
        fileSummaries: readonly AiFileSummary[],
        hunkHeadersByFilePath: readonly {
          readonly filePath: string;
          readonly hunkHeaders: readonly string[];
        }[],
      ) => Promise<{
        overviewCards: readonly AiOverviewCard[];
        flowComparisons: readonly AiFlowComparison[];
      }>;
    },
  ): Promise<AnalyseCommitOutput> {
    const { maxChurnThreshold } = readAiAnalysisConfigFromStorage();

    type FilePartition =
      | { readonly kind: "analyse"; readonly file: ChangedFile }
      | { readonly kind: "skip-pattern"; readonly file: ChangedFile }
      | { readonly kind: "skip-churn"; readonly file: ChangedFile };

    const partitioned: FilePartition[] = input.files.map((file) => {
      if (isExcludedByPattern(file.path)) {
        return { kind: "skip-pattern", file };
      }

      if (isExcludedByChurn(file.additions, file.deletions, maxChurnThreshold)) {
        return { kind: "skip-churn", file };
      }

      return { kind: "analyse", file };
    });

    const analyseCount = partitioned.filter((entry) => entry.kind === "analyse").length;
    const skippedPatternCount = partitioned.filter(
      (entry) => entry.kind === "skip-pattern",
    ).length;
    const skippedChurnCount = partitioned.filter(
      (entry) => entry.kind === "skip-churn",
    ).length;
    trace.mark("commit-analysis-files-partitioned", {
      analyseCount,
      skippedPatternCount,
      skippedChurnCount,
      maxChurnThreshold,
    });

    const hunksByFileId = new Map<string, DiffHunk[]>();
    for (const hunk of input.hunks) {
      const existing = hunksByFileId.get(hunk.fileId);
      if (existing) {
        existing.push(hunk);
      } else {
        hunksByFileId.set(hunk.fileId, [hunk]);
      }
    }

    const filePathById = new Map(input.files.map((file) => [file.id, file.path] as const));
    const hunkHeadersByFilePath = [...hunksByFileId.entries()]
      .map(([fileId, hunks]) => {
        const filePath = filePathById.get(fileId) ?? "";
        if (filePath.length === 0) {
          return null;
        }

        const hunkHeaders = hunks
          .map((hunk) => hunk.header.replaceAll(/\s+/g, " ").trim())
          .filter((header) => header.length > 0)
          .slice(0, 8);

        if (hunkHeaders.length === 0) {
          return null;
        }

        return {
          filePath,
          hunkHeaders,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    trace.mark("commit-analysis-file-summaries-start", {
      concurrency: options.fileSummaryConcurrency,
    });
    const totalSummaries = partitioned.length;
    const fileSummaries = await mapWithConcurrency<FilePartition, AiFileSummary>(partitioned, {
      concurrency: options.fileSummaryConcurrency,
      ...(input.abortSignal
        ? {
            signal: input.abortSignal,
          }
        : {}),
      mapper: async (partition, index): Promise<AiFileSummary> => {
        throwIfAborted(input.abortSignal);

        if (partition.kind === "skip-pattern") {
          const summary = skippedFileSummary(partition.file, "pattern", maxChurnThreshold);
          await input.onFileSummary?.(summary, index, totalSummaries);
          return summary;
        }

        if (partition.kind === "skip-churn") {
          const summary = skippedFileSummary(partition.file, "churn", maxChurnThreshold);
          await input.onFileSummary?.(summary, index, totalSummaries);
          return summary;
        }

        const startedAt = nowForTrace();
        trace.mark("commit-analysis-file-summary-start", {
          index,
          filePath: partition.file.path,
        });

        try {
          const summary = await options.analyseFile(
            partition.file,
            hunksByFileId.get(partition.file.id) ?? [],
          );
          trace.mark("commit-analysis-file-summary-complete", {
            index,
            filePath: partition.file.path,
            elapsedMs: durationMsSince(startedAt),
          });
          await input.onFileSummary?.(summary, index, totalSummaries);
          return summary;
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }

          trace.mark("commit-analysis-file-summary-failed", {
            index,
            filePath: partition.file.path,
            elapsedMs: durationMsSince(startedAt),
            message: error instanceof Error ? error.message : String(error),
          });

          const fallbackSummary = {
            filePath: partition.file.path,
            summary: "Summary unavailable.",
            riskNote: "Summary unavailable.",
          };
          await input.onFileSummary?.(fallbackSummary, index, totalSummaries);
          return fallbackSummary;
        } finally {
          await yieldToUiThread();
        }
      },
    });
    trace.mark("commit-analysis-file-summaries-complete", {
      fileSummaryCount: fileSummaries.length,
    });
    await input.onFileSummariesReady?.(fileSummaries);

    throwIfAborted(input.abortSignal);
    const overviewStartedAt = nowForTrace();
    trace.mark("commit-analysis-overview-start");
    const { overviewCards, flowComparisons } = await options.generateOverview(
      fileSummaries,
      hunkHeadersByFilePath,
    );
    trace.mark("commit-analysis-overview-complete", {
      elapsedMs: durationMsSince(overviewStartedAt),
      overviewCardCount: overviewCards.length,
      flowComparisonCount: flowComparisons.length,
    });

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
  }

  async analyseCommit(input: AnalyseCommitInput): Promise<AnalyseCommitOutput> {
    const trace = startLatencyTrace({
      scope: "commit-analysis",
      traceId: `commit-analysis-${input.commitId}-${Date.now()}`,
      fields: {
        commitId: input.commitId,
        fileCount: input.files.length,
        hunkCount: input.hunks.length,
      },
    });
    let traceSummaryFields: Readonly<Record<string, unknown>> | undefined;
    let traceEnded = false;
    const finishTrace = (fields?: Readonly<Record<string, unknown>>) => {
      if (traceEnded) {
        return;
      }

      traceEnded = true;
      trace.end(fields);
    };

    const resolvedApiKey = this.#resolveApiKey();
    const providerState = resolveAiProviderState(resolvedApiKey);
    const secondaryProvider = resolveSecondaryProvider(providerState);
    const runViaLocalAgent = async (prompt: string): Promise<string> =>
      runPreferredLocalAgentPrompt(prompt, input.commit.repositoryPath, providerState);

    trace.mark("commit-analysis-provider-selection", {
      preferredProvider: providerState.preferredProvider,
      fallbackToSecondary: providerState.fallbackToSecondary,
      secondaryProvider,
      activeLocalAgentId: providerState.localAgent?.id ?? null,
      localTransport: providerState.localTransport,
      hasApiKey: Boolean(resolvedApiKey),
    });

    // -----------------------------------------------------------------------
    // Local-agent preferred path: use the configured local agent first, with
    // API fallback only when explicitly enabled and available.
    // -----------------------------------------------------------------------
    if (shouldPreferLocalAgent(providerState)) {
      trace.mark("commit-analysis-local-preferred", {
        localAgent: providerState.localAgent?.id ?? null,
        transport: providerState.localTransport,
      });
      try {
        if (providerState.localTransport === "acp") {
          trace.mark("commit-analysis-local-staged-start", {
            concurrency: ACP_FILE_SUMMARY_CONCURRENCY,
          });
          const parsed = await this.#runPromptDrivenAnalysis(input, trace, {
            fileSummaryConcurrency: ACP_FILE_SUMMARY_CONCURRENCY,
            analyseFile: async (file, fileHunks) =>
              this.#analyseFileLocal(runViaLocalAgent, input.commit, file, fileHunks),
            generateOverview: async (fileSummaries, hunkHeadersByFilePath) =>
              this.#generateOverviewLocal(
                runViaLocalAgent,
                input.commit,
                fileSummaries,
                hunkHeadersByFilePath,
              ),
          });
          traceSummaryFields = {
            provider: providerState.localTransport,
            path: "preferred-staged",
            flowComparisonCount: parsed.flowComparisons.length,
            fileSummaryCount: parsed.fileSummaries.length,
            overviewCardCount: parsed.overviewCards.length,
          };
          finishTrace(traceSummaryFields);
          return parsed;
        }

        const legacyPrompt = buildLegacyPrompt(input);
        trace.mark("commit-analysis-local-request", {
          promptLength: legacyPrompt.length,
        });
        const startedAt = nowForTrace();
        const localResponse = await runViaLocalAgent(legacyPrompt);
        trace.mark("commit-analysis-local-response", {
          elapsedMs: durationMsSince(startedAt),
          responseLength: localResponse.length,
        });
        const parsed = parseLegacyResponse(localResponse, input.commitId);
        if (!parsed) {
          if (!resolvedApiKey) {
            throw new Error(
              "Local-agent response could not be parsed as valid analysis JSON.",
            );
          }
        } else {
          traceSummaryFields = {
            provider: providerState.localTransport,
            path: "preferred",
            flowComparisonCount: parsed.flowComparisons.length,
            fileSummaryCount: parsed.fileSummaries.length,
          };
          finishTrace(traceSummaryFields);
          return parsed;
        }
      } catch (error) {
        if (secondaryProvider !== "api" || !canUseApiProvider(providerState)) {
          trace.fail(error);
          finishTrace(traceSummaryFields);
          const message =
            error instanceof Error ? error.message : "Local-agent execution failed.";
          throw new Error(
            `Local-agent analysis failed and no API fallback is available (${message}).`,
          );
        }
      }
    }

    // -----------------------------------------------------------------------
    // No API provider -> local-agent required path
    // -----------------------------------------------------------------------
    if (!canUseApiProvider(providerState)) {
      if (!providerState.localAgent) {
        trace.fail(new Error("No local agent or API provider is configured."));
        finishTrace(traceSummaryFields);
        throw new Error(
          "Commit analysis requires either a configured API provider or a configured local agent.",
        );
      }

      trace.mark("commit-analysis-local-required", {
        localAgent: providerState.localAgent.id,
        transport: providerState.localTransport,
      });
      if (providerState.localTransport === "acp") {
        try {
          const parsed = await this.#runPromptDrivenAnalysis(input, trace, {
            fileSummaryConcurrency: ACP_FILE_SUMMARY_CONCURRENCY,
            analyseFile: async (file, fileHunks) =>
              this.#analyseFileLocal(runViaLocalAgent, input.commit, file, fileHunks),
            generateOverview: async (fileSummaries, hunkHeadersByFilePath) =>
              this.#generateOverviewLocal(
                runViaLocalAgent,
                input.commit,
                fileSummaries,
                hunkHeadersByFilePath,
              ),
          });
          traceSummaryFields = {
            provider: providerState.localTransport,
            path: "required-staged",
            flowComparisonCount: parsed.flowComparisons.length,
            fileSummaryCount: parsed.fileSummaries.length,
            overviewCardCount: parsed.overviewCards.length,
          };
          finishTrace(traceSummaryFields);
          return parsed;
        } catch (error) {
          trace.fail(error);
          finishTrace(traceSummaryFields);
          const message =
            error instanceof Error ? error.message : "Local-agent execution failed.";
          throw new Error(
            `Commit analysis requires a working API provider or configured local agent (${message}).`,
          );
        }
      }

      try {
        const legacyPrompt = buildLegacyPrompt(input);
        const startedAt = nowForTrace();
        const localResponse = await runViaLocalAgent(legacyPrompt);
        trace.mark("commit-analysis-local-response", {
          elapsedMs: durationMsSince(startedAt),
        });
        const parsed = parseLegacyResponse(localResponse, input.commitId);
        if (!parsed) {
          throw new Error(
            "Local-agent response could not be parsed as valid analysis JSON.",
          );
        }
        traceSummaryFields = {
          provider: providerState.localTransport,
          path: "required",
          flowComparisonCount: parsed.flowComparisons.length,
          fileSummaryCount: parsed.fileSummaries.length,
        };
        finishTrace(traceSummaryFields);
        return parsed;
      } catch (legacyError) {
        trace.fail(legacyError);
        finishTrace(traceSummaryFields);
        const message =
          legacyError instanceof Error
            ? legacyError.message
            : "Local-agent execution failed.";
        throw new Error(
          `Commit analysis requires a working API provider or configured local agent (${message}).`,
        );
      }
    }

    // -----------------------------------------------------------------------
    // API path — bounded parallel per-file summaries, then overview call
    // -----------------------------------------------------------------------
    try {
      throwIfAborted(input.abortSignal);
      if (!canUseApiProvider(providerState)) {
        throw new Error("Commit analysis requires an API provider configuration.");
      }

      const model =
        providerState.apiBackend === "bedrock"
          ? providerState.bedrock.modelId
          : this.#model;
      const clientCreateStartedAt = nowForTrace();
      trace.mark("commit-analysis-api-client-create-start", {
        backend: providerState.apiBackend,
        model,
      });
      const client = await createApiMessagesClient({
        backend: providerState.apiBackend,
        apiKey: providerState.apiKey,
        bedrockRegion: providerState.bedrock.region,
      });
      trace.mark("commit-analysis-api-client-create-complete", {
        elapsedMs: durationMsSince(clientCreateStartedAt),
      });
      const output = await this.#runPromptDrivenAnalysis(input, trace, {
        fileSummaryConcurrency: FILE_SUMMARY_CONCURRENCY,
        analyseFile: async (file, fileHunks) =>
          this.#analyseFileSdk(client, model, input.commit, file, fileHunks),
        generateOverview: async (fileSummaries, hunkHeadersByFilePath) =>
          this.#generateOverviewSdk(
            client,
            model,
            input.commit,
            fileSummaries,
            hunkHeadersByFilePath,
          ),
      });
      traceSummaryFields = {
        provider: `api-${providerState.apiBackend}`,
        flowComparisonCount: output.flowComparisons.length,
        fileSummaryCount: output.fileSummaries.length,
        overviewCardCount: output.overviewCards.length,
      };

      return output;
    } catch (error) {
      if (isAbortError(error)) {
        trace.mark("commit-analysis-aborted");
        throw error;
      }

      // Fall back to the configured local agent when the API path is unavailable
      // and local fallback has been explicitly enabled.
      if (secondaryProvider === "local-agent") {
        try {
          trace.mark("commit-analysis-api-local-fallback", {
            backend: providerState.apiBackend,
            message: error instanceof Error ? error.message : String(error),
          });
          const legacyPrompt = buildLegacyPrompt(input);
          const fallbackStartedAt = nowForTrace();
          const localResponse = await runViaLocalAgent(legacyPrompt);
          trace.mark("commit-analysis-local-fallback-response", {
            elapsedMs: durationMsSince(fallbackStartedAt),
          });
          const parsed = parseLegacyResponse(localResponse, input.commitId);
          if (!parsed) {
            throw new Error(
              "Local-agent response could not be parsed as valid analysis JSON.",
            );
          }
          traceSummaryFields = {
            provider: `${providerState.localTransport}-fallback`,
            flowComparisonCount: parsed.flowComparisons.length,
            fileSummaryCount: parsed.fileSummaries.length,
          };
          return parsed;
        } catch (fallbackError) {
          trace.fail(fallbackError, {
            phase: "local-fallback",
          });
          throw fallbackError;
        }
      }

      trace.fail(error);
      throw error;
    } finally {
      finishTrace(traceSummaryFields);
    }
  }
}

export function createAgentCommitAnalyser(
  options: AgentCommitAnalyserOptions = {},
): CommitAnalyser {
  return new AgentCommitAnalyser(options);
}
