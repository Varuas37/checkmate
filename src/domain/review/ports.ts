import type {
  ChangedFile,
  CommitReview,
  CommitReviewAggregate,
  DiffHunk,
  ReviewCardKind,
  StandardsResult,
  StandardsRule,
} from "./entities.ts";

export interface LoadCommitReviewInput {
  readonly repositoryPath: string;
  readonly commitSha: string;
}

export interface ListRepositoryCommitsInput {
  readonly repositoryPath: string;
  readonly limit?: number;
}

export interface ReadCommitFileVersionsInput {
  readonly repositoryPath: string;
  readonly commitSha: string;
  readonly oldPath: string;
  readonly newPath: string;
}

export interface CommitFileVersions {
  readonly oldContent: string | null;
  readonly newContent: string | null;
}

export interface RepositoryCommitSummary {
  readonly hash: string;
  readonly shortHash: string;
  readonly summary: string;
  readonly author: string;
  readonly authorEmail: string;
  readonly authoredAtIso: string;
}

export interface CommitReviewDataSource {
  loadCommitReview(input: LoadCommitReviewInput): Promise<CommitReviewAggregate>;
  listRepositoryCommits(input: ListRepositoryCommitsInput): Promise<readonly RepositoryCommitSummary[]>;
  readCommitFileVersions(input: ReadCommitFileVersionsInput): Promise<CommitFileVersions>;
}

export interface LocalGitReviewAdapter {
  readCommitReview(input: LoadCommitReviewInput): Promise<CommitReviewAggregate>;
}

export interface StandardsEvaluationInput {
  readonly commitId: string;
  readonly ruleText: string;
  readonly files: readonly ChangedFile[];
  readonly hunks: readonly DiffHunk[];
}

export interface StandardsEvaluationOutput {
  readonly rules: readonly StandardsRule[];
  readonly results: readonly StandardsResult[];
}

export interface StandardsEvaluator {
  evaluate(input: StandardsEvaluationInput): StandardsEvaluationOutput;
}

export interface AnalyseStandardsInput {
  readonly commitId: string;
  readonly commit: CommitReview;
  readonly files: readonly ChangedFile[];
  readonly hunks: readonly DiffHunk[];
  readonly ruleText: string;
  readonly standardsSourcePath: string;
}

export interface StandardsAnalyser {
  analyseStandards(input: AnalyseStandardsInput): Promise<StandardsEvaluationOutput>;
}

export type ReviewPublishProvider = "ai-sdk";

export interface PublishReviewRequest {
  readonly requestId: string;
  readonly requestedBy: string;
  readonly requestedAtIso: string;
  readonly commitId: string;
  readonly commitSha: string;
  readonly payloadJson: string;
}

export interface PublishReviewResult {
  readonly provider: ReviewPublishProvider;
  readonly requestId: string;
  readonly publicationId: string;
  readonly publishedAtIso: string;
  readonly summary: string;
}

export interface ReviewPublisher {
  publishReview(input: PublishReviewRequest): Promise<PublishReviewResult>;
}

export interface AnalyseCommitInput {
  readonly commitId: string;
  readonly commit: CommitReview;
  readonly files: readonly ChangedFile[];
  readonly hunks: readonly DiffHunk[];
  readonly standardsRuleText?: string;
  readonly standardsSourcePath?: string;
  readonly abortSignal?: AbortSignal;
  readonly onFileSummary?: (
    summary: AiFileSummary,
    index: number,
    total: number,
  ) => void | Promise<void>;
  readonly onFileSummariesReady?: (
    fileSummaries: readonly AiFileSummary[],
  ) => void | Promise<void>;
}

export interface AiOverviewCard {
  readonly kind: ReviewCardKind;
  readonly title: string;
  readonly body: string;
}

export interface AiSequenceStep {
  readonly token?: string;
  readonly sourceId?: string;
  readonly sourceLabel: string;
  readonly targetId?: string;
  readonly targetLabel: string;
  readonly message: string;
  readonly filePath: string;
}

export interface AiFlowHunkReference {
  readonly filePath: string;
  readonly hunkHeaders: readonly string[];
}

export interface AiFlowComparison {
  readonly beforeTitle: string;
  readonly beforeBody: string;
  readonly afterTitle: string;
  readonly afterBody: string;
  readonly technicalDetails?: string;
  readonly filePaths: readonly string[];
  readonly hunkHeadersByFile?: readonly AiFlowHunkReference[];
}

export interface AiFileSummary {
  readonly filePath: string;
  readonly summary: string;
  readonly riskNote: string;
  readonly technicalDetails?: string;
}

export interface AnalyseCommitOutput {
  readonly commitId: string;
  readonly overviewCards: readonly AiOverviewCard[];
  readonly sequenceSteps: readonly AiSequenceStep[];
  readonly flowComparisons: readonly AiFlowComparison[];
  readonly fileSummaries: readonly AiFileSummary[];
  readonly standardsRules: readonly StandardsRule[];
  readonly standardsResults: readonly StandardsResult[];
}

export interface CommitAnalyser {
  analyseCommit(input: AnalyseCommitInput): Promise<AnalyseCommitOutput>;
}

export interface SequenceDiagramGenerator {
  generateSequenceSteps(input: AnalyseCommitInput): Promise<readonly AiSequenceStep[]>;
}
