import { useCallback, useEffect, useMemo } from "react";

import {
  selectActiveCommit,
  selectActiveFile,
  selectFilesForActiveCommit,
  selectFilteredFiles,
  selectResolvedActiveFileId,
  selectReviewEntities,
  selectReviewUi,
} from "../../../application/review/index.ts";
import {
  askAgentDraftRequested,
  createCommentThreadRequested,
  loadCommitReviewRequested,
  publishReviewRequested,
  reviewUiActions,
} from "../../../app/store/review/index.ts";
import type { FileChangeStatus, ThreadStatus } from "../../../domain/review/index.ts";
import { DEFAULT_LOAD_REQUEST, DEFAULT_STANDARDS_RULE_TEXT } from "../constants.ts";
import type {
  CreateThreadInput,
  ReloadReviewWorkspaceInput,
  ReviewWorkspaceActions,
  ReviewWorkspaceState,
} from "../types.ts";
import { useReviewDispatch, useReviewSelector } from "./useReviewStoreHooks.ts";

function titleCase(value: string): string {
  if (value.length === 0) {
    return "Root";
  }

  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function deriveLayer(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);

  if (segments.length >= 2) {
    return segments[1] ?? segments[0] ?? "root";
  }

  return segments[0] ?? "root";
}

function summarizeRisk(additions: number, deletions: number): string {
  const churn = additions + deletions;

  if (churn >= 120) {
    return "Higher review risk due to broad churn; verify side effects carefully.";
  }

  if (churn >= 40) {
    return "Moderate risk surface; confirm behavior around touched workflows.";
  }

  return "Low direct churn; focus on correctness and standards alignment.";
}

function normalizeReloadInput(input: ReloadReviewWorkspaceInput): ReloadReviewWorkspaceInput {
  const repositoryPath = input.repositoryPath.trim();
  const commitSha = input.commitSha.trim();
  const standardsRuleText = input.standardsRuleText.trim();

  return {
    repositoryPath: repositoryPath.length > 0 ? repositoryPath : DEFAULT_LOAD_REQUEST.repositoryPath,
    commitSha: commitSha.length > 0 ? commitSha : DEFAULT_LOAD_REQUEST.commitSha,
    standardsRuleText: standardsRuleText.length > 0 ? standardsRuleText : DEFAULT_STANDARDS_RULE_TEXT,
  };
}

