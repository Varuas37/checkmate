import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewRootState } from "./models.ts";
import {
  createSelectFilteredFiles,
  selectActiveFile,
  selectResolvedActiveFileId,
} from "./selectors.ts";

function createStateFixture(): ReviewRootState {
  return {
    reviewEntities: {
      commitsById: {
        "commit-1": {
          id: "commit-1",
          repositoryPath: "/repo",
          commitSha: "abc123",
          shortSha: "abc123",
          title: "Title",
          description: "Desc",
          authorName: "Dev",
          authorEmail: "dev@example.com",
          authoredAtIso: "2026-02-22T17:00:00.000Z",
          parentCommitShas: ["parent-1"],
        },
      },
      commitIds: ["commit-1"],
      filesById: {
        "file-a": {
          id: "file-a",
          commitId: "commit-1",
          path: "src/application/review/selectors.ts",
          status: "modified",
          additions: 4,
          deletions: 1,
        },
        "file-b": {
          id: "file-b",
          commitId: "commit-1",
          path: "src/domain/review/entities.ts",
          status: "added",
          additions: 10,
          deletions: 0,
        },
      },
      fileIdsByCommitId: {
        "commit-1": ["file-a", "file-b"],
      },
      hunksById: {},
      hunkIdsByFileId: {},
      threadsById: {
        "thread-1": {
          id: "thread-1",
          commitId: "commit-1",
          fileId: "file-a",
          hunkId: "hunk-1",
          anchor: {
            fileId: "file-a",
            hunkId: "hunk-1",
            side: "new",
            lineNumber: 10,
          },
          messageIds: ["comment-1"],
          status: "open",
          createdAtIso: "2026-02-22T16:00:00.000Z",
          updatedAtIso: "2026-02-22T16:00:00.000Z",
        },
      },
      threadIdsByFileId: {
        "file-a": ["thread-1"],
      },
      commentsById: {
        "comment-1": {
          id: "comment-1",
          threadId: "thread-1",
          authorType: "human",
          authorId: "reviewer",
          body: "Question",
          createdAtIso: "2026-02-22T16:00:00.000Z",
          isDraft: false,
        },
      },
      commentIdsByThreadId: {
        "thread-1": ["comment-1"],
      },
      overviewCardsById: {},
      overviewCardIdsByCommitId: {},
      standardsRulesById: {},
      standardsRuleIds: [],
      standardsResultsById: {
        "result-1": {
          id: "result-1",
          commitId: "commit-1",
          ruleId: "rule-1",
          status: "fail",
          summary: "Failing check",
          evidence: [
            {
              fileId: "file-a",
              filePath: "src/application/review/selectors.ts",
              note: "Found issue",
            },
          ],
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
      activeFileId: "file-b",
      diffOrientation: "split",
      diffViewMode: "changes",
      fileFilter: {
        query: "",
        statuses: [],
        onlyCommented: true,
        onlyFailingStandards: false,
        threadStatus: "open",
      },
      askAgentDraftByThreadId: {},
      fileVersionsByFileId: {},
      fileVersionsLoadStatusByFileId: {},
      fileVersionsErrorByFileId: {},
      repositoryCommits: [],
      publishStatus: "idle",
      lastPublishPackage: null,
      publishResult: null,
      publishError: null,
      aiAnalysisStatus: "idle",
      aiAnalysis: null,
      aiAnalysisError: null,
      aiSequenceStatus: "idle",
      aiSequenceError: null,
      standardsAnalysisStatus: "idle",
      standardsAnalysisError: null,
    },
  };
}

test("createSelectFilteredFiles memoizes by state references", () => {
  const selector = createSelectFilteredFiles();
  const state = createStateFixture();

  const first = selector(state);
  const second = selector(state);

  assert.equal(first, second);
  assert.deepEqual(
    first.map((file) => file.id),
    ["file-a"],
  );
});

test("selectResolvedActiveFileId falls back when active file is filtered out", () => {
  const state = createStateFixture();

  const resolved = selectResolvedActiveFileId(state);
  const activeFile = selectActiveFile(state);

  assert.equal(resolved, "file-a");
  assert.equal(activeFile?.id, "file-a");
});
