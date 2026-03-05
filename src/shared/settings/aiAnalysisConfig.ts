const STORAGE_KEY = "codelens-ai-analysis-config";

export interface AiAnalysisConfig {
  /** Lines changed (additions + deletions) above which a file is skipped by the analyser. 0 = no limit. */
  readonly maxChurnThreshold: number;
  /**
   * When true, switching commits/branches triggers a new AI analysis run even when
   * cached analysis is already available for that commit.
   */
  readonly autoRunOnCommitChange: boolean;
}

const DEFAULT_CONFIG: AiAnalysisConfig = {
  maxChurnThreshold: 500,
  autoRunOnCommitChange: false,
};

function normalizeAiAnalysisConfig(
  input: unknown,
  fallback: AiAnalysisConfig = DEFAULT_CONFIG,
): AiAnalysisConfig {
  const fallbackMaxChurnThreshold = Math.max(0, Math.floor(fallback.maxChurnThreshold));
  const fallbackAutoRunOnCommitChange = fallback.autoRunOnCommitChange;

  if (!input || typeof input !== "object") {
    return {
      maxChurnThreshold: fallbackMaxChurnThreshold,
      autoRunOnCommitChange: fallbackAutoRunOnCommitChange,
    };
  }

  const obj = input as Record<string, unknown>;
  const maxChurnThreshold =
    typeof obj["maxChurnThreshold"] === "number" && obj["maxChurnThreshold"] >= 0
      ? Math.floor(obj["maxChurnThreshold"])
      : fallbackMaxChurnThreshold;
  const autoRunOnCommitChange =
    typeof obj["autoRunOnCommitChange"] === "boolean"
      ? obj["autoRunOnCommitChange"]
      : fallbackAutoRunOnCommitChange;

  return {
    maxChurnThreshold,
    autoRunOnCommitChange,
  };
}

export function readAiAnalysisConfigFromStorage(): AiAnalysisConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_CONFIG;
    }

    const parsed: unknown = JSON.parse(raw);
    return normalizeAiAnalysisConfig(parsed, DEFAULT_CONFIG);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function writeAiAnalysisConfigToStorage(config: Partial<AiAnalysisConfig>): void {
  try {
    const current = readAiAnalysisConfigFromStorage();
    const next = normalizeAiAnalysisConfig(config, current);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore write failures.
  }
}

export { DEFAULT_CONFIG as DEFAULT_AI_ANALYSIS_CONFIG };
