import { writeApiKeyToStorage } from "./apiKeyStorage.ts";
import { writeAiAnalysisConfigToStorage } from "./aiAnalysisConfig.ts";
import {
  readCliAgentsSettingsFromStorage,
  writeCliAgentsSettingsToStorage,
  type CliAgentsSettings,
} from "./cliAgentConfig.ts";

export interface AppSettingsFile {
  readonly apiKey?: string;
  readonly maxChurnThreshold?: number;
  readonly cliAgents?: CliAgentsSettings;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function normalizeAppSettingsFile(value: unknown): AppSettingsFile {
  if (!value || typeof value !== "object") {
    return {};
  }

  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  if (typeof obj["apiKey"] === "string") {
    result["apiKey"] = obj["apiKey"].trim();
  }

  if (typeof obj["maxChurnThreshold"] === "number" && obj["maxChurnThreshold"] >= 0) {
    result["maxChurnThreshold"] = Math.floor(obj["maxChurnThreshold"]);
  }

  if (obj["cliAgents"] && typeof obj["cliAgents"] === "object") {
    result["cliAgents"] = obj["cliAgents"];
  }

  return result as AppSettingsFile;
}

export async function readAppSettingsFile(): Promise<AppSettingsFile | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  try {
    const raw = await invokeTauri<string>("read_app_settings");
    if (!raw || raw.trim().length === 0) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    return normalizeAppSettingsFile(parsed);
  } catch {
    return null;
  }
}

export async function writeAppSettingsFile(patch: Partial<AppSettingsFile>): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    const currentRaw = await invokeTauri<string>("read_app_settings").catch(() => "");
    let current: Record<string, unknown> = {};

    if (currentRaw && currentRaw.trim().length > 0) {
      const parsed: unknown = JSON.parse(currentRaw);
      if (parsed && typeof parsed === "object") {
        current = parsed as Record<string, unknown>;
      }
    }

    const next: Record<string, unknown> = { ...current };

    if ("apiKey" in patch) {
      next["apiKey"] = patch.apiKey;
    }

    if ("maxChurnThreshold" in patch) {
      next["maxChurnThreshold"] = patch.maxChurnThreshold;
    }

    if ("cliAgents" in patch) {
      next["cliAgents"] = patch.cliAgents;
    }

    await invokeTauri<void>("write_app_settings", { content: JSON.stringify(next, null, 2) });
  } catch {
    // Non-critical — ignore write failures.
  }
}

/**
 * Reads settings.json via Tauri, syncs values to localStorage so existing
 * synchronous storage readers keep working, and returns the resolved values.
 */
export async function readAndSyncAppSettingsFile(): Promise<{
  readonly apiKey?: string;
  readonly maxChurnThreshold?: number;
  readonly cliAgents?: CliAgentsSettings;
}> {
  const settings = await readAppSettingsFile();
  if (!settings) {
    return {};
  }

  const result: {
    apiKey?: string;
    maxChurnThreshold?: number;
    cliAgents?: CliAgentsSettings;
  } = {};

  if (settings.apiKey !== undefined) {
    const trimmed = settings.apiKey.trim();
    if (trimmed.length > 0) {
      writeApiKeyToStorage(trimmed);
      result.apiKey = trimmed;
    }
  }

  if (settings.maxChurnThreshold !== undefined) {
    writeAiAnalysisConfigToStorage({ maxChurnThreshold: settings.maxChurnThreshold });
    result.maxChurnThreshold = settings.maxChurnThreshold;
  }

  if (settings.cliAgents !== undefined) {
    writeCliAgentsSettingsToStorage(settings.cliAgents as CliAgentsSettings);
    // Read back to get normalized data
    result.cliAgents = readCliAgentsSettingsFromStorage();
  }

  return result;
}
