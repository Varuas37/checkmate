import { useCallback, useMemo } from "react";

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
  analyseCommitRequested,
  analyseStandardsRequested,
  askAgentDraftRequested,
  createCommentThreadRequested,
  deleteCommentRequested,
  loadCommitReviewRequested,
  publishReviewRequested,
  regenerateSequenceRequested,
  reviewEntitiesActions,
  reviewUiActions,
} from "../../../app/store/review/index.ts";
import type {
  FileChangeStatus,
  RepositoryCommitSummary,
  ThreadStatus,
} from "../../../domain/review/index.ts";
import {
  readRepositoryCommits,
  readRepositoryReviewCommits,
  stripCheckmateMentions,
} from "../../../shared/index.ts";
import { DEFAULT_LOAD_REQUEST, DEFAULT_STANDARDS_RULE_TEXT } from "../constants.ts";
import type {
  CodeSequenceStep,
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

function fileNameForPath(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

function normalizeSequenceId(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replaceAll(/[^A-Za-z0-9_-]/g, "_")
    .replaceAll(/_+/g, "_")
    .replaceAll(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized.slice(0, 48) : fallback;
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

function mergeRepositoryCommits(
  recentCommits: readonly RepositoryCommitSummary[],
  branchOnlyCommits: readonly RepositoryCommitSummary[],
): readonly RepositoryCommitSummary[] {
  const combined = [...recentCommits, ...branchOnlyCommits];
  const seen = new Set<string>();
  const deduped: RepositoryCommitSummary[] = [];

  combined.forEach((commit) => {
    if (seen.has(commit.hash)) {
      return;
    }
    seen.add(commit.hash);
    deduped.push(commit);
  });

  return deduped;
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

  const hasAiAnalysis =
    ui.aiAnalysis !== null && ui.aiAnalysis.commitId === ui.activeCommitId;

  const overviewCards = useMemo(() => {
    const activeCommitId = ui.activeCommitId;

    if (!activeCommitId) {
      return [];
    }

    if (hasAiAnalysis && ui.aiAnalysis !== null) {
      return ui.aiAnalysis.overviewCards.map((card, index) => ({
        id: `ai-card-${activeCommitId}-${index}`,
        commitId: activeCommitId,
        kind: card.kind,
        title: card.title,
        body: card.body,
        rank: index + 1,
      }));
    }

    const cardIds = entities.overviewCardIdsByCommitId[activeCommitId] ?? [];

    return cardIds
      .map((cardId) => entities.overviewCardsById[cardId])
      .filter((card): card is NonNullable<typeof card> => card !== undefined)
      .sort((left, right) => left.rank - right.rank);
  }, [
    entities.overviewCardIdsByCommitId,
    entities.overviewCardsById,
    hasAiAnalysis,
    ui.activeCommitId,
    ui.aiAnalysis,
  ]);

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

  const activeFileVersions =
    activeFileId !== null ? ui.fileVersionsByFileId[activeFileId] ?? null : null;
  const activeFileVersionsStatus =
    activeFileId !== null
      ? ui.fileVersionsLoadStatusByFileId[activeFileId] ?? "idle"
      : "idle";
  const activeFileVersionsError =
    activeFileId !== null
      ? ui.fileVersionsErrorByFileId[activeFileId] ?? null
      : null;

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
    if (hasAiAnalysis && ui.aiAnalysis !== null && ui.aiAnalysis.flowComparisons.length > 0) {
      return ui.aiAnalysis.flowComparisons.slice(0, 8).map((pair, index) => {
        const fileIds = pair.filePaths
          .map((filePath) => allFiles.find((file) => file.path === filePath)?.id ?? null)
          .filter((fileId): fileId is string => fileId !== null);

        const uniqueFileIds = [...new Set(fileIds)];
        return {
          id: `ai-flow-${index + 1}`,
          before: {
            id: `ai-flow-before-${index + 1}`,
            title: pair.beforeTitle,
            body: pair.beforeBody,
            fileIds: uniqueFileIds,
          },
          after: {
            id: `ai-flow-after-${index + 1}`,
            title: pair.afterTitle,
            body: pair.afterBody,
            fileIds: uniqueFileIds,
          },
        };
      });
    }

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
  }, [allFiles, hasAiAnalysis, overviewCards, ui.aiAnalysis]);

  const codeSequenceSteps = useMemo<readonly CodeSequenceStep[]>(() => {
    if (hasAiAnalysis && ui.aiAnalysis !== null) {
      return ui.aiAnalysis.sequenceSteps.slice(0, 12).map((step, index) => {
        const matchedFile = allFiles.find((f) => f.path === step.filePath);
        const sourceId = normalizeSequenceId(step.sourceId ?? step.sourceLabel, `source_${index + 1}`);
        const targetId = normalizeSequenceId(step.targetId ?? step.targetLabel, `target_${index + 1}`);
        return {
          id: `ai-step-${index + 1}`,
          token: normalizeSequenceId(step.token ?? `S${index + 1}`, `S${index + 1}`),
          sourceId,
          sourceLabel: step.sourceLabel,
          targetId,
          targetLabel: step.targetLabel,
          message: step.message,
          fileIds: matchedFile ? [matchedFile.id] : [],
        };
      });
    }

    const prioritizedFiles = [...allFiles]
      .sort((left, right) => {
        const leftChurn = left.additions + left.deletions;
        const rightChurn = right.additions + right.deletions;

        if (leftChurn !== rightChurn) {
          return rightChurn - leftChurn;
        }

        return left.path.localeCompare(right.path);
      })
      .slice(0, 12);

    let previousActor = "Reviewer";

    return prioritizedFiles.map((file, index) => {
      const targetLabel = titleCase(deriveLayer(file.path));
      const token = `F${index + 1}`;
      const message = `${file.status.toUpperCase()} ${fileNameForPath(file.path)} (+${file.additions}/-${file.deletions})`;

      const step: CodeSequenceStep = {
        id: `sequence-step-${file.id}`,
        token,
        sourceId: normalizeSequenceId(previousActor, "reviewer"),
        sourceLabel: previousActor,
        targetId: normalizeSequenceId(targetLabel, `target_${index + 1}`),
        targetLabel,
        message,
        fileIds: [file.id],
      };

      previousActor = targetLabel;
      return step;
    });
  }, [allFiles, hasAiAnalysis, ui.aiAnalysis]);

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

  const fileStandardsInsights = useMemo(() => {
    const byPath = new Map(
      allFiles.map((file) => [
        file.path,
        {
          fileId: file.id,
          path: file.path,
          pass: 0,
          warn: 0,
          fail: 0,
          linkedRuleIds: [] as string[],
        },
      ]),
    );

    standardsChecks.forEach((check) => {
      if (!check.result) {
        return;
      }

      const evidencePaths = [...new Set(
        check.result.evidence
          .map((item) => item.filePath?.trim() ?? "")
          .filter((path) => path.length > 0),
      )];

      evidencePaths.forEach((path) => {
        const current = byPath.get(path);
        if (!current) {
          return;
        }

        if (check.result?.status === "pass") {
          current.pass += 1;
        } else if (check.result?.status === "warn") {
          current.warn += 1;
        } else {
          current.fail += 1;
        }

        if (!current.linkedRuleIds.includes(check.rule.id)) {
          current.linkedRuleIds.push(check.rule.id);
        }
      });
    });

    return allFiles.map((file) => {
      const current = byPath.get(file.path);
      if (!current) {
        return {
          fileId: file.id,
          path: file.path,
          pass: 0,
          warn: 0,
          fail: 0,
          linkedRuleIds: [],
        };
      }

      return {
        ...current,
        linkedRuleIds: [...current.linkedRuleIds],
      };
    });
  }, [allFiles, standardsChecks]);

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

  const threadCounts = useMemo(() => {
    const activeCommitId = ui.activeCommitId;
    if (!activeCommitId) {
      return {
        all: 0,
        open: 0,
        resolved: 0,
      };
    }

    let open = 0;
    let resolved = 0;

    Object.values(entities.threadsById).forEach((thread) => {
      if (!thread || thread.commitId !== activeCommitId) {
        return;
      }

      if (thread.status === "open") {
        open += 1;
        return;
      }

      resolved += 1;
    });

    return {
      all: open + resolved,
      open,
      resolved,
    };
  }, [entities.threadsById, ui.activeCommitId]);

  const fileSummaries = useMemo(() => {
    const aiSummaryByPath = new Map(
      hasAiAnalysis && ui.aiAnalysis !== null
        ? ui.aiAnalysis.fileSummaries.map((s) => [s.filePath, s] as const)
        : [],
    );

    return allFiles.map((file) => {
      const aiSummary = aiSummaryByPath.get(file.path);

      if (aiSummary) {
        return {
          fileId: file.id,
          path: file.path,
          status: file.status,
          summary: aiSummary.summary,
          riskNote: aiSummary.riskNote,
        };
      }

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
  }, [allFiles, entities.hunkIdsByFileId, entities.hunksById, hasAiAnalysis, ui.aiAnalysis]);

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

  const refreshRepositoryCommits = useCallback(
    async (repositoryPath: string, limit = 15) => {
      const normalizedRepositoryPath = repositoryPath.trim();
      if (normalizedRepositoryPath.length === 0) {
        return;
      }

      try {
        const reviewCommitFeed = await readRepositoryReviewCommits(
          normalizedRepositoryPath,
          limit,
          240,
        );
        const commits = mergeRepositoryCommits(
          reviewCommitFeed.recentCommits,
          reviewCommitFeed.branchOnlyCommits,
        );
        dispatch(
          reviewUiActions.setRepositoryCommits({
            commits:
              commits.length > 0
                ? commits
                : await readRepositoryCommits(normalizedRepositoryPath, limit),
          }),
        );
      } catch {
        // Ignore polling errors; the next interval can recover.
      }
    },
    [dispatch],
  );

  const setDiffOrientation = useCallback(
    (orientation: "split" | "unified") => {
      dispatch(reviewUiActions.setDiffOrientation({ orientation }));
    },
    [dispatch],
  );

  const setFileInspectionMode = useCallback(
    (mode: "summary" | "diff") => {
      dispatch(
        reviewUiActions.setFileInspectionMode({
          mode,
        }),
      );
    },
    [dispatch],
  );

  const setDiffViewMode = useCallback(
    (mode: "changes" | "old" | "new") => {
      dispatch(reviewUiActions.setDiffViewMode({ mode }));
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
      const normalizedThreadId = threadId.trim();
      if (normalizedThreadId.length === 0) {
        return;
      }

      const normalizedPrompt = stripCheckmateMentions(prompt.trim());

      if (normalizedPrompt.length === 0) {
        dispatch(
          askAgentDraftRequested({
            threadId: normalizedThreadId,
          }),
        );
        return;
      }

      dispatch(
        askAgentDraftRequested({
          threadId: normalizedThreadId,
          reviewerPrompt: normalizedPrompt,
        }),
      );
    },
    [dispatch],
  );

  const deleteComment = useCallback(
    (commentId: string) => {
      const normalizedCommentId = commentId.trim();
      if (normalizedCommentId.length === 0) {
        return;
      }

      dispatch(
        deleteCommentRequested({
          commentId: normalizedCommentId,
        }),
      );
    },
    [dispatch],
  );

  const setThreadStatus = useCallback(
    (threadId: string, status: ThreadStatus) => {
      const normalizedThreadId = threadId.trim();
      if (normalizedThreadId.length === 0) {
        return;
      }

      dispatch(
        reviewEntitiesActions.threadStatusUpdated({
          threadId: normalizedThreadId,
          status,
          updatedAtIso: new Date().toISOString(),
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

  const refreshAiAnalysis = useCallback(() => {
    if (!ui.activeCommitId) {
      return;
    }

    dispatch(
      analyseCommitRequested({
        commitId: ui.activeCommitId,
      }),
    );
  }, [dispatch, ui.activeCommitId]);

  const retrySequenceGeneration = useCallback(() => {
    if (!ui.activeCommitId) {
      return;
    }

    dispatch(
      regenerateSequenceRequested({
        commitId: ui.activeCommitId,
      }),
    );
  }, [dispatch, ui.activeCommitId]);

  const refreshStandardsAnalysis = useCallback(() => {
    if (!ui.activeCommitId) {
      return;
    }

    dispatch(
      analyseStandardsRequested({
        commitId: ui.activeCommitId,
      }),
    );
  }, [dispatch, ui.activeCommitId]);

  return {
    state: {
      loadStatus: ui.loadStatus,
      errorMessage: ui.lastError,
      commit,
      activeFile,
      activeFileId,
      fileInspectionMode: ui.fileInspectionMode,
      allFiles,
      filteredFiles,
      activeFileHunks,
      diffOrientation: ui.diffOrientation,
      diffViewMode: ui.diffViewMode,
      activeFileVersions,
      activeFileVersionsStatus,
      activeFileVersionsError,
      fileFilter: ui.fileFilter,
      overviewCards,
      architectureClusters,
      sequencePairs,
      codeSequenceSteps,
      standardsChecks,
      fileStandardsInsights,
      threadModels,
      threadCounts,
      fileSummaries,
      publishPackage: ui.lastPublishPackage,
      repositoryCommits: ui.repositoryCommits,
      publishStatus: ui.publishStatus,
      publishResult: ui.publishResult,
      publishError: ui.publishError,
      standardsCounts,
      isPublishingReady: ui.activeCommitId !== null,
      aiAnalysisStatus: ui.aiAnalysisStatus,
      aiSequenceStatus: ui.aiSequenceStatus,
      aiSequenceError: ui.aiSequenceError,
      standardsAnalysisStatus: ui.standardsAnalysisStatus,
      standardsAnalysisError: ui.standardsAnalysisError,
    },
    actions: {
      reloadReviewWorkspace,
      refreshRepositoryCommits,
      selectFile,
      setFileInspectionMode,
      setDiffOrientation,
      setDiffViewMode,
      setFilterQuery,
      toggleFilterStatus,
      setOnlyCommented,
      setOnlyFailingStandards,
      setThreadStatusFilter,
      createThread,
      setThreadStatus,
      askAgent,
      deleteComment,
      publishReview,
      refreshAiAnalysis,
      refreshStandardsAnalysis,
      retrySequenceGeneration,
    },
  };
}
