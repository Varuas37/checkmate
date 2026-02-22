const STORAGE_KEY = "codelens-anthropic-api-key";

function trimToNull(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readApiKeyFromStorage(): string | null {
  try {
    return trimToNull(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeApiKeyToStorage(apiKey: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, apiKey);
  } catch {
    // Ignore write failures (e.g., storage quota exceeded or private mode).
  }
}

export function clearApiKeyFromStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore removal failures.
  }
}
