const STORAGE_KEY = "codelens-cli-agents-settings";

export interface CliAgentConfig {
  readonly id: string;
  readonly name: string;
  /** Binary name or full path, e.g. "claude" or "/usr/local/bin/gemini" */
  readonly command: string;
  /** Arguments inserted between the command and the prompt, e.g. ["-p"] for claude */
  readonly promptArgs: readonly string[];
}

export interface CliAgentsSettings {
  readonly agents: readonly CliAgentConfig[];
  readonly activeAgentId: string | null;
  /** When true, the active CLI agent is tried before the Anthropic SDK API. */
  readonly preferCliOverApi: boolean;
}

export const DEFAULT_CLI_AGENTS: readonly CliAgentConfig[] = [
  { id: "claude-code", name: "Claude Code", command: "claude", promptArgs: ["-p"] },
  // `codex exec` is the non-interactive mode suitable for app-driven prompts.
  { id: "codex", name: "Codex CLI", command: "codex", promptArgs: ["exec"] },
  { id: "gemini", name: "Gemini CLI", command: "gemini", promptArgs: [] },
];

const DEFAULT_SETTINGS: CliAgentsSettings = {
  agents: DEFAULT_CLI_AGENTS,
  activeAgentId: null,
  preferCliOverApi: false,
};

function normalizeCliAgentConfig(value: unknown): CliAgentConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const obj = value as Record<string, unknown>;
  const id = typeof obj["id"] === "string" ? obj["id"].trim() : "";
  const name = typeof obj["name"] === "string" ? obj["name"].trim() : "";
  const command = typeof obj["command"] === "string" ? obj["command"].trim() : "";
  const promptArgs = Array.isArray(obj["promptArgs"])
    ? (obj["promptArgs"] as unknown[]).filter((a): a is string => typeof a === "string")
    : [];

  if (id.length === 0 || command.length === 0) {
    return null;
  }

  const normalizedCommand = command.toLowerCase();
  const normalizedPromptArgs =
    promptArgs.length > 0
      ? promptArgs
      : normalizedCommand === "codex" || id === "codex"
        ? ["exec"]
        : normalizedCommand === "claude" || id === "claude-code"
          ? ["-p"]
          : [];

  return {
    id,
    name: name.length > 0 ? name : id,
    command,
    promptArgs: normalizedPromptArgs,
  };
}

function normalizeCliAgentsSettings(value: unknown): CliAgentsSettings {
  if (!value || typeof value !== "object") {
    return DEFAULT_SETTINGS;
  }

  const obj = value as Record<string, unknown>;

  const rawAgents = Array.isArray(obj["agents"]) ? obj["agents"] : null;
  const agents: CliAgentConfig[] = rawAgents
    ? rawAgents
        .map((a) => normalizeCliAgentConfig(a))
        .filter((a): a is CliAgentConfig => a !== null)
    : [...DEFAULT_CLI_AGENTS];

  const activeAgentId =
    typeof obj["activeAgentId"] === "string" ? obj["activeAgentId"].trim() || null : null;

  const preferCliOverApi =
    typeof obj["preferCliOverApi"] === "boolean" ? obj["preferCliOverApi"] : false;

  return {
    agents: agents.length > 0 ? agents : [...DEFAULT_CLI_AGENTS],
    activeAgentId,
    preferCliOverApi,
  };
}

export function readCliAgentsSettingsFromStorage(): CliAgentsSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }

    const parsed: unknown = JSON.parse(raw);
    return normalizeCliAgentsSettings(parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeCliAgentsSettingsToStorage(settings: CliAgentsSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore write failures (private mode/storage quota).
  }
}

export function readActiveCliAgentFromStorage(): CliAgentConfig | null {
  const settings = readCliAgentsSettingsFromStorage();
  if (!settings.activeAgentId) {
    return null;
  }

  return settings.agents.find((a) => a.id === settings.activeAgentId) ?? null;
}

export function readCliPreferenceFromStorage(): boolean {
  return readCliAgentsSettingsFromStorage().preferCliOverApi;
}