export function useReviewWorkspace(): {
  readonly state: ReviewWorkspaceState;
  readonly actions: ReviewWorkspaceActions;
} {
  const dispatch = useReviewDispatch();

  const commit = useReviewSelector(selectActiveCommit);
  const activeFile = useReviewSelector(selectActiveFile);
  const activeFileId = useReviewSelector(selectResolvedActiveFileId);
  const allFiles = useReviewSelector(selectFilesForActiveCommit);
  const filteredFiles = useReviewSelector(selectFilteredFiles);
  const entities = useReviewSelector(selectReviewEntities);
  const ui = useReviewSelector(selectReviewUi);

  useEffect(() => {
    if (ui.loadStatus !== "idle") {
      return;
    }

    dispatch(
      loadCommitReviewRequested(
        normalizeReloadInput({
          ...DEFAULT_LOAD_REQUEST,
          standardsRuleText: DEFAULT_STANDARDS_RULE_TEXT,
        }),
      ),
    );
  }, [dispatch, ui.loadStatus]);

  const overviewCards = useMemo(() => {
    const activeCommitId = ui.activeCommitId;

    if (!activeCommitId) {
      return [];
    }

    const cardIds = entities.overviewCardIdsByCommitId[activeCommitId] ?? [];

    return cardIds
      .map((cardId) => entities.overviewCardsById[cardId])
      .filter((card): card is NonNullable<typeof card> => card !== undefined)
      .sort((left, right) => left.rank - right.rank);
  }, [entities.overviewCardIdsByCommitId, entities.overviewCardsById, ui.activeCommitId]);

  const activeFileHunks = useMemo(() => {
    if (!activeFile) {
      return [];
    }

    const hunkIds = entities.hunkIdsByFileId[activeFile.id] ?? [];

    return hunkIds
      .map((hunkId) => entities.hunksById[hunkId])
      .filter((hunk): hunk is NonNullable<typeof hunk> => hunk !== undefined)
      .sort((left, right) => {
        if (left.newStart !== right.newStart) {
          return left.newStart - right.newStart;
        }

        return left.id.localeCompare(right.id);
      });
  }, [activeFile, entities.hunkIdsByFileId, entities.hunksById]);

  const architectureClusters = useMemo(() => {
    const clusters = new Map<
      string,
      {
        id: string;
        label: string;
        fileIds: string[];
        additions: number;
        deletions: number;
        fileCount: number;
      }
    >();

    allFiles.forEach((file) => {
      const layerKey = deriveLayer(file.path);
      const current = clusters.get(layerKey);

      if (!current) {
        clusters.set(layerKey, {
          id: `cluster-${layerKey}`,
          label: titleCase(layerKey),
          fileIds: [file.id],
          additions: file.additions,
          deletions: file.deletions,
          fileCount: 1,
        });
        return;
      }

      current.fileIds.push(file.id);
      current.additions += file.additions;
      current.deletions += file.deletions;
      current.fileCount += 1;
    });

    return [...clusters.values()].sort((left, right) => {
      const leftMagnitude = left.additions + left.deletions;
      const rightMagnitude = right.additions + right.deletions;

      if (leftMagnitude !== rightMagnitude) {
        return rightMagnitude - leftMagnitude;
      }

      return left.label.localeCompare(right.label);
    });
  }, [allFiles]);

  const sequencePairs = useMemo(() => {
    return allFiles.map((file, index) => {
      const linkedCard = overviewCards.length > 0 ? overviewCards[index % overviewCards.length] : null;
      const layer = titleCase(deriveLayer(file.path));
      const beforeBody =
        linkedCard?.body ??
        `Manual review had to infer ${layer} behavior from raw diffs without structured context.`;

      return {
        id: `sequence-${file.id}`,
        before: {
          id: `before-${file.id}`,
          title: `Before: ${layer} flow`,
          body: beforeBody,
          fileIds: [file.id],
        },
        after: {
          id: `after-${file.id}`,
          title: `After: ${file.status.toUpperCase()} ${file.path}`,
          body: `Changes are now linked to ${file.additions} additions and ${file.deletions} deletions for direct follow-up.`,
          fileIds: [file.id],
        },
      };
    });
  }, [allFiles, overviewCards]);

  const standardsChecks = useMemo(() => {
    const activeCommitId = ui.activeCommitId;

    const rules = entities.standardsRuleIds
      .map((ruleId) => entities.standardsRulesById[ruleId])
      .filter((rule): rule is NonNullable<typeof rule> => rule !== undefined);

    if (!activeCommitId) {
      return rules.map((rule) => ({ rule, result: null }));
    }

    const resultIds = entities.standardsResultIdsByCommitId[activeCommitId] ?? [];
    const resultsByRuleId = new Map(
      resultIds
        .map((resultId) => entities.standardsResultsById[resultId])
        .filter((result): result is NonNullable<typeof result> => result !== undefined)
        .map((result) => [result.ruleId, result] as const),
    );

    return rules.map((rule) => ({
      rule,
      result: resultsByRuleId.get(rule.id) ?? null,
    }));
  }, [
    entities.standardsResultIdsByCommitId,
    entities.standardsResultsById,
    entities.standardsRuleIds,
    entities.standardsRulesById,
    ui.activeCommitId,
  ]);

  const standardsCounts = useMemo(() => {
    return standardsChecks.reduce(
      (counts, check) => {
        if (!check.result) {
          return counts;
        }

        if (check.result.status === "pass") {
          return {
            ...counts,
            pass: counts.pass + 1,
          };
        }

        if (check.result.status === "warn") {
          return {
            ...counts,
            warn: counts.warn + 1,
          };
        }

        return {
          ...counts,
          fail: counts.fail + 1,
        };
      },
      { pass: 0, warn: 0, fail: 0 },
    );
  }, [standardsChecks]);

  const threadModels = useMemo(() => {
    if (!activeFile) {
      return [];
    }

    const threadIds = entities.threadIdsByFileId[activeFile.id] ?? [];

    return threadIds
      .map((threadId) => entities.threadsById[threadId])
      .filter((thread): thread is NonNullable<typeof thread> => thread !== undefined)
      .sort((left, right) => {
        if (left.anchor.lineNumber !== right.anchor.lineNumber) {
          return left.anchor.lineNumber - right.anchor.lineNumber;
        }

        return left.id.localeCompare(right.id);
      })
      .map((thread) => {
        const commentIds = entities.commentIdsByThreadId[thread.id] ?? thread.messageIds;
        const comments = commentIds
          .map((commentId) => entities.commentsById[commentId])
          .filter((comment): comment is NonNullable<typeof comment> => comment !== undefined)
          .sort((left, right) => left.createdAtIso.localeCompare(right.createdAtIso));

        return {
          thread,
          comments,
          askAgentDraft: ui.askAgentDraftByThreadId[thread.id] ?? "",
        };
      });
  }, [
    activeFile,
    entities.commentIdsByThreadId,
    entities.commentsById,
    entities.threadIdsByFileId,
    entities.threadsById,
    ui.askAgentDraftByThreadId,
  ]);

  const fileSummaries = useMemo(() => {
    return allFiles.map((file) => {
      const firstHunkId = entities.hunkIdsByFileId[file.id]?.[0] ?? null;
      const firstHunk = firstHunkId ? entities.hunksById[firstHunkId] : null;
      const headerNote = firstHunk?.header ? ` Primary hunk ${firstHunk.header}.` : "";

      return {
        fileId: file.id,
        path: file.path,
        status: file.status,
        summary: `${titleCase(file.status)} file with +${file.additions}/-${file.deletions}.${headerNote}`,
        riskNote: summarizeRisk(file.additions, file.deletions),
      };
    });
  }, [allFiles, entities.hunkIdsByFileId, entities.hunksById]);

  const selectFile = useCallback(
    (fileId: string | null) => {
      dispatch(reviewUiActions.setActiveFileId({ fileId }));
    },
    [dispatch],
  );

  const reloadReviewWorkspace = useCallback(
    (input: ReloadReviewWorkspaceInput) => {
      dispatch(loadCommitReviewRequested(normalizeReloadInput(input)));
    },
    [dispatch],
  );

  const setDiffOrientation = useCallback(
    (orientation: "split" | "unified") => {
      dispatch(reviewUiActions.setDiffOrientation({ orientation }));
    },
    [dispatch],
  );

  const setFilterQuery = useCallback(
    (query: string) => {
      dispatch(
        reviewUiActions.patchFileFilter({
          patch: {
            query,
          },
        }),
      );
    },
    [dispatch],
  );

  const toggleFilterStatus = useCallback(
    (status: FileChangeStatus) => {
      const nextStatuses = ui.fileFilter.statuses.includes(status)
        ? ui.fileFilter.statuses.filter((item) => item !== status)
        : [...ui.fileFilter.statuses, status];

      dispatch(
        reviewUiActions.patchFileFilter({
          patch: {
            statuses: nextStatuses,
          },
        }),
      );
    },
    [dispatch, ui.fileFilter.statuses],
  );

  const setOnlyCommented = useCallback(
    (enabled: boolean) => {
      dispatch(
        reviewUiActions.patchFileFilter({
          patch: {
            onlyCommented: enabled,
          },
        }),
      );
    },
    [dispatch],
  );

  const setOnlyFailingStandards = useCallback(
    (enabled: boolean) => {
      dispatch(
        reviewUiActions.patchFileFilter({
          patch: {
            onlyFailingStandards: enabled,
          },
        }),
      );
    },
    [dispatch],
  );

  const setThreadStatusFilter = useCallback(
    (status: ThreadStatus | "all") => {
      dispatch(
        reviewUiActions.patchFileFilter({
          patch: {
            threadStatus: status,
          },
        }),
      );
    },
    [dispatch],
  );

  const createThread = useCallback(
    (input: CreateThreadInput) => {
      if (!ui.activeCommitId || !activeFile) {
        return {
          ok: false,
          message: "Select an active file before creating a thread.",
        };
      }

      if (input.body.trim().length === 0) {
        return {
          ok: false,
          message: "Comment body is required.",
        };
      }

      if (!Number.isInteger(input.lineNumber) || input.lineNumber <= 0) {
        return {
          ok: false,
          message: "Line number must be a positive integer.",
        };
      }

      const hunkExists = activeFileHunks.some((hunk) => hunk.id === input.hunkId);

      if (!hunkExists) {
        return {
          ok: false,
          message: "Selected hunk was not found for this file.",
        };
      }

      dispatch(
        createCommentThreadRequested({
          commitId: ui.activeCommitId,
          fileId: activeFile.id,
          hunkId: input.hunkId,
          side: input.side,
          lineNumber: input.lineNumber,
          body: input.body,
          authorId: input.authorId,
        }),
      );

      return {
        ok: true,
        message: "Thread created.",
      };
    },
    [activeFile, activeFileHunks, dispatch, ui.activeCommitId],
  );

  const askAgent = useCallback(
    (threadId: string, prompt: string) => {
      const normalizedPrompt = prompt.trim();

      if (normalizedPrompt.length === 0) {
        dispatch(
          askAgentDraftRequested({
            threadId,
          }),
        );
        return;
      }

      dispatch(
        askAgentDraftRequested({
          threadId,
          reviewerPrompt: normalizedPrompt,
        }),
      );
    },
    [dispatch],
  );

  const publishReview = useCallback(() => {
    dispatch(
      publishReviewRequested({
        requestedBy: "ui-reviewer",
      }),
    );
  }, [dispatch]);

  return {
    state: {
      loadStatus: ui.loadStatus,
      errorMessage: ui.lastError,
      commit,
      activeFile,
      activeFileId,
      allFiles,
      filteredFiles,
      activeFileHunks,
      diffOrientation: ui.diffOrientation,
      fileFilter: ui.fileFilter,
      overviewCards,
      architectureClusters,
      sequencePairs,
      standardsChecks,
      threadModels,
      fileSummaries,
      publishPackage: ui.lastPublishPackage,
      standardsCounts,
      isPublishingReady: ui.activeCommitId !== null,
    },
    actions: {
      reloadReviewWorkspace,
      selectFile,
      setDiffOrientation,
      setFilterQuery,
      toggleFilterStatus,
      setOnlyCommented,
      setOnlyFailingStandards,
      setThreadStatusFilter,
      createThread,
      askAgent,
      publishReview,
    },
  };
}
