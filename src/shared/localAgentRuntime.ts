import {
  readActiveCliAgentFromStorage,
  readLocalAgentTransportFromStorage,
  type CliAgentConfig,
  type LocalAgentTransport,
} from "./settings/cliAgentConfig.ts";

interface InvokeArgs {
  readonly command: string;
  readonly args?: readonly string[];
  readonly prompt: string;
  readonly cwd?: string;
}

function trimToNull(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeArgs(args: readonly string[]): string[] {
  return args
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0);
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

async function runCliAgentPrompt(input: InvokeArgs): Promise<string> {
  const output = await invokeTauri<string>("run_cli_agent_prompt", {
    command: input.command,
    args: [...(input.args ?? [])],
    prompt: input.prompt,
  });

  return output.trim();
}

async function runAcpAgentPrompt(input: InvokeArgs): Promise<string> {
  const output = await invokeTauri<string>("run_acp_agent_prompt", {
    command: input.command,
    args: [...(input.args ?? [])],
    prompt: input.prompt,
    ...(input.cwd ? { cwd: input.cwd } : {}),
  });

  return output.trim();
}

export interface RunLocalAgentPromptInput {
  readonly prompt: string;
  readonly repositoryPath?: string;
  readonly agent?: CliAgentConfig | null;
  readonly transport?: LocalAgentTransport;
}

export async function runLocalAgentPrompt(
  input: RunLocalAgentPromptInput,
): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error("Local-agent execution is available only in the desktop app.");
  }

  const agent = input.agent ?? readActiveCliAgentFromStorage();
  if (!agent) {
    throw new Error("Select a local agent in Settings before running AI analysis.");
  }

  const transport = input.transport ?? readLocalAgentTransportFromStorage();
  const normalizedPrompt = trimToNull(input.prompt);
  if (!normalizedPrompt) {
    throw new Error("Local-agent prompt cannot be empty.");
  }

  if (transport === "acp") {
    const acpCommand = trimToNull(agent.acpCommand);
    if (!acpCommand) {
      throw new Error(`ACP command is not configured for ${agent.name}.`);
    }

    const normalizedRepositoryPath = trimToNull(input.repositoryPath);
    return runAcpAgentPrompt({
      command: acpCommand,
      args: normalizeArgs(agent.acpArgs),
      prompt: normalizedPrompt,
      ...(normalizedRepositoryPath ? { cwd: normalizedRepositoryPath } : {}),
    });
  }

  const cliCommand = trimToNull(agent.command);
  if (!cliCommand) {
    throw new Error(`CLI command is not configured for ${agent.name}.`);
  }

  return runCliAgentPrompt({
    command: cliCommand,
    args: normalizeArgs(agent.promptArgs),
    prompt: normalizedPrompt,
  });
}

export async function clearLocalAgentSessions(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invokeTauri<void>("clear_acp_agent_sessions");
}
