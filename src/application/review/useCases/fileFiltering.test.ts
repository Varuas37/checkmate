import assert from "node:assert/strict";
import test from "node:test";

import type { ChangedFile, CommentThread } from "../../../domain/review/index.ts";
import { applyFileFilter } from "./fileFiltering.ts";

function createFixtureFiles(): readonly ChangedFile[] {
  return [
    {
      id: "file-1",
      commitId: "commit-1",
      path: "src/application/review/selectors.ts",
      status: "modified",
      additions: 12,
      deletions: 4,
    },
    {
      id: "file-2",
      commitId: "commit-1",
      path: "src/interface/components/ReviewPanel.tsx",
      status: "added",
      additions: 40,
      deletions: 0,
    },
    {
      id: "file-3",
      commitId: "commit-1",
      path: "src/domain/review/entities.ts",
      status: "deleted",
      additions: 0,
      deletions: 20,
    },
  ];
}

const threadFixture: Record<string, CommentThread> = {
  "thread-1": {
    id: "thread-1",
    commitId: "commit-1",
    fileId: "file-1",
    hunkId: "hunk-1",
    anchor: {
      fileId: "file-1",
      hunkId: "hunk-1",
      side: "new",
      lineNumber: 12,
    },
    messageIds: ["comment-1"],
    status: "open",
    createdAtIso: "2026-02-22T16:00:00.000Z",
    updatedAtIso: "2026-02-22T16:00:00.000Z",
  },
};

test("applyFileFilter filters by query and status", () => {
  const filtered = applyFileFilter({
    files: createFixtureFiles(),
    filter: {
      query: "selectors",
      statuses: ["modified"],
      onlyCommented: false,
      onlyFailingStandards: false,
      threadStatus: "all",
    },
    threadIdsByFileId: {
      "file-1": ["thread-1"],
    },
    threadsById: threadFixture,
    failingFileIds: new Set(),
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, "file-1");
});

test("applyFileFilter supports onlyCommented and thread status", () => {
  const filtered = applyFileFilter({
    files: createFixtureFiles(),
    filter: {
      query: "",
      statuses: [],
      onlyCommented: true,
      onlyFailingStandards: false,
      threadStatus: "open",
    },
    threadIdsByFileId: {
      "file-1": ["thread-1"],
      "file-2": [],
    },
    threadsById: threadFixture,
    failingFileIds: new Set(),
  });

  assert.deepEqual(
    filtered.map((file) => file.id),
    ["file-1"],
  );
});

test("applyFileFilter supports onlyFailingStandards", () => {
  const filtered = applyFileFilter({
    files: createFixtureFiles(),
    filter: {
      query: "",
      statuses: [],
      onlyCommented: false,
      onlyFailingStandards: true,
      threadStatus: "all",
    },
    threadIdsByFileId: {},
    threadsById: {},
    failingFileIds: new Set(["file-3"]),
  });

  assert.deepEqual(
    filtered.map((file) => file.id),
    ["file-3"],
  );
});
