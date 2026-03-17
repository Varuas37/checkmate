import type {
  PublishReviewRequest,
  PublishReviewResult,
  ReviewPublisher,
} from "../../domain/review/index.ts";
import {
  createApiMessagesClient,
  readApiKeyFromStorage,
  startLatencyTrace,
} from "../../shared/index.ts";
import {
  canUseApiProvider,
  resolveAiProviderState,
  resolveSecondaryProvider,
  runPreferredLocalAgentPrompt,
  shouldPreferLocalAgent,
} from "./providerRouting.ts";

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

const DEFAULT_PROVIDER_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_OUTPUT_TOKENS = 900;
const DEFAULT_SYSTEM_PROMPT =
  "You are assisting with publishing structured code-review feedback for downstream agent actions.";

function trimToNull(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  const threadPrompt = resolveThreadReviewPrompt(input.payloadJson);
  if (threadPrompt) {
    return [
      "You are Checkmate, an expert AI teammate helping with code review threads.",
      "Do not echo or restate the input prompt.",
      "Respond in markdown and stay focused on the specific diff context.",
      "Answer the reviewer request first, and follow the `Responder instructions` in the thread context.",
      "Use strict numbered bug-review structure only when the thread context explicitly requests that mode.",
      "Thread context:",
      threadPrompt,
    ].join("\n\n");
  }

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

function resolveThreadReviewPrompt(payloadJson: string): string | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const payloadType = (parsed as { readonly type?: unknown }).type;
  if (payloadType !== "thread-review") {
    return null;
  }

  const prompt = (parsed as { readonly prompt?: unknown }).prompt;
  if (typeof prompt !== "string") {
    return null;
  }

  const trimmed = prompt.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function isMissingSdkClientError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("@anthropic-ai/sdk") || message.includes("anthropic constructor");
}

export interface AgentReviewPublisherOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly maxOutputTokens?: number;
  readonly nowIso?: () => string;
  readonly createPrompt?: (input: PublishReviewRequest) => string;
}

export class AgentReviewPublisher implements ReviewPublisher {
  readonly #apiKeyOverride: string | null;
  readonly #model: string;
  readonly #maxOutputTokens: number;
  readonly #nowIso: () => string;
  readonly #createPrompt: (input: PublishReviewRequest) => string;

  constructor(options: AgentReviewPublisherOptions = {}) {
    this.#apiKeyOverride = trimToNull(options.apiKey);
    this.#model = trimToNull(options.model) ?? DEFAULT_PROVIDER_MODEL;
    this.#maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.#nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.#createPrompt = options.createPrompt ?? createDefaultPrompt;
  }

