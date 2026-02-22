import type { CommentSide, CommentThread, ReviewComment } from "../../../domain/review/index.ts";

export interface CreateCommentThreadInput {
  readonly commitId: string;
  readonly fileId: string;
  readonly hunkId: string;
  readonly side: CommentSide;
  readonly lineNumber: number;
  readonly body: string;
  readonly authorId: string;
}

export interface CreateCommentThreadDependencies {
  readonly createId: () => string;
  readonly nowIso: () => string;
}

export interface CreatedThreadBundle {
  readonly thread: CommentThread;
  readonly firstComment: ReviewComment;
}

function normalizeBody(body: string): string {
  return body.trim();
}

export function createCommentThread(
  input: CreateCommentThreadInput,
  deps: CreateCommentThreadDependencies,
): CreatedThreadBundle {
  const body = normalizeBody(input.body);

  if (body.length === 0) {
    throw new Error("Comment body cannot be empty.");
  }

  if (!Number.isInteger(input.lineNumber) || input.lineNumber <= 0) {
    throw new Error("Comment line number must be a positive integer.");
  }

  const createdAtIso = deps.nowIso();
  const threadId = deps.createId();
  const commentId = deps.createId();

  const thread: CommentThread = {
    id: threadId,
    commitId: input.commitId,
    fileId: input.fileId,
    hunkId: input.hunkId,
    anchor: {
      fileId: input.fileId,
      hunkId: input.hunkId,
      side: input.side,
      lineNumber: input.lineNumber,
    },
    messageIds: [commentId],
    status: "open",
    createdAtIso,
    updatedAtIso: createdAtIso,
  };

  const firstComment: ReviewComment = {
    id: commentId,
    threadId,
    authorType: "human",
    authorId: input.authorId,
    body,
    createdAtIso,
    isDraft: true,
  };

  return {
    thread,
    firstComment,
  };
}
