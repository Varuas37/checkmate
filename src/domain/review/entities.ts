export type DiffOrientation = "split" | "unified";

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed";

export type DiffLineKind = "context" | "add" | "remove";

export type CommentSide = "old" | "new";

export type ThreadStatus = "open" | "resolved";

export type CommentAuthorType = "human" | "agent";

export type ReviewCardKind = "summary" | "impact" | "risk" | "question";

export type StandardsSeverity = "low" | "medium" | "high";

export type StandardsResultStatus = "pass" | "warn" | "fail";

export interface CommitReview {
  readonly id: string;
  readonly repositoryPath: string;
  readonly commitSha: string;
  readonly shortSha: string;
  readonly title: string;
  readonly description: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authoredAtIso: string;
  readonly parentCommitShas: readonly string[];
}

export interface ChangedFile {
  readonly id: string;
  readonly commitId: string;
  readonly path: string;
  readonly previousPath?: string;
  readonly status: FileChangeStatus;
  readonly additions: number;
  readonly deletions: number;
}

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly oldLineNumber?: number;
  readonly newLineNumber?: number;
  readonly text: string;
}

export interface DiffHunk {
  readonly id: string;
  readonly fileId: string;
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
}

export interface CommentAnchor {
  readonly fileId: string;
  readonly hunkId: string;
  readonly side: CommentSide;
  readonly lineNumber: number;
}

export interface CommentThread {
  readonly id: string;
  readonly commitId: string;
  readonly fileId: string;
  readonly hunkId: string;
  readonly anchor: CommentAnchor;
  readonly messageIds: readonly string[];
  readonly status: ThreadStatus;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
}

export interface ReviewComment {
  readonly id: string;
  readonly threadId: string;
  readonly authorType: CommentAuthorType;
  readonly authorId: string;
  readonly body: string;
  readonly createdAtIso: string;
  readonly isDraft: boolean;
}

export interface OverviewCard {
  readonly id: string;
  readonly commitId: string;
  readonly kind: ReviewCardKind;
  readonly title: string;
  readonly body: string;
  readonly rank: number;
}

export interface StandardsRule {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly severity: StandardsSeverity;
}

export interface StandardsEvidence {
  readonly fileId?: string;
  readonly filePath?: string;
  readonly hunkId?: string;
  readonly lineNumber?: number;
  readonly note: string;
}

export interface StandardsResult {
  readonly id: string;
  readonly commitId: string;
  readonly ruleId: string;
  readonly status: StandardsResultStatus;
  readonly summary: string;
  readonly evidence: readonly StandardsEvidence[];
}

export interface CommitReviewAggregate {
  readonly commit: CommitReview;
  readonly files: readonly ChangedFile[];
  readonly hunks: readonly DiffHunk[];
  readonly threads: readonly CommentThread[];
  readonly comments: readonly ReviewComment[];
  readonly overviewCards: readonly OverviewCard[];
  readonly standardsRules: readonly StandardsRule[];
  readonly standardsResults: readonly StandardsResult[];
}
