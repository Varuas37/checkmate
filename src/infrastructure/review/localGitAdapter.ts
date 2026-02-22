import type {
  CommitReviewAggregate,
  CommitReviewDataSource,
  ListRepositoryCommitsInput,
  LoadCommitReviewInput,
  LocalGitReviewAdapter,
  RepositoryCommitSummary,
} from "../../domain/review/index.ts";

export class StubLocalGitReviewAdapter implements LocalGitReviewAdapter {
  async readCommitReview(_input: LoadCommitReviewInput): Promise<CommitReviewAggregate> {
    throw new Error("Local git adapter is not implemented yet.");
  }
}

export class LocalGitBackedCommitReviewDataSource implements CommitReviewDataSource {
  readonly #adapter: LocalGitReviewAdapter;

  constructor(adapter: LocalGitReviewAdapter) {
    this.#adapter = adapter;
  }

  async loadCommitReview(input: LoadCommitReviewInput): Promise<CommitReviewAggregate> {
    return this.#adapter.readCommitReview(input);
  }

  async listRepositoryCommits(_input: ListRepositoryCommitsInput): Promise<readonly RepositoryCommitSummary[]> {
    throw new Error("Local git commit listing is not implemented yet.");
  }
}
