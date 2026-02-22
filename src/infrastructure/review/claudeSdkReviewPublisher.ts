import type {
  PublishReviewRequest,
  PublishReviewResult,
  ReviewPublisher,
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

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_OUTPUT_TOKENS = 900;
const DEFAULT_SYSTEM_PROMPT =
  "You are assisting with publishing structured code-review feedback for downstream agent actions.";

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

function createDefaultPrompt(input: PublishReviewRequest): string {
  return [
    "A reviewer is publishing a structured code-review package.",
    `Request ID: ${input.requestId}`,
    `Requested by: ${input.requestedBy}`,
    `Requested at: ${input.requestedAtIso}`,
    `Commit: ${input.commitId} (${input.commitSha})`,
    "Return a concise acknowledgement and next-step plan for follow-up patch work.",
    "Review package JSON:",
    input.payloadJson,
  ].join("\n\n");
}

function truncateSummary(summary: string, maxLength = 800): string {
  if (summary.length <= maxLength) {
    return summary;
  }

  return `${summary.slice(0, maxLength - 3)}...`;
}

function extractSummaryFromResponse(response: unknown): string {
  if (!response || typeof response !== "object") {
    return "";
  }

  const content = (response as { readonly content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }

  const fragments = content
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
    .filter((fragment) => fragment.trim().length > 0);

  return fragments.join("\n").trim();
}

function extractPublicationId(response: unknown, fallbackId: string): string {
  if (!response || typeof response !== "object") {
    return fallbackId;
  }

  const publicationId = (response as { readonly id?: unknown }).id;
  if (typeof publicationId !== "string") {
    return fallbackId;
  }

  const trimmedId = publicationId.trim();
  return trimmedId.length > 0 ? trimmedId : fallbackId;
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
  return invoke<string>("run_claude_prompt", {
    prompt,
  });
}

export interface ClaudeSdkReviewPublisherOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly maxOutputTokens?: number;
  readonly nowIso?: () => string;
  readonly createPrompt?: (input: PublishReviewRequest) => string;
  readonly createClient?: ClaudeSdkClientFactory;
}

export class ClaudeSdkReviewPublisher implements ReviewPublisher {
  readonly #apiKeyOverride: string | null;
  readonly #model: string;
  readonly #maxOutputTokens: number;
  readonly #nowIso: () => string;
  readonly #createPrompt: (input: PublishReviewRequest) => string;
  readonly #createClient: ClaudeSdkClientFactory;

  constructor(options: ClaudeSdkReviewPublisherOptions = {}) {
    this.#apiKeyOverride = trimToNull(options.apiKey);
    this.#model = trimToNull(options.model) ?? DEFAULT_CLAUDE_MODEL;
    this.#maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.#nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.#createPrompt = options.createPrompt ?? createDefaultPrompt;
    this.#createClient = options.createClient ?? createClaudeSdkClient;
  }

  #resolveApiKey(): string | null {
    return this.#apiKeyOverride ?? readApiKeyFromStorage() ?? resolveDefaultApiKey();
  }

  async publishReview(input: PublishReviewRequest): Promise<PublishReviewResult> {
    const prompt = this.#createPrompt(input);
    const resolvedApiKey = this.#resolveApiKey();

    if (!resolvedApiKey) {
      try {
        const cliResponse = await runClaudePromptViaTauri(prompt);
        const cliSummary = truncateSummary(cliResponse.trim());

        return {
          provider: "claude-sdk",
          requestId: input.requestId,
          publicationId: `claude-cli-${input.requestId}`,
          publishedAtIso: this.#nowIso(),
          summary:
            cliSummary.length > 0
              ? cliSummary
              : `Review package for ${input.commitSha} accepted by Claude CLI adapter.`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Claude CLI fallback failed.";
        throw new Error(
          `Claude publish requires ANTHROPIC_API_KEY/VITE_ANTHROPIC_API_KEY or a working Claude CLI login in Tauri (${message}).`,
        );
      }
    }

    try {
      const client = await this.#createClient(resolvedApiKey);
      const response = await client.messages.create({
        model: this.#model,
        max_tokens: this.#maxOutputTokens,
        system: DEFAULT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const summaryText = extractSummaryFromResponse(response);
      const summary =
        summaryText.length > 0
          ? truncateSummary(summaryText)
          : `Review package for ${input.commitSha} accepted by Claude adapter.`;

      return {
        provider: "claude-sdk",
        requestId: input.requestId,
        publicationId: extractPublicationId(response, input.requestId),
        publishedAtIso: this.#nowIso(),
        summary,
      };
    } catch (error) {
      if (!isTauriRuntime() || !isMissingClaudeSdkError(error)) {
        throw error;
      }

      try {
        const cliResponse = await runClaudePromptViaTauri(prompt);
        const cliSummary = truncateSummary(cliResponse.trim());

        return {
          provider: "claude-sdk",
          requestId: input.requestId,
          publicationId: `claude-cli-${input.requestId}`,
          publishedAtIso: this.#nowIso(),
          summary:
            cliSummary.length > 0
              ? cliSummary
              : `Review package for ${input.commitSha} accepted by Claude CLI adapter.`,
        };
      } catch (cliError) {
        const sdkMessage = error instanceof Error ? error.message : "Claude SDK client setup failed.";
        const cliMessage = cliError instanceof Error ? cliError.message : "Claude CLI fallback failed.";
        throw new Error(
          `Claude publish failed in SDK path (${sdkMessage}) and CLI fallback (${cliMessage}).`,
        );
      }
    }
  }
}

export function createClaudeSdkReviewPublisher(
  options: ClaudeSdkReviewPublisherOptions = {},
): ReviewPublisher {
  return new ClaudeSdkReviewPublisher(options);
}
