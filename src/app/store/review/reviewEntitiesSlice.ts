import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import {
  createEmptyReviewEntitiesState,
  normalizeCommitReviewAggregate,
  type ReviewEntitiesState,
} from "../../../application/review/index.ts";
import type {
  CommentThread,
  CommitReviewAggregate,
  ReviewComment,
  StandardsResult,
  StandardsRule,
} from "../../../domain/review/index.ts";

export interface ThreadCreatedPayload {
  readonly thread: CommentThread;
  readonly firstComment: ReviewComment;
}

export interface CommentAddedPayload {
  readonly comment: ReviewComment;
}

export interface CommentDeletedPayload {
  readonly commentId: string;
}

export interface StandardsEvaluatedPayload {
  readonly commitId: string;
  readonly rules: readonly StandardsRule[];
  readonly results: readonly StandardsResult[];
}

const initialState = createEmptyReviewEntitiesState();

export const reviewEntitiesSlice = createSlice({
  name: "reviewEntities",
  initialState,
  reducers: {
    hydrateFromAggregate(_state, action: PayloadAction<CommitReviewAggregate>): ReviewEntitiesState {
      return normalizeCommitReviewAggregate(action.payload);
    },
    threadCreated(state, action: PayloadAction<ThreadCreatedPayload>): void {
      const { thread, firstComment } = action.payload;

      state.threadsById[thread.id] = {
        ...thread,
        messageIds: [...thread.messageIds],
      };
      state.commentsById[firstComment.id] = firstComment;

      const threadIds = state.threadIdsByFileId[thread.fileId] ?? [];
      if (!threadIds.includes(thread.id)) {
        state.threadIdsByFileId[thread.fileId] = [...threadIds, thread.id];
      }

      const commentIds = state.commentIdsByThreadId[thread.id] ?? [];
      if (!commentIds.includes(firstComment.id)) {
        state.commentIdsByThreadId[thread.id] = [...commentIds, firstComment.id];
      }
    },
    commentAdded(state, action: PayloadAction<CommentAddedPayload>): void {
      const { comment } = action.payload;
      state.commentsById[comment.id] = comment;

      const commentIds = state.commentIdsByThreadId[comment.threadId] ?? [];
      if (!commentIds.includes(comment.id)) {
        state.commentIdsByThreadId[comment.threadId] = [...commentIds, comment.id];
      }

      const thread = state.threadsById[comment.threadId];
      if (!thread) {
        return;
      }

      const nextMessageIds = thread.messageIds.includes(comment.id)
        ? thread.messageIds
        : [...thread.messageIds, comment.id];

      state.threadsById[comment.threadId] = {
        ...thread,
        messageIds: nextMessageIds,
        updatedAtIso: comment.createdAtIso,
      };
    },
    commentDeleted(state, action: PayloadAction<CommentDeletedPayload>): void {
      const commentId = action.payload.commentId;
      const comment = state.commentsById[commentId];
      if (!comment) {
        return;
      }

      const threadId = comment.threadId;
      delete state.commentsById[commentId];

      const commentIds = state.commentIdsByThreadId[threadId] ?? [];
      const nextCommentIds = commentIds.filter((id) => id !== commentId);
      if (nextCommentIds.length > 0) {
        state.commentIdsByThreadId[threadId] = nextCommentIds;
      } else {
        delete state.commentIdsByThreadId[threadId];
      }

      const thread = state.threadsById[threadId];
      if (!thread) {
        return;
      }

      const nextMessageIds = thread.messageIds.filter((id) => id !== commentId);
      if (nextMessageIds.length > 0) {
        state.threadsById[threadId] = {
          ...thread,
          messageIds: nextMessageIds,
        };
        return;
      }

      delete state.threadsById[threadId];
      const fileThreadIds = state.threadIdsByFileId[thread.fileId] ?? [];
      const nextFileThreadIds = fileThreadIds.filter((id) => id !== threadId);
      if (nextFileThreadIds.length > 0) {
        state.threadIdsByFileId[thread.fileId] = nextFileThreadIds;
      } else {
        delete state.threadIdsByFileId[thread.fileId];
      }
    },
    standardsEvaluated(state, action: PayloadAction<StandardsEvaluatedPayload>): void {
      const { commitId, rules, results } = action.payload;

      state.standardsRulesById = {};
      state.standardsRuleIds = [];
      rules.forEach((rule) => {
        state.standardsRulesById[rule.id] = rule;
        state.standardsRuleIds.push(rule.id);
      });

      state.standardsResultsById = {};
      const resultIds: string[] = [];
      results.forEach((result) => {
        state.standardsResultsById[result.id] = {
          ...result,
          evidence: [...result.evidence],
        };
        resultIds.push(result.id);
      });

      state.standardsResultIdsByCommitId[commitId] = resultIds;
    },
  },
});

export const reviewEntitiesActions = reviewEntitiesSlice.actions;

export const reviewEntitiesReducer = reviewEntitiesSlice.reducer;
