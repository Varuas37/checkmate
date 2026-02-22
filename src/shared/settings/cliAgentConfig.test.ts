import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CLI_AGENTS,
  readCliAgentsSettingsFromStorage,
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

  assert.ok(codexAgent);
  assert.deepEqual(codexAgent.promptArgs, ["exec"]);
});

test("readCliAgentsSettingsFromStorage migrates legacy empty Codex args to exec", () => {
  installMockLocalStorage({
    agents: [{ id: "codex", name: "Codex CLI", command: "codex", promptArgs: [] }],
    activeAgentId: "codex",
    preferCliOverApi: true,
  });

  const settings = readCliAgentsSettingsFromStorage();
  const codexAgent = settings.agents.find((agent) => agent.id === "codex");

  assert.ok(codexAgent);
  assert.deepEqual(codexAgent.promptArgs, ["exec"]);
});

test("readCliAgentsSettingsFromStorage preserves explicit Codex prompt args", () => {
  installMockLocalStorage({
    agents: [{ id: "codex", name: "Codex CLI", command: "codex", promptArgs: ["review"] }],
    activeAgentId: "codex",
    preferCliOverApi: true,
  });

  const settings = readCliAgentsSettingsFromStorage();
  const codexAgent = settings.agents.find((agent) => agent.id === "codex");

  assert.ok(codexAgent);
  assert.deepEqual(codexAgent.promptArgs, ["review"]);
});
