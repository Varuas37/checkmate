import type {
  ChangedFile,
  CommentThread,
  CommitReview,
  DiffHunk,
  DiffOrientation,
  FileChangeStatus,
  OverviewCard,
  PublishReviewResult,
  RepositoryCommitSummary,
  ReviewComment,
  StandardsResult,
  StandardsRule,
  ThreadStatus,
} from "../../domain/review/index.ts";

export interface FileFilter {
  readonly query: string;
  readonly statuses: readonly FileChangeStatus[];
  readonly onlyCommented: boolean;
  readonly onlyFailingStandards: boolean;
  readonly threadStatus: ThreadStatus | "all";
}

export interface PublishReviewCommentPayload {
  readonly id: string;
  readonly authorType: "human" | "agent";
  readonly authorId: string;
  readonly body: string;
  readonly createdAtIso: string;
  readonly isDraft: boolean;
}

export interface PublishReviewThreadPayload {
  readonly id: string;
  readonly fileId: string;
  readonly hunkId: string;
  readonly lineNumber: number;
  readonly side: "old" | "new";
  readonly status: ThreadStatus;
  readonly comments: readonly PublishReviewCommentPayload[];
  readonly askAgentDraft?: string;
}

export interface PublishReviewFilePayload {
  readonly id: string;
  readonly path: string;
  readonly status: FileChangeStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly threads: readonly PublishReviewThreadPayload[];
}

export interface PublishReviewPackage {
  readonly schemaVersion: "review-publish.v1";
  readonly commitId: string;
  readonly commitSha: string;
  readonly generatedAtIso: string;
  readonly diffOrientation: DiffOrientation;
  readonly fileFilter: FileFilter;
  readonly overviewCards: readonly OverviewCard[];
  readonly standardsRules: readonly StandardsRule[];
  readonly standardsResults: readonly StandardsResult[];
  readonly files: readonly PublishReviewFilePayload[];
}

export interface ReviewEntitiesState {
  commitsById: Record<string, CommitReview>;
  commitIds: string[];
  filesById: Record<string, ChangedFile>;
  fileIdsByCommitId: Record<string, string[]>;
  hunksById: Record<string, DiffHunk>;
  hunkIdsByFileId: Record<string, string[]>;
  threadsById: Record<string, CommentThread>;
  threadIdsByFileId: Record<string, string[]>;
  commentsById: Record<string, ReviewComment>;
  commentIdsByThreadId: Record<string, string[]>;
  overviewCardsById: Record<string, OverviewCard>;
  overviewCardIdsByCommitId: Record<string, string[]>;
  standardsRulesById: Record<string, StandardsRule>;
  standardsRuleIds: string[];
  standardsResultsById: Record<string, StandardsResult>;
  standardsResultIdsByCommitId: Record<string, string[]>;
}

export type ReviewLoadStatus = "idle" | "loading" | "loaded" | "error";

export type ReviewPublishStatus = "idle" | "ready" | "publishing" | "published" | "error";

export interface ReviewUiState {
  loadStatus: ReviewLoadStatus;
  lastError: string | null;
  activeCommitId: string | null;
  activeFileId: string | null;
  diffOrientation: DiffOrientation;
  fileFilter: FileFilter;
  askAgentDraftByThreadId: Record<string, string>;
  repositoryCommits: readonly RepositoryCommitSummary[];
  publishStatus: ReviewPublishStatus;
  lastPublishPackage: PublishReviewPackage | null;
  publishResult: PublishReviewResult | null;
  publishError: string | null;
}

export interface ReviewRootState {
  readonly reviewEntities: ReviewEntitiesState;
  readonly reviewUi: ReviewUiState;
}
