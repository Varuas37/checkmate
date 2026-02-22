import {
  createListenerMiddleware,
  type TypedStartListening,
} from "@reduxjs/toolkit";

import {
  createAskAgentDraft,
  createCommentThread,
  createPublishReviewPackage,
  selectThreadById,
  selectThreadComments,
  type ReviewRootState,
} from "../../../application/review/index.ts";
import type {
  CommitAnalyser,
  CommitReviewDataSource,
  ReviewPublisher,
  SequenceDiagramGenerator,
  StandardsEvaluator,
} from "../../../domain/review/index.ts";
import {
  analyseCommitRequested,
  askAgentDraftRequested,
  createCommentThreadRequested,
  deleteCommentRequested,
  loadCommitReviewRequested,
  publishReviewRequested,
  regenerateSequenceRequested,
} from "./reviewActions.ts";
import { reviewEntitiesActions } from "./reviewEntitiesSlice.ts";
import { reviewUiActions } from "./reviewUiSlice.ts";
import {
  readAiAnalysisFromStorage,
  writeAiAnalysisToStorage,
  type CachedAiAnalysisData,
} from "../../../shared/index.ts";

export interface ReviewListenerDependencies {
  readonly reviewDataSource: CommitReviewDataSource;
  readonly standardsEvaluator: StandardsEvaluator;
  readonly reviewPublisher: ReviewPublisher;
  readonly commitAnalyser: CommitAnalyser;
  readonly sequenceDiagramGenerator: SequenceDiagramGenerator;
  readonly nowIso: () => string;
  readonly createId: () => string;
}

export interface ReviewListenerMiddlewareBundle {
  readonly listenerMiddleware: ReturnType<typeof createListenerMiddleware<ReviewRootState>>;
  readonly startListening: TypedStartListening<ReviewRootState>;
}

