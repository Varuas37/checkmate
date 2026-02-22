import type {
  PublishReviewRequest,
  PublishReviewResult,
  ReviewPublisher,
} from "../../domain/review/index.ts";
import {
  readActiveCliAgentFromStorage,
  readApiKeyFromStorage,
  readCliPreferenceFromStorage,
} from "../../shared/index.ts";

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
  const threadPrompt = resolveThreadReviewPrompt(input.payloadJson);
  if (threadPrompt) {
    return [
      "You are Checkmate, an expert AI teammate helping with code review threads.",
      "Do not echo or restate the input prompt.",
      "Respond in markdown and stay focused on the specific diff context.",
      "Respond directly using this exact structure:",
      "1. Root cause.",
      "2. Risk/impact.",
      "3. Concrete patch suggestion.",
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

async function runCliAgentPromptViaTauri(
  command: string,
  args: readonly string[],
  prompt: string,
): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error("CLI agent is available only in Tauri runtime.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("run_cli_agent_prompt", { command, args: [...args], prompt });
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
    const preferCli = readCliPreferenceFromStorage();
    const activeCliAgent = readActiveCliAgentFromStorage();

    const runViaCli = async (): Promise<string> => {
      if (activeCliAgent && isTauriRuntime()) {
        return runCliAgentPromptViaTauri(activeCliAgent.command, activeCliAgent.promptArgs, prompt);
      }
      return runClaudePromptViaTauri(prompt);
    };

    const buildCliResult = (raw: string): PublishReviewResult => {
      const summary = raw.trim();
      return {
        provider: "claude-sdk",
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
    if (preferCli && activeCliAgent && isTauriRuntime()) {
      try {
        const cliResponse = await runViaCli();
        return buildCliResult(cliResponse);
      } catch {
        if (!resolvedApiKey) {
          throw new Error(
            `${activeCliAgent.name} CLI failed and no API key is available for fallback.`,
          );
        }
        // CLI failed — fall through to SDK.
      }
    }

    if (!resolvedApiKey) {
      try {
        const cliResponse = await runViaCli();
        return buildCliResult(cliResponse);
      } catch (error) {
        const message = error instanceof Error ? error.message : "CLI fallback failed.";
        throw new Error(
          `Publish requires ANTHROPIC_API_KEY or a configured CLI agent (${message}).`,
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
          ? summaryText
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
        const cliResponse = await runViaCli();
        return buildCliResult(cliResponse);
      } catch (cliError) {
        const sdkMessage = error instanceof Error ? error.message : "Claude SDK client setup failed.";
        const cliMessage = cliError instanceof Error ? cliError.message : "CLI fallback failed.";
        throw new Error(
          `Publish failed in SDK path (${sdkMessage}) and CLI fallback (${cliMessage}).`,
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
