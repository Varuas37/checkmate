import type { ApiBackend } from "./settings/apiBackendStorage.ts";
import { runBedrockConversePrompt } from "./bedrockRuntime.ts";

export interface AiMessagesClient {
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

function trimToNull(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractTextFromClaudeResponse(response: unknown): string {
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

export async function createAnthropicMessagesClient(apiKey: string): Promise<AiMessagesClient> {
  const normalizedApiKey = trimToNull(apiKey);
  if (!normalizedApiKey) {
    throw new Error("Anthropic API key is required.");
  }

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
  }) => AiMessagesClient;
  const client = new ClientConstructor({ apiKey: normalizedApiKey, dangerouslyAllowBrowser: true });

  if (!client.messages || typeof client.messages.create !== "function") {
    throw new Error("Claude SDK client is missing messages.create().");
  }

  return client;
}

export function createBedrockMessagesClient(input: { readonly region: string }): AiMessagesClient {
  const normalizedRegion = trimToNull(input.region);
  if (!normalizedRegion) {
    throw new Error("AWS region is required for Bedrock requests.");
  }

  return {
    messages: {
      create: async (args) => {
        const prompt = args.messages.map((message) => message.content).join("\n\n").trim();
        const output = await runBedrockConversePrompt({
          region: normalizedRegion,
          modelId: args.model,
          system: args.system,
          prompt,
          maxTokens: args.max_tokens,
        });

        return {
          content: [{ text: output }],
        };
      },
    },
  };
}

export async function createApiMessagesClient(input: {
  readonly backend: ApiBackend;
  readonly apiKey: string | null;
  readonly bedrockRegion: string;
}): Promise<AiMessagesClient> {
  if (input.backend === "bedrock") {
    return createBedrockMessagesClient({ region: input.bedrockRegion });
  }

  if (!input.apiKey) {
    throw new Error("Anthropic API key is required.");
  }

  return createAnthropicMessagesClient(input.apiKey);
}

