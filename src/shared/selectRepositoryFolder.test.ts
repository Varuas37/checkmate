import assert from "node:assert/strict";
import test from "node:test";

import { selectRepositoryFolder } from "./selectRepositoryFolder.ts";

test("selectRepositoryFolder returns Tauri-selected path before web fallback", async () => {
  let webFallbackCalls = 0;

  const selected = await selectRepositoryFolder({
    selectWithTauriDialog: async () => "/Users/reviewer/repo",
    selectWithWebFallback: async () => {
      webFallbackCalls += 1;
      return "/fallback/repo";
    },
  });

  assert.equal(selected, "/Users/reviewer/repo");
  assert.equal(webFallbackCalls, 0);
});

test("selectRepositoryFolder uses web fallback when Tauri returns null", async () => {
  let webFallbackCalls = 0;

  const selected = await selectRepositoryFolder({
    selectWithTauriDialog: async () => null,
    selectWithWebFallback: async () => {
      webFallbackCalls += 1;
      return "/fallback/repo";
    },
  });

  assert.equal(selected, "/fallback/repo");
  assert.equal(webFallbackCalls, 1);
});

test("selectRepositoryFolder uses web fallback when Tauri selection throws", async () => {
  let webFallbackCalls = 0;

  const selected = await selectRepositoryFolder({
    selectWithTauriDialog: async () => {
      throw new Error("dialog unavailable");
    },
    selectWithWebFallback: async () => {
      webFallbackCalls += 1;
      return "/fallback/repo";
    },
  });

  assert.equal(selected, "/fallback/repo");
  assert.equal(webFallbackCalls, 1);
});