export function createReviewListenerMiddleware(
  deps: ReviewListenerDependencies,
): ReviewListenerMiddlewareBundle {
  const listenerMiddleware = createListenerMiddleware<ReviewRootState>();

  const startListening =
    listenerMiddleware.startListening as TypedStartListening<ReviewRootState>;

  const resolveCommitContext = (
    state: ReviewRootState,
    commitId: string,
  ): {
    readonly commit: NonNullable<ReviewRootState["reviewEntities"]["commitsById"][string]>;
    readonly files: NonNullable<ReviewRootState["reviewEntities"]["filesById"][string]>[];
    readonly hunks: NonNullable<ReviewRootState["reviewEntities"]["hunksById"][string]>[];
  } | null => {
    const commit = state.reviewEntities.commitsById[commitId];
    if (!commit) {
      return null;
    }

    const fileIds = state.reviewEntities.fileIdsByCommitId[commitId] ?? [];
    const files = fileIds
      .map((id) => state.reviewEntities.filesById[id])
      .filter((file): file is NonNullable<typeof file> => file !== undefined);

    const hunks = files.flatMap((file) => {
      const hunkIds = state.reviewEntities.hunkIdsByFileId[file.id] ?? [];
      return hunkIds
        .map((id) => state.reviewEntities.hunksById[id])
        .filter((hunk): hunk is NonNullable<typeof hunk> => hunk !== undefined);
    });

    return {
      commit,
      files,
      hunks,
    };
  };

  const toCachedAnalysisData = (input: {
    overviewCards: CachedAiAnalysisData["overviewCards"];
    flowComparisons: CachedAiAnalysisData["flowComparisons"];
    sequenceSteps: CachedAiAnalysisData["sequenceSteps"];
    fileSummaries: CachedAiAnalysisData["fileSummaries"];
  }): CachedAiAnalysisData => {
    return {
      overviewCards: input.overviewCards.map((card) => ({
        kind: card.kind,
        title: card.title,
        body: card.body,
      })),
      flowComparisons: input.flowComparisons.map((pair) => ({
        beforeTitle: pair.beforeTitle,
        beforeBody: pair.beforeBody,
        afterTitle: pair.afterTitle,
        afterBody: pair.afterBody,
        filePaths: [...pair.filePaths],
      })),
      sequenceSteps: input.sequenceSteps.map((step) => ({
        sourceLabel: step.sourceLabel,
        targetLabel: step.targetLabel,
        message: step.message,
        filePath: step.filePath,
      })),
      fileSummaries: input.fileSummaries.map((summary) => ({
        filePath: summary.filePath,
        summary: summary.summary,
        riskNote: summary.riskNote,
      })),
    };
  };

  startListening({
    actionCreator: loadCommitReviewRequested,
    effect: async (action, listenerApi) => {
      listenerApi.dispatch(reviewUiActions.markLoadStarted());

      try {
        const repositoryCommitsPromise = deps.reviewDataSource
          .listRepositoryCommits({
            repositoryPath: action.payload.repositoryPath,
            limit: 120,
          })
          .catch(() => []);

        const aggregate = await deps.reviewDataSource.loadCommitReview({
          repositoryPath: action.payload.repositoryPath,
          commitSha: action.payload.commitSha,
        });
        const repositoryCommits = await repositoryCommitsPromise;

        const standardsEvaluation = deps.standardsEvaluator.evaluate({
          commitId: aggregate.commit.id,
          ruleText: action.payload.standardsRuleText,
          files: aggregate.files,
          hunks: aggregate.hunks,
        });

        listenerApi.dispatch(
          reviewEntitiesActions.hydrateFromAggregate({
            ...aggregate,
            standardsRules: standardsEvaluation.rules,
            standardsResults: standardsEvaluation.results,
          }),
        );

        listenerApi.dispatch(
          reviewUiActions.hydrateForCommit({
            commitId: aggregate.commit.id,
            firstFileId: aggregate.files[0]?.id ?? null,
          }),
        );
        listenerApi.dispatch(
          reviewUiActions.setRepositoryCommits({
            commits: repositoryCommits,
          }),
        );
        const cachedAiAnalysis = readAiAnalysisFromStorage({
          repositoryPath: aggregate.commit.repositoryPath,
          commitSha: aggregate.commit.commitSha,
        });

        if (cachedAiAnalysis) {
          listenerApi.dispatch(
            reviewUiActions.aiAnalysisSucceeded({
              output: {
                commitId: aggregate.commit.id,
                ...toCachedAnalysisData(cachedAiAnalysis),
              },
            }),
          );
          return;
        }

        listenerApi.dispatch(analyseCommitRequested({ commitId: aggregate.commit.id }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load commit review.";
        listenerApi.dispatch(reviewUiActions.markLoadFailed({ errorMessage: message }));
      }
    },
  });

  startListening({
    actionCreator: createCommentThreadRequested,
    effect: (action, listenerApi) => {
      const created = createCommentThread(action.payload, {
        createId: deps.createId,
        nowIso: deps.nowIso,
      });

      listenerApi.dispatch(reviewEntitiesActions.threadCreated(created));

      const state = listenerApi.getState();
      if (state.reviewUi.activeFileId === null) {
        listenerApi.dispatch(reviewUiActions.setActiveFileId({ fileId: created.thread.fileId }));
      }
    },
  });

  startListening({
    actionCreator: deleteCommentRequested,
    effect: (action, listenerApi) => {
      const state = listenerApi.getState();
      const comment = state.reviewEntities.commentsById[action.payload.commentId];
      if (!comment) {
        return;
      }

      listenerApi.dispatch(
        reviewEntitiesActions.commentDeleted({
          commentId: comment.id,
        }),
      );

      const nextState = listenerApi.getState();
      if (!nextState.reviewEntities.threadsById[comment.threadId]) {
        listenerApi.dispatch(
          reviewUiActions.clearAskAgentDraft({
            threadId: comment.threadId,
          }),
        );
      }
    },
  });

  startListening({
    actionCreator: reviewUiActions.hydrateForCommit,
    effect: (action, listenerApi) => {
      if (!action.payload.firstFileId) {
        return;
      }

      listenerApi.dispatch(
        reviewUiActions.setActiveFileId({
          fileId: action.payload.firstFileId,
        }),
      );
    },
  });

  startListening({
    actionCreator: reviewUiActions.setActiveFileId,
    effect: async (action, listenerApi) => {
      const fileId = action.payload.fileId;
      if (!fileId) {
        return;
      }

      const state = listenerApi.getState();
      const activeCommitId = state.reviewUi.activeCommitId;
      if (!activeCommitId) {
        return;
      }

      const commit = state.reviewEntities.commitsById[activeCommitId];
      const file = state.reviewEntities.filesById[fileId];
      if (!commit || !file) {
        return;
      }

      const currentStatus = state.reviewUi.fileVersionsLoadStatusByFileId[file.id];
      if (currentStatus === "loading" || currentStatus === "loaded") {
        return;
      }

      listenerApi.dispatch(
        reviewUiActions.fileVersionsLoadStarted({
          fileId: file.id,
        }),
      );

      try {
        const versions = await deps.reviewDataSource.readCommitFileVersions({
          repositoryPath: commit.repositoryPath,
          commitSha: commit.commitSha,
          oldPath: file.previousPath ?? file.path,
          newPath: file.path,
        });

        listenerApi.dispatch(
          reviewUiActions.fileVersionsLoaded({
            fileId: file.id,
            versions,
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load file versions.";
        listenerApi.dispatch(
          reviewUiActions.fileVersionsLoadFailed({
            fileId: file.id,
            errorMessage: message,
          }),
        );
      }
    },
  });

  startListening({
    actionCreator: askAgentDraftRequested,
    effect: (action, listenerApi) => {
      const state = listenerApi.getState();
      const thread = selectThreadById(state, action.payload.threadId);

      if (!thread) {
        return;
      }

      const file = state.reviewEntities.filesById[thread.fileId];
      const hunk = state.reviewEntities.hunksById[thread.hunkId];

      if (!file || !hunk) {
        return;
      }

      const comments = selectThreadComments(state, thread.id);
      const prompt = action.payload.reviewerPrompt?.trim();

      const draft =
        prompt && prompt.length > 0
          ? createAskAgentDraft({
              file,
              hunk,
              thread,
              comments,
              reviewerPrompt: prompt,
            })
          : createAskAgentDraft({
              file,
              hunk,
              thread,
              comments,
            });

      listenerApi.dispatch(
        reviewUiActions.setAskAgentDraft({
          threadId: thread.id,
          draft,
        }),
      );
    },
  });

  startListening({
    actionCreator: publishReviewRequested,
    effect: async (action, listenerApi) => {
      try {
        const pkg = createPublishReviewPackage({
          state: listenerApi.getState(),
          generatedAtIso: deps.nowIso(),
        });

        const requestId = deps.createId();
        const requestedAtIso = deps.nowIso();

        listenerApi.dispatch(
          reviewUiActions.publishStarted({
            pkg,
          }),
        );

        const result = await deps.reviewPublisher.publishReview({
          requestId,
          requestedBy: action.payload.requestedBy,
          requestedAtIso,
          commitId: pkg.commitId,
          commitSha: pkg.commitSha,
          payloadJson: JSON.stringify(pkg),
        });

        listenerApi.dispatch(reviewUiActions.publishSucceeded({ result }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to publish review package.";
        listenerApi.dispatch(reviewUiActions.publishFailed({ errorMessage: message }));
      }
    },
  });

  startListening({
    actionCreator: analyseCommitRequested,
    effect: async (action, listenerApi) => {
      const context = resolveCommitContext(listenerApi.getState(), action.payload.commitId);
      if (!context) {
        return;
      }

      listenerApi.dispatch(reviewUiActions.aiAnalysisStarted());

      try {
        const output = await deps.commitAnalyser.analyseCommit({
          commitId: action.payload.commitId,
          commit: context.commit,
          files: context.files,
          hunks: context.hunks,
        });

        writeAiAnalysisToStorage({
          repositoryPath: context.commit.repositoryPath,
          commitSha: context.commit.commitSha,
          analysis: toCachedAnalysisData(output),
        });

        listenerApi.dispatch(reviewUiActions.aiAnalysisSucceeded({ output }));
        listenerApi.dispatch(regenerateSequenceRequested({ commitId: action.payload.commitId }));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to analyse commit with AI.";
        listenerApi.dispatch(reviewUiActions.aiAnalysisFailed({ errorMessage: message }));
      }
    },
  });

  startListening({
    actionCreator: regenerateSequenceRequested,
    effect: async (action, listenerApi) => {
      const context = resolveCommitContext(listenerApi.getState(), action.payload.commitId);
      if (!context) {
        return;
      }

      listenerApi.dispatch(
        reviewUiActions.sequenceGenerationStarted({
          commitId: action.payload.commitId,
        }),
      );

      try {
        const sequenceSteps = await deps.sequenceDiagramGenerator.generateSequenceSteps({
          commitId: action.payload.commitId,
          commit: context.commit,
          files: context.files,
          hunks: context.hunks,
        });

        listenerApi.dispatch(
          reviewUiActions.sequenceGenerationSucceeded({
            commitId: action.payload.commitId,
            sequenceSteps,
          }),
        );

        const nextAiAnalysis = listenerApi.getState().reviewUi.aiAnalysis;
        if (nextAiAnalysis && nextAiAnalysis.commitId === action.payload.commitId) {
          writeAiAnalysisToStorage({
            repositoryPath: context.commit.repositoryPath,
            commitSha: context.commit.commitSha,
            analysis: toCachedAnalysisData(nextAiAnalysis),
          });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to generate sequence diagram.";
        listenerApi.dispatch(
          reviewUiActions.sequenceGenerationFailed({
            commitId: action.payload.commitId,
            errorMessage: message,
          }),
        );
      }
    },
  });

  return {
    listenerMiddleware,
    startListening,
  };
}
