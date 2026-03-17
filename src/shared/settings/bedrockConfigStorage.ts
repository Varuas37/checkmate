const STORAGE_KEY = "codelens-bedrock-config";

export interface BedrockConfig {
  readonly region: string;
  readonly modelId: string;
}

const DEFAULT_CONFIG: BedrockConfig = {
  region: "us-west-2",
  modelId: "",
};

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBedrockConfig(value: unknown): BedrockConfig {
  if (!value || typeof value !== "object") {
    return DEFAULT_CONFIG;
  }

  const obj = value as Record<string, unknown>;
  const region = trimString(obj["region"]);
  const modelId = trimString(obj["modelId"]);

  return {
    region: region.length > 0 ? region : DEFAULT_CONFIG.region,
    modelId,
  };
}

export function readBedrockConfigFromStorage(): BedrockConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_CONFIG;
    }

    const parsed: unknown = JSON.parse(raw);
    return normalizeBedrockConfig(parsed);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function writeBedrockConfigToStorage(patch: Partial<BedrockConfig>): BedrockConfig {
  const current = readBedrockConfigFromStorage();
  const next = normalizeBedrockConfig({ ...current, ...patch });

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore write failures (private mode/storage quota).
  }

  return next;
}

