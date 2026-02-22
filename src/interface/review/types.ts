import type {
  ChangedFile,
  CommitFileVersions,
  CommentSide,
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
import type {
  AiAnalysisStatus,
  AiSequenceStatus,
  DiffViewMode,
  FileFilter,
  FileVersionsLoadStatus,
  PublishReviewPackage,
  ReviewPublishStatus,
  StandardsAnalysisStatus,
} from "../../application/review/index.ts";

export type ReviewTabId = "overview" | "files" | "summary" | "standards";

export interface ReviewTabOption {
  readonly id: ReviewTabId;
  readonly label: string;
}

export interface ReviewLoadRequest {
  readonly repositoryPath: string;
  readonly commitSha: string;
}

export interface SampleCommitPreset extends ReviewLoadRequest {
  readonly id: string;
  readonly label: string;
}

export interface ReloadReviewWorkspaceInput extends ReviewLoadRequest {
  readonly standardsRuleText: string;
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

export interface CodeSequenceStep {
  readonly id: string;
  readonly token: string;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly targetId: string;
  readonly targetLabel: string;
  readonly message: string;
  readonly fileIds: readonly string[];
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
  readonly diffViewMode: DiffViewMode;
  readonly activeFileVersions: CommitFileVersions | null;
  readonly activeFileVersionsStatus: FileVersionsLoadStatus;
  readonly activeFileVersionsError: string | null;
  readonly fileFilter: FileFilter;
  readonly overviewCards: readonly OverviewCard[];
  readonly architectureClusters: readonly ArchitectureCluster[];
  readonly sequencePairs: readonly SequencePair[];
  readonly codeSequenceSteps: readonly CodeSequenceStep[];
  readonly standardsChecks: readonly StandardsCheck[];
  readonly threadModels: readonly ThreadViewModel[];
  readonly fileSummaries: readonly FileSummary[];
  readonly publishPackage: PublishReviewPackage | null;
  readonly repositoryCommits: readonly RepositoryCommitSummary[];
  readonly publishStatus: ReviewPublishStatus;
  readonly publishResult: PublishReviewResult | null;
  readonly publishError: string | null;
  readonly standardsCounts: {
    readonly pass: number;
    readonly warn: number;
    readonly fail: number;
  };
  readonly isPublishingReady: boolean;
  readonly aiAnalysisStatus: AiAnalysisStatus;
  readonly aiSequenceStatus: AiSequenceStatus;
  readonly aiSequenceError: string | null;
  readonly standardsAnalysisStatus: StandardsAnalysisStatus;
  readonly standardsAnalysisError: string | null;
}

export interface ReviewWorkspaceActions {
  readonly reloadReviewWorkspace: (input: ReloadReviewWorkspaceInput) => void;
  readonly selectFile: (fileId: string | null) => void;
  readonly setDiffOrientation: (orientation: DiffOrientation) => void;
  readonly setDiffViewMode: (mode: DiffViewMode) => void;
  readonly setFilterQuery: (query: string) => void;
  readonly toggleFilterStatus: (status: FileChangeStatus) => void;
  readonly setOnlyCommented: (enabled: boolean) => void;
  readonly setOnlyFailingStandards: (enabled: boolean) => void;
  readonly setThreadStatusFilter: (status: ThreadStatus | "all") => void;
  readonly createThread: (input: CreateThreadInput) => { readonly ok: boolean; readonly message: string };
  readonly askAgent: (threadId: string, prompt: string) => void;
  readonly deleteComment: (commentId: string) => void;
  readonly publishReview: () => void;
  readonly refreshAiAnalysis: () => void;
  readonly refreshStandardsAnalysis: () => void;
  readonly retrySequenceGeneration: () => void;
}
