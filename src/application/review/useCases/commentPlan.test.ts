import assert from "node:assert/strict";
import test from "node:test";

import type { PublishReviewPackage } from "../models.ts";
import { createCommentThreadPlanMarkdown } from "./commentPlan.ts";

function createPackageFixture(): PublishReviewPackage {
  return {
    schemaVersion: "review-publish.v1",
    commitId: "commit-1",
    commitSha: "abc123def456",
    generatedAtIso: "2026-03-05T18:30:00.000Z",
    diffOrientation: "unified",
    fileFilter: {
      query: "",
      statuses: ["modified"],
      onlyCommented: true,
      onlyFailingStandards: false,
      threadStatus: "all",
    },
    overviewCards: [],
    standardsRules: [],
    standardsResults: [],
    files: [
      {
        id: "file-b",
        path: "src/beta.ts",
        status: "modified",
        additions: 5,
        deletions: 2,
        threads: [
          {
            id: "thread-resolved",
            fileId: "file-b",
            hunkId: "hunk-2",
            lineNumber: 20,
            side: "new",
            status: "resolved",
            comments: [
              {
                id: "comment-3",
                authorType: "human",
                authorId: "reviewer",
                body: "This is already fixed.",
                createdAtIso: "2026-03-05T17:20:00.000Z",
                isDraft: false,
              },
            ],
          },
        ],
      },
      {
        id: "file-a",
        path: "src/alpha.ts",
        status: "modified",
        additions: 10,
        deletions: 1,
        threads: [
          {
            id: "thread-open",
            fileId: "file-a",
            hunkId: "hunk-1",
            lineNumber: 42,
            side: "old",
            status: "open",
            comments: [
              {
                id: "comment-1",
                authorType: "human",
                authorId: "reviewer",
                body: "Please validate null handling before indexing.",
                createdAtIso: "2026-03-05T17:00:00.000Z",
                isDraft: false,
              },
              {
                id: "comment-2",
                authorType: "agent",
                authorId: "checkmate",
                body: "Acknowledged. I will add a guard and tests.",
                createdAtIso: "2026-03-05T17:10:00.000Z",
                isDraft: false,
              },
            ],
          },
        ],
      },
    ],
  };
}

test("createCommentThreadPlanMarkdown prioritizes open threads and includes context", () => {
  const markdown = createCommentThreadPlanMarkdown(createPackageFixture());

  assert.match(markdown, /# Comment Thread Plan/);
  assert.match(markdown, /Commit: `abc123def456`/);
  assert.match(markdown, /Threads: 2 total \(1 open, 1 resolved\)/);
  assert.match(markdown, /### 1\. src\/alpha\.ts:42 \(old\)/);
  assert.match(markdown, /### 2\. src\/beta\.ts:20 \(new\)/);
  assert.match(markdown, /Requested change: Please validate null handling before indexing\./);
  assert.match(markdown, /Reviewer reviewer/);
  assert.match(markdown, /Agent checkmate/);

  const firstIndex = markdown.indexOf("### 1. src/alpha.ts:42 (old)");
  const secondIndex = markdown.indexOf("### 2. src/beta.ts:20 (new)");
  assert.ok(firstIndex >= 0 && secondIndex > firstIndex);
});

test("createCommentThreadPlanMarkdown handles commits without threads", () => {
  const fixture = createPackageFixture();
  const noThreadsFixture: PublishReviewPackage = {
    ...fixture,
    files: fixture.files.map((file) => ({
      ...file,
      threads: [],
    })),
  };

  const markdown = createCommentThreadPlanMarkdown(noThreadsFixture);
  assert.match(markdown, /No comment threads were found for this commit\./);
});
