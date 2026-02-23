import type { ChangedFile, CommentThread, DiffHunk, ReviewComment } from "../../../domain/review/index.ts";

export interface CreateAskAgentDraftInput {
  readonly file: ChangedFile;
  readonly hunk: DiffHunk;
  readonly thread: CommentThread;
  readonly comments: readonly ReviewComment[];
  readonly reviewerPrompt?: string;
  readonly additionalContext?: readonly string[];
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

const EXPLICIT_BUG_REVIEW_PATTERNS = [
  /\b(find|spot|identify|detect|review|scan|audit|check|look(?:\s+for)?)\b[^.!?\n]{0,60}\b(bugs?|issues?|problems?|regressions?|risks?|vulnerabilities?)\b/i,
  /\b(root\s+cause|risk\/impact|patch\s+suggestion|bug\s+hunt|regression\s+review)\b/i,
  /\b(any|what)\s+(bugs?|issues?|problems?|regressions?)\b/i,
];

function isExplicitBugReviewPrompt(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return false;
  }

  return EXPLICIT_BUG_REVIEW_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function createAskAgentDraft(input: CreateAskAgentDraftInput): string {
  const latestHumanComment = getLatestHumanComment(input.comments);
  const explicitPrompt = input.reviewerPrompt?.trim() ?? "";
  const question = explicitPrompt.length > 0 ? explicitPrompt : latestHumanComment?.body ?? "";
  const isBugReviewRequest = isExplicitBugReviewPrompt(question);

  const promptLines = [
    `Please review the discussion on ${input.file.path}.`,
    `Thread id: ${input.thread.id}`,
    `Hunk: ${input.hunk.header}`,
    `Anchor: ${input.thread.anchor.side} line ${input.thread.anchor.lineNumber}`,
    "Question:",
    question.length > 0 ? question : "Provide a focused assessment and proposed patch.",
    "Responder instructions:",
    ...(isBugReviewRequest
      ? [
          "- The reviewer asked for a bug/problem-focused review.",
          "- Respond using this exact structure:",
          "1. Root cause.",
          "2. Risk/impact.",
          "3. Concrete patch suggestion.",
        ]
      : [
          "- Answer the reviewer question directly in concise markdown.",
          "- Add a short section titled `Potential bugs/problems` with likely risks, or `None obvious`.",
          "- Include concrete changes only when they help answer the question.",
        ]),
    ...(input.additionalContext && input.additionalContext.length > 0
      ? [
          "Additional context:",
          ...input.additionalContext,
        ]
      : []),
  ];

  return promptLines.join("\n");
}
