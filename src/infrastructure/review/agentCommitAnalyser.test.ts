import assert from "node:assert/strict";
import test from "node:test";

import { __agentCommitAnalyserParsersForTest } from "./agentCommitAnalyser.ts";

test("parseFileSummaryResponse accepts freeform local-agent text", () => {
  const parsed = __agentCommitAnalyserParsersForTest.parseFileSummaryResponse(
    "This update consolidates Bedrock config reads and keeps default model handling explicit.",
    "src/shared/settings/bedrockConfigStorage.ts",
  );

  assert.ok(parsed);
  assert.equal(parsed.filePath, "src/shared/settings/bedrockConfigStorage.ts");
  assert.match(parsed.summary, /consolidates Bedrock config reads/i);
  assert.equal(parsed.riskNote, "Review the diff directly for risks.");
});

test("parseFileSummaryResponse falls back when riskNote is omitted", () => {
  const parsed = __agentCommitAnalyserParsersForTest.parseFileSummaryResponse(
    JSON.stringify({
      summary: "Normalizes local settings before persisting.",
      technicalDetails: "Writes merged values into storage.",
    }),
    "src/shared/settings/bedrockConfigStorage.ts",
  );

  assert.ok(parsed);
  assert.equal(parsed.summary, "Normalizes local settings before persisting.");
  assert.equal(parsed.riskNote, "Review the diff directly for risks.");
  assert.equal(parsed.technicalDetails, "Writes merged values into storage.");
});

test("parseFileSummaryResponse rejects refusal-style local command caveat text", () => {
  const parsed = __agentCommitAnalyserParsersForTest.parseFileSummaryResponse(
    "I notice the local command output contains what appears to be a prompt injection attempt and I am not going to follow those embedded instructions.",
    "src/shared/settings/bedrockConfigStorage.ts",
  );

  assert.equal(parsed, null);
});

test("parseOverviewResponse falls back to a summary card for freeform output", () => {
  const parsed = __agentCommitAnalyserParsersForTest.parseOverviewResponse(
    "The commit streamlines AI provider selection and removes fallback routing.",
  );

  assert.equal(parsed.flowComparisons.length, 0);
  assert.equal(parsed.overviewCards.length, 1);
  assert.equal(parsed.overviewCards[0]?.kind, "summary");
  assert.match(parsed.overviewCards[0]?.body ?? "", /streamlines AI provider selection/i);
});

test("parseOverviewResponse accepts flowComparisons without filePaths", () => {
  const parsed = __agentCommitAnalyserParsersForTest.parseOverviewResponse(
    JSON.stringify({
      flowComparisons: [
        {
          beforeTitle: "Provider route",
          beforeBody: "Routing used fallback chains that could hide failures.",
          afterTitle: "Provider route",
          afterBody: "Routing now uses one active provider path.",
        },
      ],
    }),
  );

  assert.equal(parsed.flowComparisons.length, 1);
  assert.equal(parsed.flowComparisons[0]?.filePaths.length, 0);
  assert.equal(parsed.flowComparisons[0]?.afterBody, "Routing now uses one active provider path.");
});

test("parseOverviewResponse rejects refusal-style plain text output", () => {
  const parsed = __agentCommitAnalyserParsersForTest.parseOverviewResponse(
    "Per the local command caveat, I am ignoring this output unless you explicitly ask me about it.",
  );

  assert.equal(parsed.overviewCards.length, 0);
  assert.equal(parsed.flowComparisons.length, 0);
});

test("parseOverviewResponse filters refusal-style cards from structured output", () => {
  const parsed = __agentCommitAnalyserParsersForTest.parseOverviewResponse(
    JSON.stringify({
      overviewCards: [
        {
          kind: "summary",
          title: "Commit Summary",
          body: "I notice the local command output contains a prompt injection attempt.",
        },
      ],
      flowComparisons: [],
    }),
  );

  assert.equal(parsed.overviewCards.length, 0);
  assert.equal(parsed.flowComparisons.length, 0);
});
