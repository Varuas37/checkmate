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
  CommitReviewDataSource,
  ReviewPublisher,
  StandardsEvaluator,
} from "../../../domain/review/index.ts";
import {
  askAgentDraftRequested,
  createCommentThreadRequested,
  loadCommitReviewRequested,
  publishReviewRequested,
} from "./reviewActions.ts";
import { reviewEntitiesActions } from "./reviewEntitiesSlice.ts";
import { reviewUiActions } from "./reviewUiSlice.ts";

export interface ReviewListenerDependencies {
  readonly reviewDataSource: CommitReviewDataSource;
  readonly standardsEvaluator: StandardsEvaluator;
  readonly reviewPublisher: ReviewPublisher;
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

  return {
    listenerMiddleware,
    startListening,
  };
}
