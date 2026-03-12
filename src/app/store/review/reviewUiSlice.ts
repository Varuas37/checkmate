import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { castDraft } from "immer";

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
  AiFileSummary,
  AiFlowComparison,
  AiOverviewCard,
  AiSequenceStep,
  AnalyseCommitOutput,
  CommitFileVersions,
  DiffOrientation,
  PublishReviewResult,
  RepositoryCommitSummary,
  StandardsResult,
  StandardsRule,
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

export interface AiAnalysisStartedPayload {
  readonly commitId: string;
}

export interface AiFileSummaryReceivedPayload {
  readonly commitId: string;
  readonly summary: AiFileSummary;
}

export interface AiAnalysisStandardsAppliedPayload {
  readonly commitId: string;
  readonly standardsRules: readonly StandardsRule[];
  readonly standardsResults: readonly StandardsResult[];
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

function cloneAiOverviewCard(card: AiOverviewCard): AiOverviewCard {
  return {
    kind: card.kind,
    title: card.title,
    body: card.body,
  };
}

function cloneAiFlowComparison(pair: AiFlowComparison): AiFlowComparison {
  return {
    beforeTitle: pair.beforeTitle,
    beforeBody: pair.beforeBody,
    afterTitle: pair.afterTitle,
    afterBody: pair.afterBody,
    ...(pair.technicalDetails
      ? {
          technicalDetails: pair.technicalDetails,
        }
      : {}),
    ...(pair.hunkHeadersByFile && pair.hunkHeadersByFile.length > 0
      ? {
          hunkHeadersByFile: pair.hunkHeadersByFile.map((entry) => ({
            filePath: entry.filePath,
            hunkHeaders: [...entry.hunkHeaders],
          })),
        }
      : {}),
    filePaths: [...pair.filePaths],
  };
}

function cloneAiSequenceStep(step: AiSequenceStep): AiSequenceStep {
  return {
    ...(step.token ? { token: step.token } : {}),
    ...(step.sourceId ? { sourceId: step.sourceId } : {}),
    sourceLabel: step.sourceLabel,
    ...(step.targetId ? { targetId: step.targetId } : {}),
    targetLabel: step.targetLabel,
    message: step.message,
    filePath: step.filePath,
  };
}

function cloneAiFileSummary(summary: AiFileSummary): AiFileSummary {
  return {
    filePath: summary.filePath,
    summary: summary.summary,
    riskNote: summary.riskNote,
    ...(summary.technicalDetails
      ? {
          technicalDetails: summary.technicalDetails,
        }
      : {}),
  };
}

function cloneStandardsRule(rule: StandardsRule): StandardsRule {
  return {
    id: rule.id,
    title: rule.title,
    description: rule.description,
    severity: rule.severity,
  };
}

function cloneStandardsResult(result: StandardsResult): StandardsResult {
  return {
    id: result.id,
    commitId: result.commitId,
    ruleId: result.ruleId,
    status: result.status,
    summary: result.summary,
    evidence: result.evidence.map((item) => ({
      ...(item.fileId ? { fileId: item.fileId } : {}),
      ...(item.filePath ? { filePath: item.filePath } : {}),
      ...(item.hunkId ? { hunkId: item.hunkId } : {}),
      ...(item.lineNumber ? { lineNumber: item.lineNumber } : {}),
      note: item.note,
    })),
  };
}

function createEmptyAiAnalysis(commitId: string): AnalyseCommitOutput {
  return {
    commitId,
    overviewCards: [],
    flowComparisons: [],
    sequenceSteps: [],
    fileSummaries: [],
    standardsRules: [],
    standardsResults: [],
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
    aiAnalysisStarted(state, action: PayloadAction<AiAnalysisStartedPayload>): void {
      state.aiAnalysisStatus = "analysing";
      state.aiAnalysisError = null;
      state.aiSequenceStatus = "idle";
      state.aiSequenceError = null;

      if (!state.aiAnalysis || state.aiAnalysis.commitId !== action.payload.commitId) {
        state.aiAnalysis = castDraft(createEmptyAiAnalysis(action.payload.commitId));
      }
    },
    aiFileSummaryReceived(
      state,
      action: PayloadAction<AiFileSummaryReceivedPayload>,
    ): void {
      const currentAnalysis =
        state.aiAnalysis && state.aiAnalysis.commitId === action.payload.commitId
          ? state.aiAnalysis
          : createEmptyAiAnalysis(action.payload.commitId);
      const nextSummary = cloneAiFileSummary(action.payload.summary);
      const existingIndex = currentAnalysis.fileSummaries.findIndex(
        (summary) => summary.filePath === nextSummary.filePath,
      );
      const nextFileSummaries =
        existingIndex >= 0
          ? currentAnalysis.fileSummaries.map((summary, index) =>
              index === existingIndex ? nextSummary : summary
            )
          : [...currentAnalysis.fileSummaries, nextSummary];

      state.aiAnalysis = castDraft({
        ...currentAnalysis,
        fileSummaries: nextFileSummaries,
      });
    },
    aiAnalysisSucceeded(
      state,
      action: PayloadAction<{ readonly output: AnalyseCommitOutput }>,
    ): void {
      state.aiAnalysisStatus = "analysed";
      const output = action.payload.output;
      const existingAnalysis =
        state.aiAnalysis && state.aiAnalysis.commitId === output.commitId
          ? state.aiAnalysis
          : null;
      const nextSequenceSteps =
        output.sequenceSteps.length > 0
          ? output.sequenceSteps.map(cloneAiSequenceStep)
          : existingAnalysis?.sequenceSteps ?? [];
      const nextStandardsRules =
        output.standardsRules.length > 0
          ? output.standardsRules.map(cloneStandardsRule)
          : existingAnalysis?.standardsRules ?? [];
      const nextStandardsResults =
        output.standardsResults.length > 0
          ? output.standardsResults.map(cloneStandardsResult)
          : existingAnalysis?.standardsResults ?? [];

      state.aiAnalysis = castDraft({
        commitId: output.commitId,
        overviewCards: output.overviewCards.map(cloneAiOverviewCard),
        flowComparisons: output.flowComparisons.map(cloneAiFlowComparison),
        sequenceSteps: nextSequenceSteps,
        fileSummaries: output.fileSummaries.map(cloneAiFileSummary),
        standardsRules: nextStandardsRules,
        standardsResults: nextStandardsResults,
      });
      state.aiAnalysisError = null;
      if (nextSequenceSteps.length > 0) {
        state.aiSequenceStatus = "ready";
        state.aiSequenceError = null;
      } else if (state.aiSequenceStatus === "idle") {
        state.aiSequenceStatus = "idle";
        state.aiSequenceError = null;
      }
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
      state.aiAnalysis = castDraft({
        ...state.aiAnalysis,
        sequenceSteps: [],
      });
    },
    sequenceGenerationSucceeded(
      state,
      action: PayloadAction<SequenceGenerationSucceededPayload>,
    ): void {
      if (!state.aiAnalysis || state.aiAnalysis.commitId !== action.payload.commitId) {
        return;
      }

      state.aiAnalysis = castDraft({
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
      });
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
    aiAnalysisStandardsApplied(
      state,
      action: PayloadAction<AiAnalysisStandardsAppliedPayload>,
    ): void {
      if (!state.aiAnalysis || state.aiAnalysis.commitId !== action.payload.commitId) {
        return;
      }

      state.aiAnalysis = castDraft({
        ...state.aiAnalysis,
        standardsRules: action.payload.standardsRules.map(cloneStandardsRule),
        standardsResults: action.payload.standardsResults.map(cloneStandardsResult),
      });
    },
    standardsAnalysisFailed(state, action: PayloadAction<{ readonly errorMessage: string }>): void {
      state.standardsAnalysisStatus = "error";
      state.standardsAnalysisError = action.payload.errorMessage;
    },
  },
});

export const reviewUiActions = reviewUiSlice.actions;

export const reviewUiReducer = reviewUiSlice.reducer;