  #resolveApiKey(): string | null {
    return this.#apiKeyOverride ?? readApiKeyFromStorage() ?? resolveDefaultApiKey();
  }

  async publishReview(input: PublishReviewRequest): Promise<PublishReviewResult> {
    const trace = startLatencyTrace({
      scope: "review-publish",
      traceId: `review-publish-${input.requestId}-${Date.now()}`,
      fields: {
        requestId: input.requestId,
        commitId: input.commitId,
        commitSha: input.commitSha,
      },
    });
    let traceSummaryFields: Readonly<Record<string, unknown>> | undefined;

    const prompt = this.#createPrompt(input);
    const resolvedApiKey = this.#resolveApiKey();
    const providerState = resolveAiProviderState(resolvedApiKey);
    const secondaryProvider = resolveSecondaryProvider(providerState);
    const runViaLocalAgent = async (): Promise<string> =>
      runPreferredLocalAgentPrompt(prompt, undefined, providerState);

    const buildCliResult = (raw: string): PublishReviewResult => {
      const summary = raw.trim();
      return {
        provider: "ai-sdk",
        requestId: input.requestId,
        publicationId: `cli-${input.requestId}`,
        publishedAtIso: this.#nowIso(),
        summary:
          summary.length > 0
            ? summary
            : `Review package for ${input.commitSha} accepted by CLI agent.`,
      };
    };

    // Prefer CLI over API: try configured CLI first, fall back to SDK.
    try {
      if (shouldPreferLocalAgent(providerState)) {
        trace.mark("review-publish-local-preferred", {
          localAgent: providerState.localAgent?.id ?? null,
          transport: providerState.localTransport,
        });
        try {
          const startedAt = nowForTrace();
          const localResponse = await runViaLocalAgent();
          trace.mark("review-publish-local-response", {
            elapsedMs: durationMsSince(startedAt),
          });
          const result = buildCliResult(localResponse);
          traceSummaryFields = {
            provider: providerState.localTransport,
            path: "preferred",
          };
          return result;
        } catch (error) {
          if (secondaryProvider !== "api" || !canUseApiProvider(providerState)) {
            const message = error instanceof Error ? error.message : "Local-agent execution failed.";
            throw new Error(
              `Local-agent review publishing failed and no API fallback is available (${message}).`,
            );
          }
        }
      }

      if (!canUseApiProvider(providerState)) {
        trace.mark("review-publish-local-required", {
          localAgent: providerState.localAgent?.id ?? null,
          transport: providerState.localTransport,
        });
        try {
          const startedAt = nowForTrace();
          const localResponse = await runViaLocalAgent();
          trace.mark("review-publish-local-response", {
            elapsedMs: durationMsSince(startedAt),
          });
          const result = buildCliResult(localResponse);
          traceSummaryFields = {
            provider: providerState.localTransport,
            path: "required",
          };
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Local-agent execution failed.";
          throw new Error(
            `Review publishing requires a working API provider or configured local agent (${message}).`,
          );
        }
      }

      try {
        const clientStartedAt = nowForTrace();
        const model =
          providerState.apiBackend === "bedrock"
            ? providerState.bedrock.modelId
            : this.#model;
        trace.mark("review-publish-api-client-create-start", {
          backend: providerState.apiBackend,
          model,
        });
        const client = await createApiMessagesClient({
          backend: providerState.apiBackend,
          apiKey: providerState.apiKey,
          bedrockRegion: providerState.bedrock.region,
        });
        trace.mark("review-publish-api-client-create-complete", {
          elapsedMs: durationMsSince(clientStartedAt),
        });

        const completionStartedAt = nowForTrace();
        const response = await client.messages.create({
          model,
          max_tokens: this.#maxOutputTokens,
          system: DEFAULT_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
        });
        trace.mark("review-publish-sdk-response", {
          elapsedMs: durationMsSince(completionStartedAt),
        });

        const summaryText = extractSummaryFromResponse(response);
        const summary =
          summaryText.length > 0
            ? summaryText
            : `Review package for ${input.commitSha} accepted by the AI adapter.`;

        traceSummaryFields = {
          provider: `api-${providerState.apiBackend}`,
        };
        return {
          provider: "ai-sdk",
          requestId: input.requestId,
          publicationId: extractPublicationId(response, input.requestId),
          publishedAtIso: this.#nowIso(),
          summary,
        };
      } catch (error) {
        if (secondaryProvider !== "local-agent") {
          throw error;
        }

        try {
          trace.mark("review-publish-api-local-fallback", {
            backend: providerState.apiBackend,
            message: error instanceof Error ? error.message : String(error),
          });
          const startedAt = nowForTrace();
          const localResponse = await runViaLocalAgent();
          trace.mark("review-publish-local-fallback-response", {
            elapsedMs: durationMsSince(startedAt),
          });
          const result = buildCliResult(localResponse);
          traceSummaryFields = {
            provider: `${providerState.localTransport}-fallback`,
          };
          return result;
        } catch (cliError) {
          const sdkMessage = error instanceof Error ? error.message : "AI SDK client setup failed.";
          const cliMessage =
            cliError instanceof Error ? cliError.message : "Local-agent fallback failed.";
          throw new Error(
            `Publish failed in API path (${sdkMessage}) and local-agent fallback (${cliMessage}).`,
          );
        }
      }
    } catch (error) {
      trace.fail(error);
      throw error;
    } finally {
      trace.end(traceSummaryFields);
    }
  }
}

export function createAgentReviewPublisher(
  options: AgentReviewPublisherOptions = {},
): ReviewPublisher {
  return new AgentReviewPublisher(options);
}
