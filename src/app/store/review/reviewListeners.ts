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
  StandardsAnalyser,
  StandardsEvaluator,
} from "../../../domain/review/index.ts";
import {
  analyseCommitRequested,
  analyseStandardsRequested,
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
  hasCheckmateMention,
  readAiAnalysisFromStorage,
  readProjectStandardsPathFromStorage,
  readTextFile,
  stripCheckmateMentions,
  writeAiAnalysisToStorage,
  type CachedAiAnalysisData,
} from "../../../shared/index.ts";

const DEFAULT_PROJECT_CODING_STANDARDS_RULE_TEXT = `# Project Coding Standards

Use these standards as the default quality baseline for commit reviews when a project-specific standards file is not configured.

1. Follow SOLID principles and keep responsibilities focused per module.
2. Keep domain and application layers free of infrastructure dependencies (dependency direction inward only).
3. Prefer composition over inheritance unless inheritance is clearly justified.
4. Avoid duplicated logic; extract reusable units when behavior repeats.
5. Keep functions small, deterministic, and easy to test.
6. Validate all external input at boundaries and fail with explicit errors.
7. Never log secrets, tokens, or PII; redact sensitive values in logs and errors.
8. Handle errors with actionable messages and avoid swallowing exceptions.
9. Add or update tests for behavior changes, especially critical workflows and regressions.
10. Keep naming explicit and intention-revealing; avoid ambiguous abbreviations.
11. Keep changes cohesive: each commit should have a clear, single reviewable intent.
12. Limit public API surface; keep internals private unless external access is required.
13. Use type-safe contracts and avoid \`any\` or unsafe casts unless strictly necessary.
14. Prefer immutable data flow and explicit state transitions over hidden mutation.
15. Document non-obvious tradeoffs, constraints, and security considerations in code or docs.
`;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return new Promise<T>((resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        resolve(value);
      },
      (error) => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        reject(error);
      },
    );
  });
}

