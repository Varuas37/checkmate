import type { ChangedFile, CommentThread, CommitReview, ReviewComment } from "../../domain/review/index.ts";
import type {
  FileFilter,
  ReviewEntitiesState,
  ReviewRootState,
  ReviewUiState,
} from "./models.ts";
import { resolveActiveFileId } from "./useCases/activeFile.ts";
import { applyFileFilter } from "./useCases/fileFiltering.ts";

export function selectReviewEntities(state: ReviewRootState): ReviewEntitiesState {
  return state.reviewEntities;
}

export function selectReviewUi(state: ReviewRootState): ReviewUiState {
  return state.reviewUi;
}

export function selectActiveCommitId(state: ReviewRootState): string | null {
  return state.reviewUi.activeCommitId;
}

export function selectActiveCommit(state: ReviewRootState): CommitReview | null {
  const activeCommitId = selectActiveCommitId(state);

  if (activeCommitId === null) {
    return null;
  }

  return state.reviewEntities.commitsById[activeCommitId] ?? null;
}

export function selectFilesForActiveCommit(state: ReviewRootState): readonly ChangedFile[] {
  const activeCommitId = selectActiveCommitId(state);

  if (activeCommitId === null) {
    return [];
  }

  const fileIds = state.reviewEntities.fileIdsByCommitId[activeCommitId] ?? [];

  return fileIds
    .map((fileId) => state.reviewEntities.filesById[fileId])
    .filter((file): file is NonNullable<typeof file> => file !== undefined);
}

function collectFailingFileIds(state: ReviewRootState): readonly string[] {
  const activeCommitId = selectActiveCommitId(state);

  if (activeCommitId === null) {
    return [];
  }

  const resultIds = state.reviewEntities.standardsResultIdsByCommitId[activeCommitId] ?? [];
  const failingFileIds = new Set<string>();

  resultIds.forEach((resultId) => {
    const result = state.reviewEntities.standardsResultsById[resultId];

    if (!result || result.status !== "fail") {
      return;
    }

    result.evidence.forEach((evidence) => {
      if (evidence.fileId) {
        failingFileIds.add(evidence.fileId);
      }
    });
  });

  return [...failingFileIds].sort((left, right) => left.localeCompare(right));
}

export function createSelectFilteredFiles(): (state: ReviewRootState) => readonly ChangedFile[] {
  let previousActiveCommitId: string | null = null;
  let previousFileIds: readonly string[] | null = null;
  let previousFilesById: ReviewEntitiesState["filesById"] | null = null;
  let previousFilter: FileFilter | null = null;
  let previousThreadIdsByFileId: ReviewEntitiesState["threadIdsByFileId"] | null = null;
  let previousThreadsById: ReviewEntitiesState["threadsById"] | null = null;
  let previousFailingKey = "";
  let previousResult: readonly ChangedFile[] = [];

  return (state: ReviewRootState): readonly ChangedFile[] => {
    const activeCommitId = selectActiveCommitId(state);
    const fileIds =
      activeCommitId === null ? [] : state.reviewEntities.fileIdsByCommitId[activeCommitId] ?? [];
    const filesById = state.reviewEntities.filesById;
    const filter = state.reviewUi.fileFilter;
    const threadIdsByFileId = state.reviewEntities.threadIdsByFileId;
    const threadsById = state.reviewEntities.threadsById;
    const failingFileIds = collectFailingFileIds(state);
    const failingKey = failingFileIds.join("|");

    if (
      previousActiveCommitId === activeCommitId &&
      previousFileIds === fileIds &&
      previousFilesById === filesById &&
      previousFilter === filter &&
      previousThreadIdsByFileId === threadIdsByFileId &&
      previousThreadsById === threadsById &&
      previousFailingKey === failingKey
    ) {
      return previousResult;
    }

    const files = fileIds
      .map((fileId) => filesById[fileId])
      .filter((file): file is NonNullable<typeof file> => file !== undefined);

    previousResult = applyFileFilter({
      files,
      filter,
      threadIdsByFileId,
      threadsById,
      failingFileIds: new Set(failingFileIds),
    });

    previousActiveCommitId = activeCommitId;
    previousFileIds = fileIds;
    previousFilesById = filesById;
    previousFilter = filter;
    previousThreadIdsByFileId = threadIdsByFileId;
    previousThreadsById = threadsById;
    previousFailingKey = failingKey;

    return previousResult;
  };
}

export const selectFilteredFiles = createSelectFilteredFiles();

export function selectVisibleFileIds(state: ReviewRootState): readonly string[] {
  return selectFilteredFiles(state).map((file) => file.id);
}

export function selectResolvedActiveFileId(state: ReviewRootState): string | null {
  return resolveActiveFileId(selectVisibleFileIds(state), state.reviewUi.activeFileId);
}

export function selectActiveFile(state: ReviewRootState): ChangedFile | null {
  const activeFileId = selectResolvedActiveFileId(state);

  if (activeFileId === null) {
    return null;
  }

  return state.reviewEntities.filesById[activeFileId] ?? null;
}

export function selectThreadById(state: ReviewRootState, threadId: string): CommentThread | null {
  return state.reviewEntities.threadsById[threadId] ?? null;
}

export function selectThreadComments(state: ReviewRootState, threadId: string): readonly ReviewComment[] {
  const commentIds = state.reviewEntities.commentIdsByThreadId[threadId] ?? [];

  return commentIds
    .map((commentId) => state.reviewEntities.commentsById[commentId])
    .filter((comment): comment is NonNullable<typeof comment> => comment !== undefined)
    .sort((left, right) => left.createdAtIso.localeCompare(right.createdAtIso));
}

export function selectAskAgentDraft(state: ReviewRootState, threadId: string): string {
  return state.reviewUi.askAgentDraftByThreadId[threadId] ?? "";
}
