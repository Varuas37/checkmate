import assert from "node:assert/strict";
import test from "node:test";

import {
  readAiAnalysisFromStorage,
  writeAiAnalysisToStorage,
} from "./aiAnalysisCacheStorage.ts";

const STORAGE_KEY = "codelens-ai-analysis-cache.v1";

function installMockLocalStorage(rawValue: string | null = null): void {
  const storage = new Map<string, string>();
  if (rawValue !== null) {
    storage.set(STORAGE_KEY, rawValue);
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

test("write/read preserves standards rules and results in cached AI analysis", () => {
  installMockLocalStorage();

  writeAiAnalysisToStorage({
    repositoryPath: "/repo",
    commitSha: "abc123",
    analysis: {
      overviewCards: [{ kind: "summary", title: "Summary", body: "Body" }],
      flowComparisons: [],
      sequenceSteps: [],
      fileSummaries: [{ filePath: "src/file.ts", summary: "Changed", riskNote: "Low risk." }],
      standardsRules: [
        {
          id: "rule-1",
          title: "No any",
          description: "Avoid any in production code.",
          severity: "high",
        },
      ],
      standardsResults: [
        {
          id: "result-1",
          commitId: "commit-1",
          ruleId: "rule-1",
          status: "warn",
          summary: "One risky cast detected.",
          evidence: [{ filePath: "src/file.ts", lineNumber: 12, note: "Cast to any." }],
        },
      ],
    },
  });

  const cached = readAiAnalysisFromStorage({
    repositoryPath: "/repo",
    commitSha: "abc123",
  });

  assert.ok(cached);
  assert.equal(cached.standardsRules.length, 1);
  assert.equal(cached.standardsResults.length, 1);
  assert.equal(cached.standardsRules[0]?.id, "rule-1");
  assert.equal(cached.standardsResults[0]?.ruleId, "rule-1");
});

test("legacy cache entries without standards arrays normalize to empty standards data", () => {
  installMockLocalStorage(
    JSON.stringify([
      {
        key: "/repo::abc123",
        repositoryPath: "/repo",
        commitSha: "abc123",
        updatedAtIso: "2026-02-22T21:00:00.000Z",
        overviewCards: [{ kind: "summary", title: "Summary", body: "Body" }],
        flowComparisons: [],
        sequenceSteps: [],
        fileSummaries: [{ filePath: "src/file.ts", summary: "Changed", riskNote: "Low risk." }],
      },
    ]),
  );

  const cached = readAiAnalysisFromStorage({
    repositoryPath: "/repo",
    commitSha: "abc123",
  });

  assert.ok(cached);
  assert.deepEqual(cached.standardsRules, []);
  assert.deepEqual(cached.standardsResults, []);
});
