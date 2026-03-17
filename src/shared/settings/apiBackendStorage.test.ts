import assert from "node:assert/strict";
import test from "node:test";

import { readApiBackendFromStorage, type ApiBackend } from "./apiBackendStorage.ts";

const STORAGE_KEY = "codelens-api-backend";

function installMockLocalStorage(initial: ApiBackend | null): void {
  const storage = new Map<string, string>();
  if (initial !== null) {
    storage.set(STORAGE_KEY, initial);
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

test("readApiBackendFromStorage defaults to anthropic when storage is empty", () => {
  installMockLocalStorage(null);
  assert.equal(readApiBackendFromStorage(), "anthropic");
});

test("readApiBackendFromStorage returns bedrock when configured", () => {
  installMockLocalStorage("bedrock");
  assert.equal(readApiBackendFromStorage(), "bedrock");
});

test("readApiBackendFromStorage falls back to anthropic for invalid values", () => {
  installMockLocalStorage("anthropic");
  (globalThis.localStorage as Storage).setItem(STORAGE_KEY, "not-a-provider");
  assert.equal(readApiBackendFromStorage(), "anthropic");
});

