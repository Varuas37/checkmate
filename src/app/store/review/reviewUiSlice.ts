import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import {
  createDefaultFileFilter,
  createInitialReviewUiState,
  toggleDiffOrientation as toggleDiffOrientationValue,
  type FileInspectionMode,
  type DiffViewMode,
  type FileFilter,
  type PublishReviewPackage,
} from "../../../application/review/index.ts";
import type {
  AiSequenceStep,
  AnalyseCommitOutput,
  CommitFileVersions,
  DiffOrientation,
  PublishReviewResult,
  RepositoryCommitSummary,
} from "../../../domain/review/index.ts";

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

export interface SetDiffViewModePayload {
  readonly mode: DiffViewMode;
}

export interface SetFileInspectionModePayload {
  readonly mode: FileInspectionMode;
}

export interface FileVersionsLoadStartedPayload {
  readonly fileId: string;
}

export interface FileVersionsLoadedPayload {
  readonly fileId: string;
  readonly versions: CommitFileVersions;
}

export interface FileVersionsLoadFailedPayload {
  readonly fileId: string;
  readonly errorMessage: string;
}

export interface SequenceGenerationSucceededPayload {
  readonly commitId: string;
  readonly sequenceSteps: readonly AiSequenceStep[];
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

function cloneFileVersions(input: CommitFileVersions): CommitFileVersions {
  return {
    oldContent: input.oldContent,
    newContent: input.newContent,
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

function cloneRepositoryCommits(
  commits: readonly RepositoryCommitSummary[],
): RepositoryCommitSummary[] {
  return commits.map((commit) => ({
    hash: commit.hash,
    shortHash: commit.shortHash,
    summary: commit.summary,
    author: commit.author,
    authorEmail: commit.authorEmail,
    authoredAtIso: commit.authoredAtIso,
  }));
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
      state.fileInspectionMode = "summary";
      state.diffViewMode = "changes";
      state.fileFilter = cloneFileFilter(createDefaultFileFilter());
      state.publishStatus = "ready";
      state.lastPublishPackage = null;
      state.publishResult = null;
      state.publishError = null;
      state.askAgentDraftByThreadId = {};
      state.fileVersionsByFileId = {};
      state.fileVersionsLoadStatusByFileId = {};
      state.fileVersionsErrorByFileId = {};
      state.aiAnalysisStatus = "idle";
      state.aiAnalysis = null;
      state.aiAnalysisError = null;
      state.aiSequenceStatus = "idle";
      state.aiSequenceError = null;
      state.standardsAnalysisStatus = "idle";
      state.standardsAnalysisError = null;
    },
    markLoadFailed(state, action: PayloadAction<{ readonly errorMessage: string }>): void {
      state.loadStatus = "error";
      state.lastError = action.payload.errorMessage;
    },
    setActiveFileId(state, action: PayloadAction<{ readonly fileId: string | null }>): void {
      state.activeFileId = action.payload.fileId;
      state.fileInspectionMode = "summary";
      state.diffViewMode = "changes";
    },
    setDiffOrientation(state, action: PayloadAction<{ readonly orientation: DiffOrientation }>): void {
      state.diffOrientation = action.payload.orientation;
    },
    setFileInspectionMode(
      state,
      action: PayloadAction<SetFileInspectionModePayload>,
    ): void {
      state.fileInspectionMode = action.payload.mode;
    },
    setDiffViewMode(state, action: PayloadAction<SetDiffViewModePayload>): void {
      state.diffViewMode = action.payload.mode;
      state.fileInspectionMode = "diff";
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
    setRepositoryCommits(
      state,
      action: PayloadAction<{ readonly commits: readonly RepositoryCommitSummary[] }>,
    ): void {
      state.repositoryCommits = cloneRepositoryCommits(action.payload.commits);
    },
    fileVersionsLoadStarted(state, action: PayloadAction<FileVersionsLoadStartedPayload>): void {
      state.fileVersionsLoadStatusByFileId[action.payload.fileId] = "loading";
      state.fileVersionsErrorByFileId[action.payload.fileId] = null;
    },
    fileVersionsLoaded(state, action: PayloadAction<FileVersionsLoadedPayload>): void {
      state.fileVersionsByFileId[action.payload.fileId] = cloneFileVersions(action.payload.versions);
      state.fileVersionsLoadStatusByFileId[action.payload.fileId] = "loaded";
      state.fileVersionsErrorByFileId[action.payload.fileId] = null;
    },
    fileVersionsLoadFailed(state, action: PayloadAction<FileVersionsLoadFailedPayload>): void {
      state.fileVersionsLoadStatusByFileId[action.payload.fileId] = "error";
      state.fileVersionsErrorByFileId[action.payload.fileId] = action.payload.errorMessage;
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
    aiAnalysisStarted(state): void {
      state.aiAnalysisStatus = "analysing";
      state.aiAnalysisError = null;
      state.aiSequenceStatus = "idle";
      state.aiSequenceError = null;
    },
    aiAnalysisSucceeded(
      state,
      action: PayloadAction<{ readonly output: AnalyseCommitOutput }>,
    ): void {
      state.aiAnalysisStatus = "analysed";
      const output = action.payload.output;
      state.aiAnalysis = {
        commitId: output.commitId,
        overviewCards: output.overviewCards.map((c) => ({ kind: c.kind, title: c.title, body: c.body })),
        flowComparisons: output.flowComparisons.map((pair) => ({
          beforeTitle: pair.beforeTitle,
          beforeBody: pair.beforeBody,
          afterTitle: pair.afterTitle,
          afterBody: pair.afterBody,
          filePaths: [...pair.filePaths],
        })),
        sequenceSteps: output.sequenceSteps.map((s) => ({
          ...(s.token ? { token: s.token } : {}),
          ...(s.sourceId ? { sourceId: s.sourceId } : {}),
          sourceLabel: s.sourceLabel,
          ...(s.targetId ? { targetId: s.targetId } : {}),
          targetLabel: s.targetLabel,
          message: s.message,
          filePath: s.filePath,
        })),
        fileSummaries: output.fileSummaries.map((f) => ({
          filePath: f.filePath,
          summary: f.summary,
          riskNote: f.riskNote,
        })),
      };
      state.aiAnalysisError = null;
      state.aiSequenceStatus = output.sequenceSteps.length > 0 ? "ready" : "idle";
      state.aiSequenceError = null;
    },
    aiAnalysisFailed(state, action: PayloadAction<{ readonly errorMessage: string }>): void {
      state.aiAnalysisStatus = "error";
      state.aiAnalysisError = action.payload.errorMessage;
      state.aiSequenceStatus = "error";
      state.aiSequenceError = action.payload.errorMessage;
    },
    sequenceGenerationStarted(
      state,
      action: PayloadAction<{ readonly commitId: string }>,
    ): void {
      if (!state.aiAnalysis || state.aiAnalysis.commitId !== action.payload.commitId) {
        return;
      }

      state.aiSequenceStatus = "generating";
      state.aiSequenceError = null;
      state.aiAnalysis = {
        ...state.aiAnalysis,
        sequenceSteps: [],
      };
    },
    sequenceGenerationSucceeded(
      state,
      action: PayloadAction<SequenceGenerationSucceededPayload>,
    ): void {
      if (!state.aiAnalysis || state.aiAnalysis.commitId !== action.payload.commitId) {
        return;
      }

      state.aiAnalysis = {
        ...state.aiAnalysis,
        sequenceSteps: action.payload.sequenceSteps.map((step) => ({
          ...(step.token ? { token: step.token } : {}),
          ...(step.sourceId ? { sourceId: step.sourceId } : {}),
          sourceLabel: step.sourceLabel,
          ...(step.targetId ? { targetId: step.targetId } : {}),
          targetLabel: step.targetLabel,
          message: step.message,
          filePath: step.filePath,
        })),
      };
      state.aiSequenceStatus = "ready";
      state.aiSequenceError = null;
    },
    sequenceGenerationFailed(
      state,
      action: PayloadAction<{ readonly commitId: string; readonly errorMessage: string }>,
    ): void {
      if (!state.aiAnalysis || state.aiAnalysis.commitId !== action.payload.commitId) {
        return;
      }

      state.aiSequenceStatus = "error";
      state.aiSequenceError = action.payload.errorMessage;
    },
    standardsAnalysisStarted(state): void {
      state.standardsAnalysisStatus = "analysing";
      state.standardsAnalysisError = null;
    },
    standardsAnalysisSucceeded(state): void {
      state.standardsAnalysisStatus = "ready";
      state.standardsAnalysisError = null;
    },
    standardsAnalysisFailed(state, action: PayloadAction<{ readonly errorMessage: string }>): void {
      state.standardsAnalysisStatus = "error";
      state.standardsAnalysisError = action.payload.errorMessage;
    },
  },
});

export const reviewUiActions = reviewUiSlice.actions;

export const reviewUiReducer = reviewUiSlice.reducer;
