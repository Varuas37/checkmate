import { combineReducers, configureStore } from "@reduxjs/toolkit";

import type { ReviewRootState } from "../../../application/review/index.ts";
import {
  createMockCommitReviewDataSource,
  createRuleTextStandardsEvaluator,
} from "../../../infrastructure/review/index.ts";
import {
  createReviewListenerMiddleware,
  type ReviewListenerDependencies,
} from "./reviewListeners.ts";
import { reviewEntitiesReducer } from "./reviewEntitiesSlice.ts";
import { reviewUiReducer } from "./reviewUiSlice.ts";

const reviewReducer = combineReducers({
  reviewEntities: reviewEntitiesReducer,
  reviewUi: reviewUiReducer,
});

function createIncrementingIdFactory(prefix: string): () => string {
  let sequence = 0;

  return () => {
    sequence += 1;
    return `${prefix}-${sequence}`;
  };
}

export interface CreateReviewStoreOptions {
  readonly dependencies?: Partial<ReviewListenerDependencies>;
}

export function createReviewStore(options: CreateReviewStoreOptions = {}) {
  const defaultDependencies: ReviewListenerDependencies = {
    reviewDataSource: createMockCommitReviewDataSource(),
    standardsEvaluator: createRuleTextStandardsEvaluator(),
    nowIso: () => new Date().toISOString(),
    createId: createIncrementingIdFactory("review"),
  };

  const dependencies: ReviewListenerDependencies = {
    ...defaultDependencies,
    ...options.dependencies,
  };

  const listenerBundle = createReviewListenerMiddleware(dependencies);

  const store = configureStore({
    reducer: reviewReducer,
    middleware: (getDefaultMiddleware) => {
      return getDefaultMiddleware({
        serializableCheck: true,
      }).prepend(listenerBundle.listenerMiddleware.middleware);
    },
  });

  return store;
}

export type ReviewStore = ReturnType<typeof createReviewStore>;
export type ReviewDispatch = ReviewStore["dispatch"];
export type ReviewStateFromStore = ReturnType<ReviewStore["getState"]>;

export type { ReviewRootState };
