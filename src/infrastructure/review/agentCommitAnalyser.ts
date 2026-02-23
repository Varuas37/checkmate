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
  startLatencyTrace,
} from "../../shared/index.ts";

// ---------------------------------------------------------------------------
// SDK client interface + factory
// ---------------------------------------------------------------------------

interface SdkClient {
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

type SdkClientFactory = (apiKey: string) => Promise<SdkClient>;

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

/** Max hunks to include per individual file call. */
const MAX_HUNKS_PER_FILE = 5;
/** Max hunks included in the legacy single-call prompt. */
const MAX_HUNKS_IN_PROMPT = 10;
/** Max source lines shown per hunk across all prompt types. */
const MAX_LINES_PER_HUNK = 25;
/** Max files in the legacy single-call prompt. */
const MAX_FILES_IN_PROMPT = 20;
/** Max parallel file summary calls for SDK path. */
const FILE_SUMMARY_CONCURRENCY = 4;

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

async function createSdkClient(apiKey: string): Promise<SdkClient> {
  let sdkModule: unknown;

  try {
    sdkModule = await import("@anthropic-ai/sdk");
  } catch {
    throw new Error('AI SDK package "@anthropic-ai/sdk" is not installed.');
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
  }) => SdkClient;
  const client = new ClientConstructor({
    apiKey,
    dangerouslyAllowBrowser: true,
  });

  if (!client.messages || typeof client.messages.create !== "function") {
    throw new Error("AI SDK client is missing messages.create().");
  }

  return client;
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

async function runFallbackPromptViaTauri(prompt: string): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error("Fallback CLI is available only in Tauri runtime.");
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
  readonly #createClient: SdkClientFactory;

  constructor(options: AgentCommitAnalyserOptions = {}) {
    this.#apiKeyOverride = trimToNull(options.apiKey);
    this.#model = trimToNull(options.model) ?? DEFAULT_PROVIDER_MODEL;
    this.#createClient = createSdkClient;
  }

