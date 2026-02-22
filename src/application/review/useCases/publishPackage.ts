import type {
  CommentThread,
  DiffHunk,
  ReviewComment,
  StandardsResult,
  StandardsRule,
} from "../../../domain/review/index.ts";
import type {
  PublishReviewFilePayload,
  PublishReviewPackage,
  PublishReviewThreadPayload,
  ReviewRootState,
} from "../models.ts";

export interface CreatePublishReviewPackageInput {
  readonly state: ReviewRootState;
  readonly generatedAtIso: string;
}

function compareByPathThenId(
  left: { readonly path: string; readonly id: string },
  right: { readonly path: string; readonly id: string },
): number {
  const pathCompare = left.path.localeCompare(right.path);

  if (pathCompare !== 0) {
    return pathCompare;
  }

  return left.id.localeCompare(right.id);
}

function compareThreads(
  left: { readonly anchor: { readonly lineNumber: number }; readonly id: string },
  right: { readonly anchor: { readonly lineNumber: number }; readonly id: string },
): number {
  if (left.anchor.lineNumber !== right.anchor.lineNumber) {
    return left.anchor.lineNumber - right.anchor.lineNumber;
  }

  return left.id.localeCompare(right.id);
}

function mapThreadToPublishPayload(
  thread: CommentThread,
  comments: readonly ReviewComment[],
  askAgentDraft: string | undefined,
): PublishReviewThreadPayload {
  const basePayload: PublishReviewThreadPayload = {
    id: thread.id,
    fileId: thread.fileId,
    hunkId: thread.hunkId,
    lineNumber: thread.anchor.lineNumber,
    side: thread.anchor.side,
    status: thread.status,
    comments,
  };

  if (!askAgentDraft || askAgentDraft.trim().length === 0) {
    return basePayload;
  }

  return {
    ...basePayload,
    askAgentDraft,
  };
}

function buildFilePayloads(input: {
  readonly state: ReviewRootState;
  readonly commitId: string;
}): readonly PublishReviewFilePayload[] {
  const entities = input.state.reviewEntities;
  const ui = input.state.reviewUi;
  const fileIds = entities.fileIdsByCommitId[input.commitId] ?? [];

  return fileIds
    .map((fileId) => entities.filesById[fileId])
    .filter((file): file is NonNullable<typeof file> => file !== undefined)
    .sort(compareByPathThenId)
    .map((file) => {
      const threadIds = entities.threadIdsByFileId[file.id] ?? [];
      const threadPayloads = threadIds
        .map((threadId) => entities.threadsById[threadId])
        .filter((thread): thread is NonNullable<typeof thread> => thread !== undefined)
        .sort(compareThreads)
        .map((thread) => {
          const commentIds = entities.commentIdsByThreadId[thread.id] ?? thread.messageIds;
          const comments = commentIds
            .map((commentId) => entities.commentsById[commentId])
            .filter((comment): comment is NonNullable<typeof comment> => comment !== undefined)
            .sort((left, right) => left.createdAtIso.localeCompare(right.createdAtIso));

          const askAgentDraft = ui.askAgentDraftByThreadId[thread.id];
          return mapThreadToPublishPayload(thread, comments, askAgentDraft);
        });

      return {
        id: file.id,
        path: file.path,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        threads: threadPayloads,
      };
    });
}

function buildCommitOverviewCards(input: {
  readonly state: ReviewRootState;
  readonly commitId: string;
}) {
  const entities = input.state.reviewEntities;
  const cardIds = entities.overviewCardIdsByCommitId[input.commitId] ?? [];

  return cardIds
    .map((cardId) => entities.overviewCardsById[cardId])
    .filter((card): card is NonNullable<typeof card> => card !== undefined)
    .sort((left, right) => left.rank - right.rank);
}

function buildStandardsPayload(input: {
  readonly state: ReviewRootState;
  readonly commitId: string;
}): {
  readonly rules: readonly StandardsRule[];
  readonly results: readonly StandardsResult[];
} {
  const entities = input.state.reviewEntities;

  const rules = entities.standardsRuleIds
    .map((ruleId) => entities.standardsRulesById[ruleId])
    .filter((rule): rule is NonNullable<typeof rule> => rule !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));

  const resultIds = entities.standardsResultIdsByCommitId[input.commitId] ?? [];
  const results = resultIds
    .map((resultId) => entities.standardsResultsById[resultId])
    .filter((result): result is NonNullable<typeof result> => result !== undefined)
    .sort((left, right) => left.ruleId.localeCompare(right.ruleId));

  return {
    rules,
    results,
  };
}

export function createPublishReviewPackage(
  input: CreatePublishReviewPackageInput,
): PublishReviewPackage {
  const activeCommitId = input.state.reviewUi.activeCommitId;

  if (activeCommitId === null) {
    throw new Error("Cannot publish review package without an active commit.");
  }

  const commit = input.state.reviewEntities.commitsById[activeCommitId];

  if (!commit) {
    throw new Error(`Cannot publish review package for missing commit id \"${activeCommitId}\".`);
  }

  const standardsPayload = buildStandardsPayload({
    state: input.state,
    commitId: activeCommitId,
  });

  return {
    schemaVersion: "review-publish.v1",
    commitId: commit.id,
    commitSha: commit.commitSha,
    generatedAtIso: input.generatedAtIso,
    diffOrientation: input.state.reviewUi.diffOrientation,
    fileFilter: input.state.reviewUi.fileFilter,
    overviewCards: buildCommitOverviewCards({
      state: input.state,
      commitId: activeCommitId,
    }),
    standardsRules: standardsPayload.rules,
    standardsResults: standardsPayload.results,
    files: buildFilePayloads({
      state: input.state,
      commitId: activeCommitId,
    }),
  };
}

export function mapHunksById(hunks: readonly DiffHunk[]): Readonly<Record<string, DiffHunk>> {
  const hunksById: Record<string, DiffHunk> = {};

  hunks.forEach((hunk) => {
    hunksById[hunk.id] = hunk;
  });

  return hunksById;
}
