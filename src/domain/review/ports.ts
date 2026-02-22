import type {
  ChangedFile,
  CommitReviewAggregate,
  DiffHunk,
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

export type ReviewPublishProvider = "claude-sdk";

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
