interface ProcessLike {
  readonly env?: Record<string, string | undefined>;
}

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

function readAwsRegionFromEnvironment(): string | null {
  const processLike = (globalThis as { readonly process?: ProcessLike }).process;
  const env = processLike?.env;
  if (!env) {
    return null;
  }

  const candidates = [env.AWS_REGION, env.AWS_DEFAULT_REGION];
  for (const candidate of candidates) {
    const normalized = trimToNull(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export interface RunBedrockPromptInput {
  readonly region?: string;
  readonly modelId: string;
  readonly system: string;
  readonly prompt: string;
  readonly maxTokens: number;
}

export async function runBedrockConversePrompt(input: RunBedrockPromptInput): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error("AWS Bedrock is available only in the desktop app.");
  }

  const normalizedModelId = trimToNull(input.modelId);
  if (!normalizedModelId) {
    throw new Error("Set a Bedrock model ID before running a connection test.");
  }

  const regionFromEnv = readAwsRegionFromEnvironment();
  const normalizedRegion = trimToNull(input.region) ?? regionFromEnv;
  if (!normalizedRegion) {
    throw new Error("Set an AWS region (or AWS_REGION) before using Bedrock.");
  }

  const normalizedSystem = trimToNull(input.system) ?? "";
  const normalizedPrompt = trimToNull(input.prompt);
  if (!normalizedPrompt) {
    throw new Error("Bedrock prompt cannot be empty.");
  }

  const maxTokens = Number.isFinite(input.maxTokens)
    ? Math.max(1, Math.min(8192, Math.floor(input.maxTokens)))
    : 1024;

  const output = await invokeTauri<string>("run_bedrock_converse_prompt", {
    region: normalizedRegion,
    modelId: normalizedModelId,
    system: normalizedSystem,
    prompt: normalizedPrompt,
    maxTokens,
  });

  return output.trim();
}

