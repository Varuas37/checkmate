import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import {
  createDefaultFileFilter,
  createInitialReviewUiState,
  toggleDiffOrientation as toggleDiffOrientationValue,
  type FileFilter,
  type PublishReviewPackage,
} from "../../../application/review/index.ts";
import type { DiffOrientation, PublishReviewResult } from "../../../domain/review/index.ts";

export interface HydrateUiForCommitPayload {
  readonly commitId: string;
  readonly firstFileId: string | null;
}

export interface SetAskAgentDraftPayload {
  readonly threadId: string;
  readonly draft: string;
}

export interface PublishStartedPayload {
  readonly pkg: PublishReviewPackage;
}

function cloneFileFilter(filter: FileFilter) {
  return {
    query: filter.query,
    statuses: [...filter.statuses],
    onlyCommented: filter.onlyCommented,
    onlyFailingStandards: filter.onlyFailingStandards,
    threadStatus: filter.threadStatus,
  };
}

function clonePublishPackage(pkg: PublishReviewPackage) {
  return {
    schemaVersion: pkg.schemaVersion,
    commitId: pkg.commitId,
    commitSha: pkg.commitSha,
    generatedAtIso: pkg.generatedAtIso,
    diffOrientation: pkg.diffOrientation,
    fileFilter: cloneFileFilter(pkg.fileFilter),
    overviewCards: pkg.overviewCards.map((card) => ({ ...card })),
    standardsRules: pkg.standardsRules.map((rule) => ({ ...rule })),
    standardsResults: pkg.standardsResults.map((result) => ({
      ...result,
      evidence: result.evidence.map((evidence) => ({ ...evidence })),
    })),
    files: pkg.files.map((file) => ({
      ...file,
      threads: file.threads.map((thread) => {
        const baseThread = {
          id: thread.id,
          fileId: thread.fileId,
          hunkId: thread.hunkId,
          lineNumber: thread.lineNumber,
          side: thread.side,
          status: thread.status,
          comments: thread.comments.map((comment) => ({ ...comment })),
        };

        if (!thread.askAgentDraft) {
          return baseThread;
        }

        return {
          ...baseThread,
          askAgentDraft: thread.askAgentDraft,
        };
      }),
    })),
  };
}

function clonePublishResult(result: PublishReviewResult): PublishReviewResult {
  return {
    provider: result.provider,
    requestId: result.requestId,
    publicationId: result.publicationId,
    publishedAtIso: result.publishedAtIso,
    summary: result.summary,
  };
}

const initialState = createInitialReviewUiState();

export const reviewUiSlice = createSlice({
  name: "reviewUi",
  initialState,
  reducers: {
    markLoadStarted(state): void {
      state.loadStatus = "loading";
      state.lastError = null;
    },
    hydrateForCommit(state, action: PayloadAction<HydrateUiForCommitPayload>): void {
      state.loadStatus = "loaded";
      state.lastError = null;
      state.activeCommitId = action.payload.commitId;
      state.activeFileId = action.payload.firstFileId;
      state.fileFilter = cloneFileFilter(createDefaultFileFilter());
      state.publishStatus = "ready";
      state.lastPublishPackage = null;
      state.publishResult = null;
      state.publishError = null;
      state.askAgentDraftByThreadId = {};
    },
    markLoadFailed(state, action: PayloadAction<{ readonly errorMessage: string }>): void {
      state.loadStatus = "error";
      state.lastError = action.payload.errorMessage;
    },
    setActiveFileId(state, action: PayloadAction<{ readonly fileId: string | null }>): void {
      state.activeFileId = action.payload.fileId;
    },
    setDiffOrientation(state, action: PayloadAction<{ readonly orientation: DiffOrientation }>): void {
      state.diffOrientation = action.payload.orientation;
    },
    toggleDiffOrientation(state): void {
      state.diffOrientation = toggleDiffOrientationValue(state.diffOrientation);
    },
    setFileFilter(state, action: PayloadAction<{ readonly filter: FileFilter }>): void {
      state.fileFilter = cloneFileFilter(action.payload.filter);
    },
    patchFileFilter(state, action: PayloadAction<{ readonly patch: Partial<FileFilter> }>): void {
      const nextStatuses = action.payload.patch.statuses ?? state.fileFilter.statuses;
      const nextQuery = action.payload.patch.query ?? state.fileFilter.query;
      const nextOnlyCommented = action.payload.patch.onlyCommented ?? state.fileFilter.onlyCommented;
      const nextOnlyFailingStandards =
        action.payload.patch.onlyFailingStandards ?? state.fileFilter.onlyFailingStandards;
      const nextThreadStatus = action.payload.patch.threadStatus ?? state.fileFilter.threadStatus;

      state.fileFilter = {
        query: nextQuery,
        statuses: [...nextStatuses],
        onlyCommented: nextOnlyCommented,
        onlyFailingStandards: nextOnlyFailingStandards,
        threadStatus: nextThreadStatus,
      };
    },
    setAskAgentDraft(state, action: PayloadAction<SetAskAgentDraftPayload>): void {
      state.askAgentDraftByThreadId[action.payload.threadId] = action.payload.draft;
    },
    clearAskAgentDraft(state, action: PayloadAction<{ readonly threadId: string }>): void {
      const nextDrafts = { ...state.askAgentDraftByThreadId };
      delete nextDrafts[action.payload.threadId];
      state.askAgentDraftByThreadId = nextDrafts;
    },
    publishStarted(state, action: PayloadAction<PublishStartedPayload>): void {
      state.lastPublishPackage = clonePublishPackage(action.payload.pkg);
      state.publishStatus = "publishing";
      state.publishResult = null;
      state.publishError = null;
    },
    publishSucceeded(state, action: PayloadAction<{ readonly result: PublishReviewResult }>): void {
      state.publishStatus = "published";
      state.publishResult = clonePublishResult(action.payload.result);
      state.publishError = null;
    },
    publishFailed(state, action: PayloadAction<{ readonly errorMessage: string }>): void {
      state.publishStatus = "error";
      state.publishResult = null;
      state.publishError = action.payload.errorMessage;
    },
  },
});

export const reviewUiActions = reviewUiSlice.actions;

export const reviewUiReducer = reviewUiSlice.reducer;
