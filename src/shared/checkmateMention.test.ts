import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCheckmateMentionSuggestion,
  getCheckmateMentionSuggestion,
  hasCheckmateMention,
  splitTextByCheckmateMention,
  stripCheckmateMentions,
} from "./checkmateMention.ts";

test("detects @checkmate with and without a space", () => {
  assert.equal(hasCheckmateMention("@checkmate please review"), true);
  assert.equal(hasCheckmateMention("@ checkmate please review"), true);
  assert.equal(hasCheckmateMention("please review"), false);
});

test("strips @checkmate mention tokens", () => {
  assert.equal(stripCheckmateMentions("@checkmate review this"), "review this");
  assert.equal(stripCheckmateMentions("please @ checkmate review this"), "please review this");
});

test("returns suggestion for trailing mention query", () => {
  const suggestion = getCheckmateMentionSuggestion("hey @chec");
  assert.ok(suggestion);
  const updated = applyCheckmateMentionSuggestion("hey @chec", suggestion);
  assert.equal(updated, "hey @checkmate ");
});

test("splits mention tokens for decorated rendering", () => {
  const segments = splitTextByCheckmateMention("ping @checkmate now");
  assert.deepEqual(
    segments.map((segment) => segment.kind),
    ["text", "mention", "text"],
  );
});
