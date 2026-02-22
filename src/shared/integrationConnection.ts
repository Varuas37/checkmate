import type { CliAgentConfig } from "./settings/cliAgentConfig.ts";

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

const DEFAULT_CONNECTION_TEST_MODEL = "claude-haiku-4-5-20251001";
const API_CONNECTION_TEST_SYSTEM_PROMPT =
  "You are a connection check endpoint. Respond with a short plain-text hello.";
const API_CONNECTION_TEST_PROMPT = "Say hello from the API connection test.";
const CLI_CONNECTION_TEST_PROMPT = "Say hello from the CLI connection test.";

function trimToNull(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if ("__TAURI_INTERNALS__" in window || "__TAURI__" in window) {
    return true;
  }

  if (typeof navigator === "undefined") {
    return false;
  }

  return /tauri/i.test(navigator.userAgent);
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
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
  const client = new ClientConstructor({ apiKey, dangerouslyAllowBrowser: true });

  if (!client.messages || typeof client.messages.create !== "function") {
    throw new Error("Claude SDK client is missing messages.create().");
  }

  return client;
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

function normalizeCliPromptArgs(promptArgs: readonly string[]): string[] {
  return promptArgs
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0);
}

export async function testAnthropicApiConnection(apiKey: string): Promise<string> {
  const normalizedApiKey = trimToNull(apiKey);
  if (!normalizedApiKey) {
    throw new Error("Add an Anthropic API key before running a connection test.");
  }

  const client = await createClaudeSdkClient(normalizedApiKey);
  const response = await client.messages.create({
    model: DEFAULT_CONNECTION_TEST_MODEL,
    max_tokens: 48,
    system: API_CONNECTION_TEST_SYSTEM_PROMPT,
    messages: [{ role: "user", content: API_CONNECTION_TEST_PROMPT }],
  });

  return (
    trimToNull(extractTextFromResponse(response)) ??
    "Connection test request completed successfully."
  );
}

export async function testCliAgentConnection(agent: CliAgentConfig): Promise<string> {
  const normalizedCommand = trimToNull(agent.command);
  if (!normalizedCommand) {
    throw new Error("Set a CLI command before running a connection test.");
  }

  if (!isTauriRuntime()) {
    throw new Error("CLI connection tests are available only in the desktop app.");
  }

  const output = await invokeTauri<string>("run_cli_agent_prompt", {
    command: normalizedCommand,
    args: normalizeCliPromptArgs(agent.promptArgs),
    prompt: CLI_CONNECTION_TEST_PROMPT,
  });

  return trimToNull(output) ?? "Connection test command completed successfully.";
}
