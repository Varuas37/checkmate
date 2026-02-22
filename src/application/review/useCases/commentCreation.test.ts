import assert from "node:assert/strict";
import test from "node:test";

import { createCommentThread } from "./commentCreation.ts";

test("createCommentThread creates open thread with first draft comment", () => {
  let idCounter = 0;

  const created = createCommentThread(
    {
      commitId: "commit-1",
      fileId: "file-1",
      hunkId: "hunk-1",
      side: "new",
      lineNumber: 42,
      body: "   Please simplify this branch.  ",
      authorId: "reviewer-1",
    },
    {
      createId: () => {
        idCounter += 1;
        return `id-${idCounter}`;
      },
      nowIso: () => "2026-02-22T18:00:00.000Z",
    },
  );

  assert.equal(created.thread.id, "id-1");
  assert.equal(created.firstComment.id, "id-2");
  assert.equal(created.thread.status, "open");
  assert.deepEqual(created.thread.messageIds, ["id-2"]);
  assert.equal(created.firstComment.body, "Please simplify this branch.");
  assert.equal(created.firstComment.isDraft, true);
});

test("createCommentThread rejects empty comment body", () => {
  assert.throws(() => {
    createCommentThread(
      {
        commitId: "commit-1",
        fileId: "file-1",
        hunkId: "hunk-1",
        side: "new",
        lineNumber: 10,
        body: "    ",
        authorId: "reviewer-1",
      },
      {
        createId: () => "id",
        nowIso: () => "2026-02-22T18:00:00.000Z",
      },
    );
  }, /cannot be empty/i);
});
