import type {
  ChangedFile,
  CommentSide,
  CommentThread,
  CommitReview,
  DiffHunk,
  DiffOrientation,
  FileChangeStatus,
  OverviewCard,
  ReviewComment,
  StandardsResult,
  StandardsRule,
  ThreadStatus,
} from "../../domain/review/index.ts";
import type { FileFilter, PublishReviewPackage } from "../../application/review/index.ts";

export type ReviewTabId = "overview" | "files" | "summary" | "standards";

export interface ReviewTabOption {
  readonly id: ReviewTabId;
  readonly label: string;
}

export interface ArchitectureCluster {
  readonly id: string;
  readonly label: string;
  readonly fileIds: readonly string[];
  readonly additions: number;
  readonly deletions: number;
  readonly fileCount: number;
}

export interface SequenceBlock {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly fileIds: readonly string[];
}

export interface SequencePair {
  readonly id: string;
  readonly before: SequenceBlock;
  readonly after: SequenceBlock;
}

export interface FileSummary {
  readonly fileId: string;
  readonly path: string;
  readonly status: FileChangeStatus;
  readonly summary: string;
  readonly riskNote: string;
}

export interface StandardsCheck {
  readonly rule: StandardsRule;
  readonly result: StandardsResult | null;
}

export interface ThreadViewModel {
  readonly thread: CommentThread;
  readonly comments: readonly ReviewComment[];
  readonly askAgentDraft: string;
}

export interface CreateThreadInput {
  readonly hunkId: string;
  readonly side: CommentSide;
  readonly lineNumber: number;
  readonly body: string;
  readonly authorId: string;
}

export interface ReviewWorkspaceState {
  readonly loadStatus: "idle" | "loading" | "loaded" | "error";
  readonly errorMessage: string | null;
  readonly commit: CommitReview | null;
  readonly activeFile: ChangedFile | null;
  readonly activeFileId: string | null;
  readonly allFiles: readonly ChangedFile[];
  readonly filteredFiles: readonly ChangedFile[];
  readonly activeFileHunks: readonly DiffHunk[];
  readonly diffOrientation: DiffOrientation;
  readonly fileFilter: FileFilter;
  readonly overviewCards: readonly OverviewCard[];
  readonly architectureClusters: readonly ArchitectureCluster[];
  readonly sequencePairs: readonly SequencePair[];
  readonly standardsChecks: readonly StandardsCheck[];
  readonly threadModels: readonly ThreadViewModel[];
  readonly fileSummaries: readonly FileSummary[];
  readonly publishPackage: PublishReviewPackage | null;
  readonly standardsCounts: {
    readonly pass: number;
    readonly warn: number;
    readonly fail: number;
  };
  readonly isPublishingReady: boolean;
}

export interface ReviewWorkspaceActions {
  readonly selectFile: (fileId: string | null) => void;
  readonly setDiffOrientation: (orientation: DiffOrientation) => void;
  readonly setFilterQuery: (query: string) => void;
  readonly toggleFilterStatus: (status: FileChangeStatus) => void;
  readonly setOnlyCommented: (enabled: boolean) => void;
  readonly setOnlyFailingStandards: (enabled: boolean) => void;
  readonly setThreadStatusFilter: (status: ThreadStatus | "all") => void;
  readonly createThread: (input: CreateThreadInput) => { readonly ok: boolean; readonly message: string };
  readonly askAgent: (threadId: string, prompt: string) => void;
  readonly publishReview: () => void;
}
