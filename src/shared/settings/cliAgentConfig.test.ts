import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CLI_AGENTS,
  readCliAgentsSettingsFromStorage,
  readFallbackToSecondaryFromStorage,
  readLocalAgentTransportFromStorage,
  readPreferredProviderFromStorage,
  type CliAgentsSettings,
} from "./cliAgentConfig.ts";

const STORAGE_KEY = "codelens-cli-agents-settings";

function installMockLocalStorage(initialSettings: CliAgentsSettings | null): void {
  const storage = new Map<string, string>();
  if (initialSettings) {
    storage.set(STORAGE_KEY, JSON.stringify(initialSettings));
  }

  const localStorageMock: Storage = {
    get length() {
      return storage.size;
    },
    clear() {
      storage.clear();
    },
    getItem(key: string) {
      return storage.has(key) ? storage.get(key) ?? null : null;
    },
    key(index: number) {
      return [...storage.keys()][index] ?? null;
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    setItem(key: string, value: string) {
      storage.set(key, String(value));
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: localStorageMock,
  });
}

test("DEFAULT_CLI_AGENTS configures Codex for non-interactive execution", () => {
  const codexAgent = DEFAULT_CLI_AGENTS.find((agent) => agent.id === "codex");
  const claudeAgent = DEFAULT_CLI_AGENTS.find((agent) => agent.id === "claude-code");

  assert.ok(claudeAgent);
  assert.ok(codexAgent);
  assert.equal(claudeAgent.acpCommand, "claude-agent-acp");
  assert.deepEqual(codexAgent.promptArgs, ["exec"]);
  assert.equal(codexAgent.acpCommand, "codex-acp");
});

test("readCliAgentsSettingsFromStorage migrates legacy Claude ACP command", () => {
  installMockLocalStorage({
    agents: [
      {
        id: "claude-code",
        name: "Claude Code",
        command: "claude",
        promptArgs: ["-p"],
        acpCommand: "claude-code-acp",
        acpArgs: [],
      },
    ],
    activeAgentId: "claude-code",
    preferredProvider: "local-agent",
    fallbackToSecondary: true,
    localTransport: "acp",
  });

  const settings = readCliAgentsSettingsFromStorage();
  const claudeAgent = settings.agents.find((agent) => agent.id === "claude-code");

  assert.ok(claudeAgent);
  assert.equal(claudeAgent.acpCommand, "claude-agent-acp");
});

test("readCliAgentsSettingsFromStorage migrates legacy empty Codex args to exec", () => {
  installMockLocalStorage({
    agents: [{ id: "codex", name: "Codex CLI", command: "codex", promptArgs: [] }] as unknown as
      readonly CliAgentsSettings["agents"][number][],
    activeAgentId: "codex",
    preferredProvider: "local-agent",
    fallbackToSecondary: true,
    localTransport: "acp",
  });

  const settings = readCliAgentsSettingsFromStorage();
  const codexAgent = settings.agents.find((agent) => agent.id === "codex");

  assert.ok(codexAgent);
  assert.deepEqual(codexAgent.promptArgs, ["exec"]);
  assert.equal(codexAgent.acpCommand, "codex-acp");
});

test("readCliAgentsSettingsFromStorage preserves explicit Codex prompt args", () => {
  installMockLocalStorage({
    agents: [
      {
        id: "codex",
        name: "Codex CLI",
        command: "codex",
        promptArgs: ["review"],
        acpCommand: "custom-codex-acp",
        acpArgs: ["--stdio"],
      },
    ],
    activeAgentId: "codex",
    preferredProvider: "local-agent",
    fallbackToSecondary: true,
    localTransport: "acp",
  });

  const settings = readCliAgentsSettingsFromStorage();
  const codexAgent = settings.agents.find((agent) => agent.id === "codex");

  assert.ok(codexAgent);
  assert.deepEqual(codexAgent.promptArgs, ["review"]);
  assert.equal(codexAgent.acpCommand, "custom-codex-acp");
  assert.deepEqual(codexAgent.acpArgs, ["--stdio"]);
});

test("readCliAgentsSettingsFromStorage migrates legacy preferCliOverApi to local provider with cli transport", () => {
  installMockLocalStorage({
    agents: [{ id: "codex", name: "Codex CLI", command: "codex", promptArgs: [] }],
    activeAgentId: "codex",
    preferCliOverApi: true,
  } as unknown as CliAgentsSettings);

  assert.equal(readPreferredProviderFromStorage(), "local-agent");
  assert.equal(readLocalAgentTransportFromStorage(), "cli");
  assert.equal(readFallbackToSecondaryFromStorage(), true);
});
