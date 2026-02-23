import assert from "node:assert/strict";
import test from "node:test";

import type { ChangedFile, CommentThread, DiffHunk, ReviewComment } from "../../../domain/review/index.ts";
import { createAskAgentDraft } from "./askAgentDraft.ts";

const fileFixture: ChangedFile = {
  id: "file-1",
  commitId: "commit-1",
  path: "src/store/slices/agentAppControlSlice.ts",
  status: "modified",
  additions: 5,
  deletions: 2,
};

const hunkFixture: DiffHunk = {
  id: "hunk-1",
  fileId: "file-1",
  header: "@@ -20,6 +20,7 @@",
  oldStart: 20,
  oldLines: 6,
  newStart: 20,
  newLines: 7,
  lines: [],
};

const threadFixture: CommentThread = {
  id: "thread-1",
  commitId: "commit-1",
  fileId: "file-1",
  hunkId: "hunk-1",
  anchor: {
    fileId: "file-1",
    hunkId: "hunk-1",
    side: "new",
    lineNumber: 34,
  },
  messageIds: ["comment-1"],
  status: "open",
  createdAtIso: "2026-02-23T10:00:00.000Z",
  updatedAtIso: "2026-02-23T10:00:00.000Z",
};

const commentsFixture: readonly ReviewComment[] = [
  {
    id: "comment-1",
    threadId: "thread-1",
    authorType: "human",
    authorId: "reviewer",
    body: "Can you summarize what these new keys do?",
    createdAtIso: "2026-02-23T10:00:00.000Z",
    isDraft: false,
  },
];

test("createAskAgentDraft defaults to direct answer mode for normal questions", () => {
  const prompt = createAskAgentDraft({
    file: fileFixture,
    hunk: hunkFixture,
    thread: threadFixture,
    comments: commentsFixture,
    reviewerPrompt: "what are these btw what do they do?",
  });

  assert.match(prompt, /Answer the reviewer question directly/i);
  assert.match(prompt, /Potential bugs\/problems/i);
  assert.doesNotMatch(prompt, /Respond using this exact structure/i);
});

test("createAskAgentDraft uses strict bug-review mode when explicitly requested", () => {
  const prompt = createAskAgentDraft({
    file: fileFixture,
    hunk: hunkFixture,
    thread: threadFixture,
    comments: commentsFixture,
    reviewerPrompt: "Please find bugs or regressions in this change and suggest a patch.",
  });

  assert.match(prompt, /bug\/problem-focused review/i);
  assert.match(prompt, /Respond using this exact structure/i);
  assert.match(prompt, /1\. Root cause\./);
  assert.match(prompt, /2\. Risk\/impact\./);
  assert.match(prompt, /3\. Concrete patch suggestion\./);
});
