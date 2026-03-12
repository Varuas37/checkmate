import {
  readActiveCliAgentFromStorage,
  readFallbackToSecondaryFromStorage,
  readLocalAgentTransportFromStorage,
  readPreferredProviderFromStorage,
  runLocalAgentPrompt,
  type AiProviderPreference,
  type CliAgentConfig,
  type LocalAgentTransport,
} from "../../shared/index.ts";

export interface AiProviderState {
  readonly apiKey: string | null;
  readonly preferredProvider: AiProviderPreference;
  readonly fallbackToSecondary: boolean;
  readonly localAgent: CliAgentConfig | null;
  readonly localTransport: LocalAgentTransport;
}

export function resolveAiProviderState(apiKey: string | null): AiProviderState {
  return {
    apiKey,
    preferredProvider: readPreferredProviderFromStorage(),
    fallbackToSecondary: readFallbackToSecondaryFromStorage(),
    localAgent: readActiveCliAgentFromStorage(),
    localTransport: readLocalAgentTransportFromStorage(),
  };
}

export function shouldPreferLocalAgent(state: AiProviderState): boolean {
  return state.preferredProvider === "local-agent" && state.localAgent !== null;
}

export function canUseApiProvider(state: AiProviderState): boolean {
  return Boolean(state.apiKey);
}

export function canUseLocalAgent(state: AiProviderState): boolean {
  return state.localAgent !== null;
}

export function resolveSecondaryProvider(
  state: AiProviderState,
): AiProviderPreference | null {
  if (!state.fallbackToSecondary) {
    return null;
  }

  if (state.preferredProvider === "local-agent") {
    return canUseApiProvider(state) ? "api" : null;
  }

  return canUseLocalAgent(state) ? "local-agent" : null;
}

export async function runPreferredLocalAgentPrompt(
  prompt: string,
  repositoryPath?: string,
  state?: AiProviderState,
): Promise<string> {
  const resolvedState = state ?? resolveAiProviderState(null);
  if (!resolvedState.localAgent) {
    throw new Error("Select a local agent in Settings before running AI analysis.");
  }

  return runLocalAgentPrompt({
    prompt,
    ...(repositoryPath ? { repositoryPath } : {}),
    agent: resolvedState.localAgent,
    transport: resolvedState.localTransport,
  });
}
