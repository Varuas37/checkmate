import type { ChangedFile, CommentThread, DiffHunk, ReviewComment } from "../../../domain/review/index.ts";

export interface CreateAskAgentDraftInput {
  readonly file: ChangedFile;
  readonly hunk: DiffHunk;
  readonly thread: CommentThread;
  readonly comments: readonly ReviewComment[];
  readonly reviewerPrompt?: string;
}

function getLatestHumanComment(comments: readonly ReviewComment[]): ReviewComment | null {
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const comment = comments[index];

    if (comment && comment.authorType === "human") {
      return comment;
    }
  }

  return null;
}

export function createAskAgentDraft(input: CreateAskAgentDraftInput): string {
  const latestHumanComment = getLatestHumanComment(input.comments);
  const explicitPrompt = input.reviewerPrompt?.trim() ?? "";
  const question = explicitPrompt.length > 0 ? explicitPrompt : latestHumanComment?.body ?? "";

  const promptLines = [
    `Please review the discussion on ${input.file.path}.`,
    `Thread id: ${input.thread.id}`,
    `Hunk: ${input.hunk.header}`,
    `Anchor: ${input.thread.anchor.side} line ${input.thread.anchor.lineNumber}`,
    "Question:",
    question.length > 0 ? question : "Provide a focused assessment and proposed patch.",
    "Expected output:",
    "1. Root cause.",
    "2. Risk/impact.",
    "3. Concrete patch suggestion.",
  ];

  return promptLines.join("\n");
}
