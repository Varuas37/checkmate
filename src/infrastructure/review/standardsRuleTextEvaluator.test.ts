import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateStandardsFromRuleText,
  parseStandardsRulesFromText,
} from "./standardsRuleTextEvaluator.ts";

test("parseStandardsRulesFromText parses list-based rule text", () => {
  const rules = parseStandardsRulesFromText(`
1. No any in domain and application code.
2. Avoid console.log in committed code.
- Tests should be updated for behavior changes.
`);

  assert.equal(rules.length, 3);
  assert.equal(rules[0]?.id, "rule-1");
  assert.equal(rules[1]?.severity, "medium");
});

test("evaluateStandardsFromRuleText flags any usage in added lines", () => {
  const evaluation = evaluateStandardsFromRuleText({
    commitId: "commit-1",
    ruleText: "1. No any in TypeScript files.",
    files: [
      {
        id: "file-1",
        commitId: "commit-1",
        path: "src/application/review/selectors.ts",
        status: "modified",
        additions: 3,
        deletions: 0,
      },
    ],
    hunks: [
      {
        id: "hunk-1",
        fileId: "file-1",
        header: "@@ -1,2 +1,5 @@",
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 5,
        lines: [
          {
            kind: "add",
            newLineNumber: 2,
            text: "const payload: any = data;",
          },
        ],
      },
    ],
  });

  assert.equal(evaluation.rules.length, 1);
  assert.equal(evaluation.results.length, 1);
  assert.equal(evaluation.results[0]?.status, "fail");
  assert.equal(evaluation.results[0]?.evidence[0]?.fileId, "file-1");
});

test("evaluateStandardsFromRuleText warns when test rule has no changed tests", () => {
  const evaluation = evaluateStandardsFromRuleText({
    commitId: "commit-1",
    ruleText: "1. Tests should be added for behavior changes.",
    files: [
      {
        id: "file-1",
        commitId: "commit-1",
        path: "src/domain/review/entities.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
      },
    ],
    hunks: [],
  });

  assert.equal(evaluation.results[0]?.status, "warn");
});
