import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewRootState } from "../models.ts";
import { createPublishReviewPackage } from "./publishPackage.ts";

function createStateFixture(): ReviewRootState {
  return {
    reviewEntities: {
      commitsById: {
        "commit-1": {
          id: "commit-1",
          repositoryPath: "/repo",
          commitSha: "abc123def456",
          shortSha: "abc123de",
          title: "Review MVP",
          description: "Adds review flow",
          authorName: "Dev",
          authorEmail: "dev@example.com",
          authoredAtIso: "2026-02-22T17:00:00.000Z",
          parentCommitShas: ["parent-1"],
        },
      },
      commitIds: ["commit-1"],
      filesById: {
        "file-2": {
          id: "file-2",
          commitId: "commit-1",
          path: "src/application/review/selectors.ts",
          status: "modified",
          additions: 8,
          deletions: 2,
        },
        "file-1": {
          id: "file-1",
          commitId: "commit-1",
          path: "src/domain/review/entities.ts",
          status: "added",
          additions: 30,
          deletions: 0,
        },
      },
      fileIdsByCommitId: {
        "commit-1": ["file-2", "file-1"],
      },
      hunksById: {
        "hunk-1": {
          id: "hunk-1",
          fileId: "file-1",
          header: "@@ -0,0 +1,10 @@",
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 10,
          lines: [],
        },
      },
      hunkIdsByFileId: {
        "file-1": ["hunk-1"],
      },
      threadsById: {
        "thread-1": {
          id: "thread-1",
          commitId: "commit-1",
          fileId: "file-1",
          hunkId: "hunk-1",
          anchor: {
            fileId: "file-1",
            hunkId: "hunk-1",
            side: "new",
            lineNumber: 3,
          },
          messageIds: ["comment-1"],
          status: "open",
          createdAtIso: "2026-02-22T18:00:00.000Z",
          updatedAtIso: "2026-02-22T18:00:00.000Z",
        },
      },
      threadIdsByFileId: {
        "file-1": ["thread-1"],
      },
      commentsById: {
        "comment-1": {
          id: "comment-1",
          threadId: "thread-1",
          authorType: "human",
          authorId: "reviewer-1",
          body: "Please explain this property.",
          createdAtIso: "2026-02-22T18:01:00.000Z",
          isDraft: false,
        },
      },
      commentIdsByThreadId: {
        "thread-1": ["comment-1"],
      },
      overviewCardsById: {
        "card-1": {
          id: "card-1",
          commitId: "commit-1",
          kind: "summary",
          title: "Summary",
          body: "Introduces core review model.",
          rank: 1,
        },
      },
      overviewCardIdsByCommitId: {
        "commit-1": ["card-1"],
      },
      standardsRulesById: {
        "rule-1": {
          id: "rule-1",
          title: "No any",
          description: "No any in application code",
          severity: "high",
        },
      },
      standardsRuleIds: ["rule-1"],
      standardsResultsById: {
        "result-1": {
          id: "result-1",
          commitId: "commit-1",
          ruleId: "rule-1",
          status: "pass",
          summary: "No any usage detected.",
          evidence: [],
        },
      },
      standardsResultIdsByCommitId: {
        "commit-1": ["result-1"],
      },
    },
    reviewUi: {
      loadStatus: "loaded",
      lastError: null,
      activeCommitId: "commit-1",
      activeFileId: "file-1",
      diffOrientation: "unified",
      diffViewMode: "changes",
      fileFilter: {
        query: "review",
        statuses: ["added", "modified"],
        onlyCommented: false,
        onlyFailingStandards: false,
        threadStatus: "all",
      },
      askAgentDraftByThreadId: {
        "thread-1": "Explain whether this type can be narrowed.",
      },
      fileVersionsByFileId: {},
      fileVersionsLoadStatusByFileId: {},
      fileVersionsErrorByFileId: {},
      repositoryCommits: [],
      publishStatus: "ready",
      lastPublishPackage: null,
      publishResult: null,
      publishError: null,
      aiAnalysisStatus: "idle",
      aiAnalysis: null,
      aiAnalysisError: null,
      aiSequenceStatus: "idle",
      aiSequenceError: null,
    },
  };
}

test("createPublishReviewPackage creates deterministic payload for active commit", () => {
  const pkg = createPublishReviewPackage({
    state: createStateFixture(),
    generatedAtIso: "2026-02-22T19:00:00.000Z",
  });

  assert.equal(pkg.schemaVersion, "review-publish.v1");
  assert.equal(pkg.commitId, "commit-1");
  assert.equal(pkg.commitSha, "abc123def456");
  assert.equal(pkg.files.length, 2);
  assert.equal(pkg.files[0]?.id, "file-2");
  assert.equal(pkg.files[1]?.id, "file-1");
  assert.equal(pkg.files[1]?.threads[0]?.askAgentDraft, "Explain whether this type can be narrowed.");
  assert.equal(pkg.standardsRules.length, 1);
  assert.equal(pkg.standardsResults.length, 1);
});

test("createPublishReviewPackage throws when no active commit is set", () => {
  const state = createStateFixture();
  state.reviewUi.activeCommitId = null;

  assert.throws(() => {
    createPublishReviewPackage({
      state,
      generatedAtIso: "2026-02-22T19:00:00.000Z",
    });
  }, /active commit/i);
});
