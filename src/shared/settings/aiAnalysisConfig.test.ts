import assert from "node:assert/strict";
import test from "node:test";

import {
  readAiAnalysisConfigFromStorage,
  writeAiAnalysisConfigToStorage,
} from "./aiAnalysisConfig.ts";

const STORAGE_KEY = "codelens-ai-analysis-config";

function installMockLocalStorage(initialValue?: unknown): void {
  const storage = new Map<string, string>();
  if (initialValue !== undefined) {
    storage.set(STORAGE_KEY, JSON.stringify(initialValue));
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

test("readAiAnalysisConfigFromStorage falls back to defaults", () => {
  installMockLocalStorage();

  const config = readAiAnalysisConfigFromStorage();

  assert.equal(config.maxChurnThreshold, 500);
  assert.equal(config.autoRunOnCommitChange, false);
});

test("readAiAnalysisConfigFromStorage migrates legacy config without autoRunOnCommitChange", () => {
  installMockLocalStorage({
    maxChurnThreshold: 250,
  });

  const config = readAiAnalysisConfigFromStorage();

  assert.equal(config.maxChurnThreshold, 250);
  assert.equal(config.autoRunOnCommitChange, false);
});

test("writeAiAnalysisConfigToStorage merges partial updates", () => {
  installMockLocalStorage({
    maxChurnThreshold: 400,
    autoRunOnCommitChange: false,
  });

  writeAiAnalysisConfigToStorage({
    autoRunOnCommitChange: true,
  });

  const config = readAiAnalysisConfigFromStorage();

  assert.equal(config.maxChurnThreshold, 400);
  assert.equal(config.autoRunOnCommitChange, true);
});