  #resolveApiKey(): string | null {
    return (
      this.#apiKeyOverride ?? readApiKeyFromStorage() ?? resolveDefaultApiKey()
    );
  }

  /** Phase 1: summarise a single file. Never throws — returns a placeholder on failure. */
  async #analyseFileSdk(
    client: SdkClient,
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
    client: SdkClient,
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
      model: this.#model,
      max_tokens: OVERVIEW_MAX_OUTPUT_TOKENS,
      system: DEFAULT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = extractTextFromResponse(response);
    return parseOverviewResponse(raw);
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
    const preferCli = readCliPreferenceFromStorage();
    const activeCliAgent = readActiveCliAgentFromStorage();

    /** Runs the configured CLI agent, with a default CLI fallback if the active agent fails. */
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
            return await runFallbackPromptViaTauri(prompt);
          } catch (fallbackCliError) {
            const activeMessage =
              activeCliError instanceof Error
                ? activeCliError.message
                : "CLI execution failed.";
            const fallbackMessage =
              fallbackCliError instanceof Error
                ? fallbackCliError.message
                : "Fallback CLI failed.";
            throw new Error(
              `Primary CLI agent "${activeCliAgent.name}" failed (${activeMessage}) and fallback CLI failed (${fallbackMessage}).`,
            );
          }
        }
      }

      return runFallbackPromptViaTauri(prompt);
    };

    // -----------------------------------------------------------------------
    // Prefer CLI over API: try configured CLI first, fall back to SDK
    // -----------------------------------------------------------------------
    if (preferCli && activeCliAgent && isTauriRuntime()) {
      trace.mark("commit-analysis-cli-preferred", {
        cliAgent: activeCliAgent.id,
      });
      const legacyPrompt = buildLegacyPrompt(input);
      try {
        const startedAt = nowForTrace();
        const cliResponse = await runViaCli(legacyPrompt);
        trace.mark("commit-analysis-cli-response", {
          elapsedMs: durationMsSince(startedAt),
        });
        const parsed = parseLegacyResponse(cliResponse, input.commitId);
        if (parsed) {
          traceSummaryFields = {
            provider: "cli",
            path: "preferred",
            flowComparisonCount: parsed.flowComparisons.length,
            fileSummaryCount: parsed.fileSummaries.length,
          };
          finishTrace(traceSummaryFields);
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
          trace.fail(error);
          finishTrace(traceSummaryFields);
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
      trace.mark("commit-analysis-cli-required");
      const legacyPrompt = buildLegacyPrompt(input);
      try {
        const startedAt = nowForTrace();
        const cliResponse = await runViaCli(legacyPrompt);
        trace.mark("commit-analysis-cli-response", {
          elapsedMs: durationMsSince(startedAt),
        });
        const parsed = parseLegacyResponse(cliResponse, input.commitId);
        if (!parsed) {
          throw new Error(
            "CLI response could not be parsed as valid analysis JSON.",
          );
        }
        traceSummaryFields = {
          provider: "cli",
          path: "required",
          flowComparisonCount: parsed.flowComparisons.length,
          fileSummaryCount: parsed.fileSummaries.length,
        };
        finishTrace(traceSummaryFields);
        return parsed;
      } catch (error) {
        trace.fail(error);
        finishTrace(traceSummaryFields);
        const message =
          error instanceof Error ? error.message : "CLI fallback failed.";
        throw new Error(
          `Commit analysis requires ANTHROPIC_API_KEY or a configured CLI agent (${message}).`,
        );
      }
    }

    // -----------------------------------------------------------------------
    // SDK path — bounded parallel per-file summaries, then overview call
    // -----------------------------------------------------------------------
    try {
      throwIfAborted(input.abortSignal);
      const clientCreateStartedAt = nowForTrace();
      trace.mark("commit-analysis-sdk-client-create-start", {
        model: this.#model,
      });
      const client = await this.#createClient(resolvedApiKey);
      trace.mark("commit-analysis-sdk-client-create-complete", {
        elapsedMs: durationMsSince(clientCreateStartedAt),
      });
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

      // Phase 1: analyse files with bounded parallelism while preserving output order.
      trace.mark("commit-analysis-file-summaries-start", {
        concurrency: FILE_SUMMARY_CONCURRENCY,
      });
      const fileSummaries = await mapWithConcurrency<FilePartition, AiFileSummary>(partitioned, {
        concurrency: FILE_SUMMARY_CONCURRENCY,
        ...(input.abortSignal
          ? {
              signal: input.abortSignal,
            }
          : {}),
        mapper: async (partition, index): Promise<AiFileSummary> => {
          throwIfAborted(input.abortSignal);

          if (partition.kind === "skip-pattern") {
            return skippedFileSummary(partition.file, "pattern", maxChurnThreshold);
          }

          if (partition.kind === "skip-churn") {
            return skippedFileSummary(partition.file, "churn", maxChurnThreshold);
          }

          const startedAt = nowForTrace();
          trace.mark("commit-analysis-file-summary-start", {
            index,
            filePath: partition.file.path,
          });

          try {
            const summary = await this.#analyseFileSdk(
              client,
              input.commit,
              partition.file,
              hunksByFileId.get(partition.file.id) ?? [],
            );
            trace.mark("commit-analysis-file-summary-complete", {
              index,
              filePath: partition.file.path,
              elapsedMs: durationMsSince(startedAt),
            });
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

            return {
              filePath: partition.file.path,
              summary: "Summary unavailable.",
              riskNote: "Summary unavailable.",
            };
          } finally {
            await yieldToUiThread();
          }
        },
      });
      trace.mark("commit-analysis-file-summaries-complete", {
        fileSummaryCount: fileSummaries.length,
      });

      // Phase 2: generate overview from the collected summaries.
      throwIfAborted(input.abortSignal);
      const overviewStartedAt = nowForTrace();
      trace.mark("commit-analysis-overview-start");
      const { overviewCards, flowComparisons } =
        await this.#generateOverviewSdk(
          client,
          input.commit,
          fileSummaries,
          hunkHeadersByFilePath,
        );
      trace.mark("commit-analysis-overview-complete", {
        elapsedMs: durationMsSince(overviewStartedAt),
        overviewCardCount: overviewCards.length,
        flowComparisonCount: flowComparisons.length,
      });

      throwIfAborted(input.abortSignal);

      traceSummaryFields = {
        provider: "sdk",
        flowComparisonCount: flowComparisons.length,
        fileSummaryCount: fileSummaries.length,
        overviewCardCount: overviewCards.length,
      };

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
      if (isAbortError(error)) {
        trace.mark("commit-analysis-aborted");
        throw error;
      }

      // In Tauri, fall back to CLI if the SDK module itself isn't available.
      if (isTauriRuntime() && isMissingSdkClientError(error)) {
        try {
          trace.mark("commit-analysis-sdk-missing-cli-fallback");
          const legacyPrompt = buildLegacyPrompt(input);
          const fallbackStartedAt = nowForTrace();
          const cliResponse = await runViaCli(legacyPrompt);
          trace.mark("commit-analysis-cli-fallback-response", {
            elapsedMs: durationMsSince(fallbackStartedAt),
          });
          const parsed = parseLegacyResponse(cliResponse, input.commitId);
          if (!parsed) {
            throw new Error(
              "CLI response could not be parsed as valid analysis JSON.",
            );
          }
          traceSummaryFields = {
            provider: "cli-fallback",
            flowComparisonCount: parsed.flowComparisons.length,
            fileSummaryCount: parsed.fileSummaries.length,
          };
          return parsed;
        } catch (fallbackError) {
          trace.fail(fallbackError, {
            phase: "cli-fallback",
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
