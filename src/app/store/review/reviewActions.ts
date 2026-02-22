import { createAction } from "@reduxjs/toolkit";

import type { LoadCommitReviewInput } from "../../../domain/review/index.ts";
import type { CreateCommentThreadInput } from "../../../application/review/index.ts";

export interface LoadCommitReviewRequestedPayload extends LoadCommitReviewInput {
  readonly standardsRuleText: string;
}

export interface AskAgentDraftRequestedPayload {
  readonly threadId: string;
  readonly reviewerPrompt?: string;
}

export interface DeleteCommentRequestedPayload {
  readonly commentId: string;
}

export interface PublishReviewRequestedPayload {
  readonly requestedBy: string;
}

export const loadCommitReviewRequested = createAction<LoadCommitReviewRequestedPayload>(
  "review/loadCommitReviewRequested",
);

export const createCommentThreadRequested = createAction<CreateCommentThreadInput>(
  "review/createCommentThreadRequested",
);

export const askAgentDraftRequested = createAction<AskAgentDraftRequestedPayload>(
  "review/askAgentDraftRequested",
);

export const deleteCommentRequested = createAction<DeleteCommentRequestedPayload>(
  "review/deleteCommentRequested",
);

export const publishReviewRequested = createAction<PublishReviewRequestedPayload>(
  "review/publishReviewRequested",
);

export interface AnalyseCommitRequestedPayload {
  readonly commitId: string;
}

export const analyseCommitRequested = createAction<AnalyseCommitRequestedPayload>(
  "review/analyseCommitRequested",
);

export interface AnalyseStandardsRequestedPayload {
  readonly commitId: string;
}

export const analyseStandardsRequested = createAction<AnalyseStandardsRequestedPayload>(
  "review/analyseStandardsRequested",
);

export interface RegenerateSequenceRequestedPayload {
  readonly commitId: string;
}

export const regenerateSequenceRequested = createAction<RegenerateSequenceRequestedPayload>(
  "review/regenerateSequenceRequested",
);
