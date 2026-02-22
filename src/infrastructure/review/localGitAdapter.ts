import type {
  CommitReviewAggregate,
  CommitReviewDataSource,
  LoadCommitReviewInput,
  LocalGitReviewAdapter,
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
}