export interface ReviewListenerDependencies {
  readonly reviewDataSource: CommitReviewDataSource;
  readonly standardsEvaluator: StandardsEvaluator;
  readonly standardsAnalyser: StandardsAnalyser;
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
    standardsRules: CachedAiAnalysisData["standardsRules"];
    standardsResults: CachedAiAnalysisData["standardsResults"];
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
        ...(pair.technicalDetails
          ? {
              technicalDetails: pair.technicalDetails,
            }
          : {}),
        filePaths: [...pair.filePaths],
      })),
      sequenceSteps: input.sequenceSteps.map((step) => ({
        ...(step.token ? { token: step.token } : {}),
        ...(step.sourceId ? { sourceId: step.sourceId } : {}),
        sourceLabel: step.sourceLabel,
        ...(step.targetId ? { targetId: step.targetId } : {}),
        targetLabel: step.targetLabel,
        message: step.message,
        filePath: step.filePath,
      })),
      fileSummaries: input.fileSummaries.map((summary) => ({
        filePath: summary.filePath,
        summary: summary.summary,
        riskNote: summary.riskNote,
        ...(summary.technicalDetails
          ? {
              technicalDetails: summary.technicalDetails,
            }
          : {}),
      })),
      standardsRules: input.standardsRules.map((rule) => ({
        id: rule.id,
        title: rule.title,
        description: rule.description,
        severity: rule.severity,
      })),
      standardsResults: input.standardsResults.map((result) => ({
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
      })),
    };
  };

  const hunkPreview = (
    hunk: NonNullable<ReviewRootState["reviewEntities"]["hunksById"][string]>,
    maxLines = 40,
  ): string => {
    const previewLines = hunk.lines.slice(0, maxLines).map((line) => {
      const prefix = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
      return `${prefix}${line.text}`;
    });

    if (hunk.lines.length > maxLines) {
      previewLines.push(`... (${hunk.lines.length - maxLines} more lines omitted)`);
    }

    return previewLines.join("\n");
  };

  const resolveRelatedHunkHeaders = (
    state: ReviewRootState,
    fileId: string,
    currentHunkId: string,
    maxCount = 4,
  ): readonly string[] => {
    const hunkIds = state.reviewEntities.hunkIdsByFileId[fileId] ?? [];
    const headers = hunkIds
      .filter((hunkId) => hunkId !== currentHunkId)
      .map((hunkId) => state.reviewEntities.hunksById[hunkId]?.header ?? "")
      .filter((header) => header.trim().length > 0)
      .slice(0, maxCount);
    return headers;
  };

  const isAbsolutePath = (path: string): boolean => {
    if (path.startsWith("/") || path.startsWith("\\")) {
      return true;
    }

    return /^[a-zA-Z]:[\\/]/.test(path);
  };

  const joinRepositoryPath = (repositoryPath: string, relativePath: string): string => {
    const sanitizedRepositoryPath = repositoryPath.replace(/[\\/]+$/, "");
    const sanitizedRelativePath = relativePath.replace(/^[\\/]+/, "");
    return `${sanitizedRepositoryPath}/${sanitizedRelativePath}`;
  };

  const resolveStandardsSource = async (
    repositoryPath: string,
  ): Promise<{
    readonly sourcePath: string;
    readonly ruleText: string;
  }> => {
    const configuredPath = readProjectStandardsPathFromStorage(repositoryPath);
    const configuredPathResolved =
      configuredPath && configuredPath.length > 0
        ? isAbsolutePath(configuredPath)
          ? configuredPath
          : joinRepositoryPath(repositoryPath, configuredPath)
        : null;

    const defaultRepositoryStandardsPath = joinRepositoryPath(repositoryPath, "coding_standards.md");

    const candidatePaths = [
      configuredPathResolved,
      configuredPathResolved ? null : defaultRepositoryStandardsPath,
    ].filter((value): value is string => value !== null);

    for (const candidatePath of candidatePaths) {
      const content = await readTextFile(candidatePath);
      if (content && content.trim().length > 0) {
        return {
          sourcePath: candidatePath,
          ruleText: content,
        };
      }
    }

    return {
      sourcePath: "src/project_coding_standards.md",
      ruleText: DEFAULT_PROJECT_CODING_STANDARDS_RULE_TEXT,
    };
  };

  startListening({
    actionCreator: loadCommitReviewRequested,
    effect: async (action, listenerApi) => {
      listenerApi.dispatch(reviewUiActions.markLoadStarted());

      try {
        const repositoryCommitsPromise = withTimeout(
          deps.reviewDataSource
            .listRepositoryCommits({
              repositoryPath: action.payload.repositoryPath,
              limit: 15,
            })
            .catch(() => []),
          15_000,
          "Timed out while listing repository commits.",
        ).catch(() => []);

        const aggregate = await withTimeout(
          deps.reviewDataSource.loadCommitReview({
            repositoryPath: action.payload.repositoryPath,
            commitSha: action.payload.commitSha,
          }),
          45_000,
          "Timed out while loading commit review data. Verify the desktop backend is running.",
        );

        listenerApi.dispatch(reviewEntitiesActions.hydrateFromAggregate(aggregate));

        listenerApi.dispatch(
          reviewUiActions.hydrateForCommit({
              commitId: aggregate.commit.id,
              firstFileId: aggregate.files[0]?.id ?? null,
            }),
        );

        void repositoryCommitsPromise.then((repositoryCommits) => {
          listenerApi.dispatch(
            reviewUiActions.setRepositoryCommits({
              commits: repositoryCommits,
            }),
          );
        });

        const cachedAiAnalysis = readAiAnalysisFromStorage({
          repositoryPath: aggregate.commit.repositoryPath,
          commitSha: aggregate.commit.commitSha,
        });

        if (cachedAiAnalysis) {
          const output = {
            commitId: aggregate.commit.id,
            ...toCachedAnalysisData(cachedAiAnalysis),
          };

          listenerApi.dispatch(
            reviewUiActions.aiAnalysisSucceeded({
              output,
            }),
          );

          if (
            cachedAiAnalysis.standardsRules.length > 0 ||
            cachedAiAnalysis.standardsResults.length > 0
          ) {
            listenerApi.dispatch(
              reviewEntitiesActions.standardsEvaluated({
                commitId: aggregate.commit.id,
                rules: cachedAiAnalysis.standardsRules,
                results: cachedAiAnalysis.standardsResults,
              }),
            );
            listenerApi.dispatch(reviewUiActions.standardsAnalysisSucceeded());
          } else {
            listenerApi.dispatch(reviewUiActions.standardsAnalysisStarted());
            globalThis.setTimeout(() => {
              listenerApi.dispatch(
                analyseCommitRequested({
                  commitId: aggregate.commit.id,
                }),
              );
            }, 0);
          }

          return;
        }

        // Run AI analysis once per loaded commit in the background when cache is absent.
        globalThis.setTimeout(() => {
          listenerApi.dispatch(
            analyseCommitRequested({
              commitId: aggregate.commit.id,
            }),
          );
        }, 0);
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

      if (hasCheckmateMention(action.payload.body)) {
        const reviewerPrompt = stripCheckmateMentions(action.payload.body);
        const payload = {
          threadId: created.thread.id,
          ...(reviewerPrompt.length > 0 ? { reviewerPrompt } : {}),
        };

        // Defer agent follow-up to keep comment creation/navigation immediate.
        globalThis.setTimeout(() => {
          listenerApi.dispatch(askAgentDraftRequested(payload));
        }, 0);
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
    actionCreator: reviewUiActions.setFileInspectionMode,
    effect: async (action, listenerApi) => {
      if (action.payload.mode !== "diff") {
        return;
      }

      const state = listenerApi.getState();
      const activeCommitId = state.reviewUi.activeCommitId;
      if (!activeCommitId) {
        return;
      }

      const resolvedFileId = state.reviewUi.activeFileId;
      if (!resolvedFileId) {
        return;
      }

      const commit = state.reviewEntities.commitsById[activeCommitId];
      const file = state.reviewEntities.filesById[resolvedFileId];
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
    actionCreator: reviewUiActions.setDiffViewMode,
    effect: async (action, listenerApi) => {
      if (action.payload.mode === "changes") {
        return;
      }

      const state = listenerApi.getState();
      const activeCommitId = state.reviewUi.activeCommitId;
      const activeFileId = state.reviewUi.activeFileId;
      if (!activeCommitId || !activeFileId) {
        return;
      }

      const commit = state.reviewEntities.commitsById[activeCommitId];
      const file = state.reviewEntities.filesById[activeFileId];
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
    effect: async (action, listenerApi) => {
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

      const commit = state.reviewEntities.commitsById[thread.commitId];
      const comments = selectThreadComments(state, thread.id);
      const prompt = action.payload.reviewerPrompt?.trim();

      listenerApi.dispatch(
        reviewUiActions.setAskAgentDraft({
          threadId: thread.id,
          draft: "Checkmate is reviewing this thread...",
        }),
      );

      // Yield once so the optimistic thread/comment paint is not blocked by prompt assembly.
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, 0);
      });

      if (listenerApi.signal.aborted) {
        return;
      }

      const relatedHunkHeaders = resolveRelatedHunkHeaders(state, file.id, hunk.id);
      const matchingFileSummary =
        state.reviewUi.aiAnalysis?.commitId === thread.commitId
          ? state.reviewUi.aiAnalysis.fileSummaries.find((summary) => summary.filePath === file.path) ?? null
          : null;

      const standardsResultIds =
        state.reviewEntities.standardsResultIdsByCommitId[thread.commitId] ?? [];
      const failingOrWarnStandards = standardsResultIds
        .map((resultId) => state.reviewEntities.standardsResultsById[resultId])
        .filter((result): result is NonNullable<typeof result> => result !== undefined)
        .filter((result) => result.status !== "pass")
        .slice(0, 4);

      const additionalContext = [
        commit ? `Commit title: ${commit.title}` : null,
        commit && commit.description.trim().length > 0
          ? `Commit description: ${commit.description.trim()}`
          : null,
        `File status: ${file.status}, additions: ${file.additions}, deletions: ${file.deletions}.`,
        matchingFileSummary
          ? `AI file summary: ${matchingFileSummary.summary} Risk note: ${matchingFileSummary.riskNote}`
          : null,
        relatedHunkHeaders.length > 0
          ? `Other hunks in this file:\n${relatedHunkHeaders.map((header) => `- ${header}`).join("\n")}`
          : null,
        failingOrWarnStandards.length > 0
          ? `Non-pass standards findings:\n${failingOrWarnStandards
              .map((result) => `- ${result.status.toUpperCase()} ${result.summary}`)
              .join("\n")}`
          : null,
        "Focused hunk preview:",
        hunkPreview(hunk),
      ].filter((line): line is string => line !== null && line.trim().length > 0);

      const askPrompt =
        prompt && prompt.length > 0
          ? createAskAgentDraft({
              file,
              hunk,
              thread,
              comments,
              reviewerPrompt: prompt,
              additionalContext,
            })
          : createAskAgentDraft({
              file,
              hunk,
              thread,
              comments,
              additionalContext,
            });

      try {
        const requestId = deps.createId();
        const requestedAtIso = deps.nowIso();
        const response = await deps.reviewPublisher.publishReview({
          requestId,
          requestedBy: "checkmate-agent",
          requestedAtIso,
          commitId: thread.commitId,
          commitSha: commit?.commitSha ?? thread.commitId,
          payloadJson: JSON.stringify(
            {
              type: "thread-review",
              prompt: askPrompt,
              thread: {
                id: thread.id,
                side: thread.anchor.side,
                lineNumber: thread.anchor.lineNumber,
              },
              file: {
                path: file.path,
                status: file.status,
                additions: file.additions,
                deletions: file.deletions,
              },
              hunk: {
                id: hunk.id,
                header: hunk.header,
              },
              additionalContext,
              comments: comments.map((comment) => ({
                authorType: comment.authorType,
                authorId: comment.authorId,
                body: comment.body,
                createdAtIso: comment.createdAtIso,
              })),
            },
            null,
            2,
          ),
        });

        const body = response.summary.trim();
        listenerApi.dispatch(
          reviewEntitiesActions.commentAdded({
            comment: {
              id: deps.createId(),
              threadId: thread.id,
              authorType: "agent",
              authorId: "checkmate",
              body: body.length > 0 ? body : "No response returned by Checkmate.",
              createdAtIso: deps.nowIso(),
              isDraft: false,
            },
          }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Checkmate could not generate a response.";
        listenerApi.dispatch(
          reviewEntitiesActions.commentAdded({
            comment: {
              id: deps.createId(),
              threadId: thread.id,
              authorType: "agent",
              authorId: "checkmate",
              body: `Unable to generate response: ${message}`,
              createdAtIso: deps.nowIso(),
              isDraft: false,
            },
          }),
        );
      } finally {
        listenerApi.dispatch(
          reviewUiActions.clearAskAgentDraft({
            threadId: thread.id,
          }),
        );
      }
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
      listenerApi.cancelActiveListeners();
      const context = resolveCommitContext(listenerApi.getState(), action.payload.commitId);
      if (!context) {
        return;
      }

      listenerApi.dispatch(reviewUiActions.aiAnalysisStarted());
      listenerApi.dispatch(reviewUiActions.standardsAnalysisStarted());

      try {
        const standardsSource = await resolveStandardsSource(context.commit.repositoryPath);
        const output = await deps.commitAnalyser.analyseCommit({
          commitId: action.payload.commitId,
          commit: context.commit,
          files: context.files,
          hunks: context.hunks,
          standardsRuleText: standardsSource.ruleText,
          standardsSourcePath: standardsSource.sourcePath,
          abortSignal: listenerApi.signal,
        });

        if (listenerApi.signal.aborted) {
          return;
        }

        let standardsRules = output.standardsRules;
        let standardsResults = output.standardsResults;

        if (standardsRules.length === 0 || standardsResults.length === 0) {
          try {
            const standardsEvaluation = await deps.standardsAnalyser.analyseStandards({
              commitId: action.payload.commitId,
              commit: context.commit,
              files: context.files,
              hunks: context.hunks,
              ruleText: standardsSource.ruleText,
              standardsSourcePath: standardsSource.sourcePath,
            });
            standardsRules = standardsEvaluation.rules;
            standardsResults = standardsEvaluation.results;
          } catch {
            const standardsEvaluation = deps.standardsEvaluator.evaluate({
              commitId: action.payload.commitId,
              ruleText: standardsSource.ruleText,
              files: context.files,
              hunks: context.hunks,
            });
            standardsRules = standardsEvaluation.rules;
            standardsResults = standardsEvaluation.results;
          }
        }

        const enrichedOutput = {
          ...output,
          standardsRules,
          standardsResults,
        };

        writeAiAnalysisToStorage({
          repositoryPath: context.commit.repositoryPath,
          commitSha: context.commit.commitSha,
          analysis: toCachedAnalysisData(enrichedOutput),
        });

        listenerApi.dispatch(reviewUiActions.aiAnalysisSucceeded({ output: enrichedOutput }));
        listenerApi.dispatch(
          reviewEntitiesActions.standardsEvaluated({
            commitId: action.payload.commitId,
            rules: standardsRules,
            results: standardsResults,
          }),
        );
        listenerApi.dispatch(reviewUiActions.standardsAnalysisSucceeded());

        if (enrichedOutput.sequenceSteps.length === 0) {
          listenerApi.dispatch(regenerateSequenceRequested({ commitId: action.payload.commitId }));
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Failed to analyse commit with AI.";
        listenerApi.dispatch(reviewUiActions.aiAnalysisFailed({ errorMessage: message }));
        listenerApi.dispatch(
          reviewUiActions.standardsAnalysisFailed({
            errorMessage: message,
          }),
        );
      }
    },
  });

  startListening({
    actionCreator: analyseStandardsRequested,
    effect: (action, listenerApi) => {
      listenerApi.dispatch(
        analyseCommitRequested({
          commitId: action.payload.commitId,
        }),
      );
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
