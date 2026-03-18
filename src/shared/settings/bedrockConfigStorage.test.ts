import assert from "node:assert/strict";
import test from "node:test";

import {
  readBedrockConfigFromStorage,
  writeBedrockConfigToStorage,
} from "./bedrockConfigStorage.ts";

const STORAGE_KEY = "codelens-bedrock-config";

function installMockLocalStorage(initial: unknown): void {
  const storage = new Map<string, string>();
  if (initial !== null) {
    storage.set(STORAGE_KEY, JSON.stringify(initial));
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

test("readBedrockConfigFromStorage defaults when storage is empty", () => {
  installMockLocalStorage(null);
  const config = readBedrockConfigFromStorage();
  assert.equal(config.region, "us-west-2");
  assert.equal(config.modelId, "anthropic.claude-3-haiku-20240307-v1:0");
});

test("readBedrockConfigFromStorage normalizes values", () => {
  installMockLocalStorage({
    region: " us-east-1 ",
    modelId: " anthropic.claude-3-haiku-20240307-v1:0 ",
  });
  const config = readBedrockConfigFromStorage();
  assert.equal(config.region, "us-east-1");
  assert.equal(config.modelId, "anthropic.claude-3-haiku-20240307-v1:0");
});

test("writeBedrockConfigToStorage merges patches and returns the normalized value", () => {
  installMockLocalStorage({ region: "us-west-2", modelId: "" });

  const next = writeBedrockConfigToStorage({ modelId: "anthropic.claude-vX" });
  assert.equal(next.region, "us-west-2");
  assert.equal(next.modelId, "anthropic.claude-vX");

  const storedRaw = globalThis.localStorage.getItem(STORAGE_KEY);
  assert.ok(storedRaw);
  const stored = JSON.parse(storedRaw);
  assert.equal(stored.region, "us-west-2");
  assert.equal(stored.modelId, "anthropic.claude-vX");
});

test("readBedrockConfigFromStorage backfills default model id for legacy empty values", () => {
  installMockLocalStorage({ region: "us-east-1", modelId: "   " });
  const config = readBedrockConfigFromStorage();
  assert.equal(config.region, "us-east-1");
  assert.equal(config.modelId, "anthropic.claude-3-haiku-20240307-v1:0");
});
