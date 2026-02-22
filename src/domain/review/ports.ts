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

export interface CommitReviewDataSource {
  loadCommitReview(input: LoadCommitReviewInput): Promise<CommitReviewAggregate>;
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
