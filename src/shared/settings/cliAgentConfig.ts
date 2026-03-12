const STORAGE_KEY = "codelens-cli-agents-settings";

export type AiProviderPreference = "api" | "local-agent";
export type LocalAgentTransport = "acp" | "cli";

export interface CliAgentConfig {
  readonly id: string;
  readonly name: string;
  /** Binary name or full path for the legacy CLI transport, e.g. "claude". */
  readonly command: string;
  /** Arguments inserted between the legacy CLI command and the prompt. */
  readonly promptArgs: readonly string[];
  /** Binary name or full path for the ACP adapter, e.g. "claude-agent-acp". */
  readonly acpCommand: string;
  /** Arguments passed to the ACP adapter command. */
  readonly acpArgs: readonly string[];
}

export interface CliAgentsSettings {
  readonly agents: readonly CliAgentConfig[];
  readonly activeAgentId: string | null;
  readonly preferredProvider: AiProviderPreference;
  readonly fallbackToSecondary: boolean;
  readonly localTransport: LocalAgentTransport;
}

const LEGACY_CLAUDE_ACP_COMMAND = "claude-code-acp";
const DEFAULT_CLAUDE_ACP_COMMAND = "claude-agent-acp";

export const DEFAULT_CLI_AGENTS: readonly CliAgentConfig[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    promptArgs: ["-p"],
    acpCommand: DEFAULT_CLAUDE_ACP_COMMAND,
    acpArgs: [],
  },
  // `codex exec` is the non-interactive mode suitable for app-driven prompts.
  {
    id: "codex",
    name: "Codex CLI",
    command: "codex",
    promptArgs: ["exec"],
    acpCommand: "codex-acp",
    acpArgs: [],
  },
];

const DEFAULT_SETTINGS: CliAgentsSettings = {
  agents: DEFAULT_CLI_AGENTS,
  activeAgentId: "codex",
  preferredProvider: "api",
  fallbackToSecondary: true,
  localTransport: "acp",
};

function defaultAcpCommandForAgent(id: string, command: string): string {
  const normalizedId = id.trim().toLowerCase();
  const normalizedCommand = command.trim().toLowerCase();

  if (normalizedId === "claude-code" || normalizedCommand === "claude") {
    return DEFAULT_CLAUDE_ACP_COMMAND;
  }

  if (normalizedId === "codex" || normalizedCommand === "codex") {
    return "codex-acp";
  }

  return "";
}

function normalizeAcpCommand(
  id: string,
  command: string,
  acpCommand: string,
): string {
  const normalizedId = id.trim().toLowerCase();
  const normalizedCommand = command.trim().toLowerCase();
  const normalizedAcpCommand = acpCommand.trim().toLowerCase();
  const isClaudeAgent =
    normalizedId === "claude-code" || normalizedCommand === "claude";

  if (normalizedAcpCommand.length === 0) {
    return defaultAcpCommandForAgent(id, command);
  }

  if (isClaudeAgent && normalizedAcpCommand === LEGACY_CLAUDE_ACP_COMMAND) {
    return DEFAULT_CLAUDE_ACP_COMMAND;
  }

  return acpCommand;
}

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
  const acpCommand =
    typeof obj["acpCommand"] === "string" ? obj["acpCommand"].trim() : "";
  const acpArgs = Array.isArray(obj["acpArgs"])
    ? (obj["acpArgs"] as unknown[]).filter((a): a is string => typeof a === "string")
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
    acpCommand: normalizeAcpCommand(id, command, acpCommand),
    acpArgs,
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

  const preferredProviderRaw =
    typeof obj["preferredProvider"] === "string" ? obj["preferredProvider"].trim() : "";
  const preferredProvider: AiProviderPreference =
    preferredProviderRaw === "local-agent" || preferredProviderRaw === "api"
      ? preferredProviderRaw
      : typeof obj["preferCliOverApi"] === "boolean" && obj["preferCliOverApi"]
        ? "local-agent"
        : DEFAULT_SETTINGS.preferredProvider;

  const fallbackToSecondary =
    typeof obj["fallbackToSecondary"] === "boolean"
      ? obj["fallbackToSecondary"]
      : DEFAULT_SETTINGS.fallbackToSecondary;

  const hasExplicitLocalTransport =
    obj["localTransport"] === "acp" || obj["localTransport"] === "cli";
  const activeAgent =
    (activeAgentId
      ? agents.find((agent) => agent.id === activeAgentId) ?? null
      : null) ??
    null;
  const localTransport: LocalAgentTransport = hasExplicitLocalTransport
    ? (obj["localTransport"] as LocalAgentTransport)
    : typeof obj["preferCliOverApi"] === "boolean"
      ? "cli"
      : activeAgent && activeAgent.acpCommand.trim().length === 0
        ? "cli"
        : DEFAULT_SETTINGS.localTransport;

  return {
    agents: agents.length > 0 ? agents : [...DEFAULT_CLI_AGENTS],
    activeAgentId,
    preferredProvider,
    fallbackToSecondary,
    localTransport,
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
  return readCliAgentsSettingsFromStorage().preferredProvider === "local-agent";
}

export function readPreferredProviderFromStorage(): AiProviderPreference {
  return readCliAgentsSettingsFromStorage().preferredProvider;
}

export function readLocalAgentTransportFromStorage(): LocalAgentTransport {
  return readCliAgentsSettingsFromStorage().localTransport;
}

export function readFallbackToSecondaryFromStorage(): boolean {
  return readCliAgentsSettingsFromStorage().fallbackToSecondary;
}
