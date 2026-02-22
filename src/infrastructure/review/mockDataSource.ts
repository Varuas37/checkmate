import type {
  ChangedFile,
  CommentThread,
  CommitReviewAggregate,
  CommitReviewDataSource,
  DiffHunk,
  LoadCommitReviewInput,
  OverviewCard,
  ReviewComment,
} from "../../domain/review/index.ts";

function createMockFiles(commitId: string): readonly ChangedFile[] {
  return [
    {
      id: "file-src-review-store",
      commitId,
      path: "src/app/store/review/reviewStore.ts",
      status: "added",
      additions: 88,
      deletions: 0,
    },
    {
      id: "file-src-review-selectors",
      commitId,
      path: "src/application/review/selectors.ts",
      status: "modified",
      additions: 42,
      deletions: 12,
    },
  ];
}

function createMockHunks(files: readonly ChangedFile[]): readonly DiffHunk[] {
  const firstFile = files[0];
  const secondFile = files[1];

  if (!firstFile || !secondFile) {
    return [];
  }

  return [
    {
      id: "hunk-1",
      fileId: firstFile.id,
      header: "@@ -0,0 +1,88 @@",
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 88,
      lines: [
        {
          kind: "add",
          newLineNumber: 1,
          text: "import { configureStore } from '@reduxjs/toolkit';",
        },
      ],
    },
    {
      id: "hunk-2",
      fileId: secondFile.id,
      header: "@@ -10,7 +10,18 @@",
      oldStart: 10,
      oldLines: 7,
      newStart: 10,
      newLines: 18,
      lines: [
        {
          kind: "context",
          oldLineNumber: 10,
          newLineNumber: 10,
          text: "export function selectFilesForActiveCommit() {",
        },
        {
          kind: "add",
          newLineNumber: 13,
          text: "  return memoizedFilteredFiles;",
        },
      ],
    },
  ];
}

function createMockThreads(commitId: string, files: readonly ChangedFile[]): readonly CommentThread[] {
  const secondFile = files[1];

  if (!secondFile) {
    return [];
  }

  return [
    {
      id: "thread-1",
      commitId,
      fileId: secondFile.id,
      hunkId: "hunk-2",
      anchor: {
        fileId: secondFile.id,
        hunkId: "hunk-2",
        side: "new",
        lineNumber: 13,
      },
      messageIds: ["comment-1"],
      status: "open",
      createdAtIso: "2026-02-22T17:00:00.000Z",
      updatedAtIso: "2026-02-22T17:00:00.000Z",
    },
  ];
}

function createMockComments(): readonly ReviewComment[] {
  return [
    {
      id: "comment-1",
      threadId: "thread-1",
      authorType: "human",
      authorId: "reviewer-1",
      body: "Can we avoid recomputing this per render?",
      createdAtIso: "2026-02-22T17:00:00.000Z",
      isDraft: true,
    },
  ];
}

function createMockOverviewCards(commitId: string): readonly OverviewCard[] {
  return [
    {
      id: "card-1",
      commitId,
      kind: "summary",
      title: "Review workflow scaffolding",
      body: "Introduces first pass of review state orchestration and selectors.",
      rank: 1,
    },
    {
      id: "card-2",
      commitId,
      kind: "risk",
      title: "Listener sequencing",
      body: "Ensure async listeners dispatch deterministic state transitions.",
      rank: 2,
    },
  ];
}

function createMockAggregate(input: LoadCommitReviewInput): CommitReviewAggregate {
  const commitId = `commit-${input.commitSha}`;
  const files = createMockFiles(commitId);

  return {
    commit: {
      id: commitId,
      repositoryPath: input.repositoryPath,
      commitSha: input.commitSha,
      shortSha: input.commitSha.slice(0, 8),
      title: "Introduce review MVP domain flow",
      description: "Adds entities, selectors, and listener orchestration for review sessions.",
      authorName: "Codex",
      authorEmail: "codex@example.com",
      authoredAtIso: "2026-02-22T16:45:00.000Z",
      parentCommitShas: ["parent-0001"],
    },
    files,
    hunks: createMockHunks(files),
    threads: createMockThreads(commitId, files),
    comments: createMockComments(),
    overviewCards: createMockOverviewCards(commitId),
    standardsRules: [],
    standardsResults: [],
  };
}

export class MockCommitReviewDataSource implements CommitReviewDataSource {
  async loadCommitReview(input: LoadCommitReviewInput): Promise<CommitReviewAggregate> {
    return createMockAggregate(input);
  }
}

export function createMockCommitReviewDataSource(): CommitReviewDataSource {
  return new MockCommitReviewDataSource();
}
