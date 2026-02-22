import type { CommitReviewAggregate } from "../../domain/review/index.ts";
import type { FileFilter, ReviewEntitiesState, ReviewUiState } from "./models.ts";

export function createDefaultFileFilter(): FileFilter {
  return {
    query: "",
    statuses: [],
    onlyCommented: false,
    onlyFailingStandards: false,
    threadStatus: "all",
  };
}

export function createEmptyReviewEntitiesState(): ReviewEntitiesState {
  return {
    commitsById: {},
    commitIds: [],
    filesById: {},
    fileIdsByCommitId: {},
    hunksById: {},
    hunkIdsByFileId: {},
    threadsById: {},
    threadIdsByFileId: {},
    commentsById: {},
    commentIdsByThreadId: {},
    overviewCardsById: {},
    overviewCardIdsByCommitId: {},
    standardsRulesById: {},
    standardsRuleIds: [],
    standardsResultsById: {},
    standardsResultIdsByCommitId: {},
  };
}

export function createInitialReviewUiState(): ReviewUiState {
  return {
    loadStatus: "idle",
    lastError: null,
    activeCommitId: null,
    activeFileId: null,
    diffOrientation: "split",
    fileFilter: createDefaultFileFilter(),
    askAgentDraftByThreadId: {},
    publishStatus: "idle",
    lastPublishPackage: null,
  };
}

export function normalizeCommitReviewAggregate(aggregate: CommitReviewAggregate): ReviewEntitiesState {
  const state = createEmptyReviewEntitiesState();

  state.commitsById = {
    [aggregate.commit.id]: aggregate.commit,
  };
  state.commitIds = [aggregate.commit.id];

  const filesById: Record<string, CommitReviewAggregate["files"][number]> = {};
  const fileIds: string[] = [];
  const hunkIdsByFileId: Record<string, string[]> = {};
  const hunksById: Record<string, CommitReviewAggregate["hunks"][number]> = {};

  aggregate.files.forEach((file) => {
    filesById[file.id] = file;
    fileIds.push(file.id);
    hunkIdsByFileId[file.id] = [];
  });

  aggregate.hunks.forEach((hunk) => {
    hunksById[hunk.id] = hunk;

    const hunkIds = hunkIdsByFileId[hunk.fileId];
    if (hunkIds) {
      hunkIds.push(hunk.id);
    } else {
      hunkIdsByFileId[hunk.fileId] = [hunk.id];
    }
  });

  const threadsById: Record<string, CommitReviewAggregate["threads"][number]> = {};
  const threadIdsByFileId: Record<string, string[]> = {};
  const commentIdsByThreadId: Record<string, string[]> = {};

  aggregate.threads.forEach((thread) => {
    threadsById[thread.id] = thread;

    const threadIds = threadIdsByFileId[thread.fileId];
    if (threadIds) {
      threadIds.push(thread.id);
    } else {
      threadIdsByFileId[thread.fileId] = [thread.id];
    }

    commentIdsByThreadId[thread.id] = [...thread.messageIds];
  });

  const commentsById: Record<string, CommitReviewAggregate["comments"][number]> = {};
  aggregate.comments.forEach((comment) => {
    commentsById[comment.id] = comment;

    const messageIds = commentIdsByThreadId[comment.threadId];
    if (!messageIds) {
      commentIdsByThreadId[comment.threadId] = [comment.id];
      return;
    }

    if (!messageIds.includes(comment.id)) {
      messageIds.push(comment.id);
    }
  });

  const overviewCardsById: Record<string, CommitReviewAggregate["overviewCards"][number]> = {};
  const overviewCardIds: string[] = [];
  aggregate.overviewCards.forEach((card) => {
    overviewCardsById[card.id] = card;
    overviewCardIds.push(card.id);
  });

  const standardsRulesById: Record<string, CommitReviewAggregate["standardsRules"][number]> = {};
  const standardsRuleIds: string[] = [];
  aggregate.standardsRules.forEach((rule) => {
    standardsRulesById[rule.id] = rule;
    standardsRuleIds.push(rule.id);
  });

  const standardsResultsById: Record<string, CommitReviewAggregate["standardsResults"][number]> = {};
  const standardsResultIds: string[] = [];
  aggregate.standardsResults.forEach((result) => {
    standardsResultsById[result.id] = result;
    standardsResultIds.push(result.id);
  });

  state.filesById = filesById;
  state.fileIdsByCommitId = {
    [aggregate.commit.id]: fileIds,
  };
  state.hunksById = hunksById;
  state.hunkIdsByFileId = hunkIdsByFileId;
  state.threadsById = threadsById;
  state.threadIdsByFileId = threadIdsByFileId;
  state.commentsById = commentsById;
  state.commentIdsByThreadId = commentIdsByThreadId;
  state.overviewCardsById = overviewCardsById;
  state.overviewCardIdsByCommitId = {
    [aggregate.commit.id]: overviewCardIds,
  };
  state.standardsRulesById = standardsRulesById;
  state.standardsRuleIds = standardsRuleIds;
  state.standardsResultsById = standardsResultsById;
  state.standardsResultIdsByCommitId = {
    [aggregate.commit.id]: standardsResultIds,
  };

  return state;
}
