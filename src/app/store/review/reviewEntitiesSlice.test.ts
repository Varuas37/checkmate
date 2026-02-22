import assert from "node:assert/strict";
import test from "node:test";

import type { CommitReviewAggregate, ReviewComment } from "../../../domain/review/index.ts";
import { reviewEntitiesActions, reviewEntitiesReducer } from "./reviewEntitiesSlice.ts";

function createAggregateFixture(comments: readonly ReviewComment[]): CommitReviewAggregate {
  return {
    commit: {
      id: "commit-1",
      repositoryPath: "/repo",
      commitSha: "abc123",
      shortSha: "abc123",
      title: "Fixture commit",
      description: "Reducer behavior fixture",
      authorName: "Reviewer",
      authorEmail: "reviewer@example.com",
      authoredAtIso: "2026-02-22T00:00:00.000Z",
      parentCommitShas: ["parent-1"],
    },
    files: [
      {
        id: "file-1",
        commitId: "commit-1",
        path: "src/interface/review/components/DiffViewer.tsx",
        status: "modified",
        additions: 10,
        deletions: 3,
      },
    ],
    hunks: [
      {
        id: "hunk-1",
        fileId: "file-1",
        header: "@@ -10,1 +10,2 @@",
        oldStart: 10,
        oldLines: 1,
        newStart: 10,
        newLines: 2,
        lines: [],
      },
    ],
    threads: [
      {
        id: "thread-1",
        commitId: "commit-1",
        fileId: "file-1",
        hunkId: "hunk-1",
        anchor: {
          fileId: "file-1",
          hunkId: "hunk-1",
          side: "new",
          lineNumber: 10,
        },
        messageIds: comments.map((comment) => comment.id),
        status: "open",
        createdAtIso: "2026-02-22T00:00:00.000Z",
        updatedAtIso: "2026-02-22T00:00:00.000Z",
      },
    ],
    comments,
    overviewCards: [],
    standardsRules: [],
    standardsResults: [],
  };
}

test("commentDeleted removes one comment but preserves thread when comments remain", () => {
  const comments: readonly ReviewComment[] = [
    {
      id: "comment-1",
      threadId: "thread-1",
      authorType: "human",
      authorId: "reviewer-1",
      body: "First comment",
      createdAtIso: "2026-02-22T00:00:01.000Z",
      isDraft: false,
    },
    {
      id: "comment-2",
      threadId: "thread-1",
      authorType: "human",
      authorId: "reviewer-1",
      body: "Second comment",
      createdAtIso: "2026-02-22T00:00:02.000Z",
      isDraft: false,
    },
  ];

  const hydrated = reviewEntitiesReducer(
    undefined,
    reviewEntitiesActions.hydrateFromAggregate(createAggregateFixture(comments)),
  );
  const next = reviewEntitiesReducer(
    hydrated,
    reviewEntitiesActions.commentDeleted({
      commentId: "comment-1",
    }),
  );

  assert.equal(next.commentsById["comment-1"], undefined);
  assert.equal(next.commentsById["comment-2"]?.body, "Second comment");
  assert.deepEqual(next.commentIdsByThreadId["thread-1"], ["comment-2"]);
  assert.deepEqual(next.threadsById["thread-1"]?.messageIds, ["comment-2"]);
  assert.deepEqual(next.threadIdsByFileId["file-1"], ["thread-1"]);
});

test("commentDeleted removes thread when deleting its last comment", () => {
  const comments: readonly ReviewComment[] = [
    {
      id: "comment-1",
      threadId: "thread-1",
      authorType: "human",
      authorId: "reviewer-1",
      body: "Only comment",
      createdAtIso: "2026-02-22T00:00:01.000Z",
      isDraft: false,
    },
  ];

  const hydrated = reviewEntitiesReducer(
    undefined,
    reviewEntitiesActions.hydrateFromAggregate(createAggregateFixture(comments)),
  );
  const next = reviewEntitiesReducer(
    hydrated,
    reviewEntitiesActions.commentDeleted({
      commentId: "comment-1",
    }),
  );

  assert.equal(next.commentsById["comment-1"], undefined);
  assert.equal(next.commentIdsByThreadId["thread-1"], undefined);
  assert.equal(next.threadsById["thread-1"], undefined);
  assert.equal(next.threadIdsByFileId["file-1"], undefined);
});
