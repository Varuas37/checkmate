const STORAGE_KEY = "codelens-api-backend";

export type ApiBackend = "anthropic" | "bedrock";

const DEFAULT_BACKEND: ApiBackend = "anthropic";

function normalizeApiBackend(value: unknown): ApiBackend {
  if (value === "bedrock") {
    return "bedrock";
  }

  return "anthropic";
}

export function readApiBackendFromStorage(): ApiBackend {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_BACKEND;
    }

    return normalizeApiBackend(raw.trim());
  } catch {
    return DEFAULT_BACKEND;
  }
}

export function writeApiBackendToStorage(backend: ApiBackend): void {
  try {
    localStorage.setItem(STORAGE_KEY, backend);
  } catch {
    // Ignore write failures (private mode/storage quota).
  }
}

