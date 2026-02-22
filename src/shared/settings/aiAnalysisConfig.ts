const STORAGE_KEY = "codelens-ai-analysis-config";

export interface AiAnalysisConfig {
  /** Lines changed (additions + deletions) above which a file is skipped by the analyser. 0 = no limit. */
  readonly maxChurnThreshold: number;
}

const DEFAULT_CONFIG: AiAnalysisConfig = {
  maxChurnThreshold: 500,
};

export function readAiAnalysisConfigFromStorage(): AiAnalysisConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_CONFIG;
    const obj = parsed as Record<string, unknown>;
    const maxChurnThreshold =
      typeof obj["maxChurnThreshold"] === "number" && obj["maxChurnThreshold"] >= 0
        ? Math.floor(obj["maxChurnThreshold"])
        : DEFAULT_CONFIG.maxChurnThreshold;
    return { maxChurnThreshold };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function writeAiAnalysisConfigToStorage(config: AiAnalysisConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore write failures.
  }
}

export { DEFAULT_CONFIG as DEFAULT_AI_ANALYSIS_CONFIG };
