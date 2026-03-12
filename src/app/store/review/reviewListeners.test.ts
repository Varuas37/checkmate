import assert from "node:assert/strict";
import test from "node:test";

import type { CommitReviewAggregate, PublishReviewRequest } from "../../../domain/review/index.ts";
import { createReviewStore } from "./reviewStore.ts";
import {
  analyseCommitRequested,
  loadCommitReviewRequested,
  publishReviewRequested,
} from "./reviewActions.ts";
import { reviewEntitiesActions } from "./reviewEntitiesSlice.ts";
import { reviewUiActions } from "./reviewUiSlice.ts";

const AI_ANALYSIS_CONFIG_STORAGE_KEY = "codelens-ai-analysis-config";

function createCommitAggregateFixture(): CommitReviewAggregate {
  return {
    commit: {
      id: "commit-1",
      repositoryPath: "/repo",
      commitSha: "abc123def456",
      shortSha: "abc123de",
      title: "Publish flow fixture",
      description: "Verifies listener publish integration.",
      authorName: "Reviewer",
      authorEmail: "reviewer@example.com",
      authoredAtIso: "2026-02-22T19:00:00.000Z",
      parentCommitShas: ["parent-1"],
    },
    files: [
      {
        id: "file-1",
        commitId: "commit-1",
        path: "src/app/store/review/reviewListeners.ts",
        status: "modified",
        additions: 8,
        deletions: 2,
      },
    ],
    hunks: [
      {
        id: "hunk-1",
        fileId: "file-1",
        header: "@@ -1,3 +1,8 @@",
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 8,
        lines: [],
      },
    ],
    threads: [],
    comments: [],
    overviewCards: [],
    standardsRules: [],
    standardsResults: [],
  };
}

function createStandardsFixture(commitId: string, filePath: string) {
  return {
    standardsRules: [
      {
        id: "rule-1",
        title: "Add tests",
        description: "Add tests for behavior changes.",
        severity: "medium" as const,
      },
    ],
    standardsResults: [
      {
        id: `result-${commitId}-rule-1`,
        commitId,
        ruleId: "rule-1",
        status: "pass" as const,
        summary: "Tests were updated in this commit.",
        evidence: [
          {
            filePath,
            note: "Test file was changed.",
          },
        ],
      },
    ],
  };
}

function waitForListener(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function hydrateStoreForPublish(store: ReturnType<typeof createReviewStore>): void {
  const aggregate = createCommitAggregateFixture();

  store.dispatch(reviewEntitiesActions.hydrateFromAggregate(aggregate));
  store.dispatch(
    reviewUiActions.hydrateForCommit({
      commitId: aggregate.commit.id,
      firstFileId: aggregate.files[0]?.id ?? null,
    }),
  );
}

function createDeferred<T>() {
  let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
  let rejectPromise: ((reason?: unknown) => void) | undefined;

  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve(value: T) {
      resolvePromise?.(value);
    },
    reject(reason?: unknown) {
      rejectPromise?.(reason);
    },
  };
}

function installMockLocalStorage(options?: {
  readonly autoRunOnCommitChange?: boolean;
}): void {
  const storage = new Map<string, string>();
  if (options?.autoRunOnCommitChange !== undefined) {
    storage.set(
      AI_ANALYSIS_CONFIG_STORAGE_KEY,
      JSON.stringify({
        maxChurnThreshold: 500,
        autoRunOnCommitChange: options.autoRunOnCommitChange,
      }),
    );
  }

  const localStorageMock: Storage = {
    get length() {
      return storage.size;
    },
    clear() {
      storage.clear();
    },
    getItem(key: string) {
      return storage.has(key) ? storage.get(key) ?? null : null;
    },
    key(index: number) {
      return [...storage.keys()][index] ?? null;
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    setItem(key: string, value: string) {
      storage.set(key, String(value));
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: localStorageMock,
  });
}

test("publish listener transitions through publishing then stores adapter result", async () => {
  const deferred = createDeferred<{
    readonly provider: "ai-sdk";
    readonly requestId: string;
    readonly publicationId: string;
    readonly publishedAtIso: string;
    readonly summary: string;
  }>();
  const requests: PublishReviewRequest[] = [];

  const store = createReviewStore({
    dependencies: {
      reviewPublisher: {
        publishReview: async (input) => {
          requests.push(input);
          return deferred.promise;
        },
      },
      nowIso: () => "2026-02-22T20:00:00.000Z",
      createId: () => "publish-request-1",
    },
  });

  hydrateStoreForPublish(store);

  store.dispatch(
    publishReviewRequested({
      requestedBy: "ui-reviewer",
    }),
  );

  await waitForListener();

  const publishingState = store.getState().reviewUi;
  assert.equal(publishingState.publishStatus, "publishing");
  assert.equal(publishingState.publishError, null);
  assert.equal(publishingState.lastPublishPackage?.commitId, "commit-1");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.requestId, "publish-request-1");
  assert.equal(requests[0]?.requestedBy, "ui-reviewer");
  assert.equal(requests[0]?.commitSha, "abc123def456");

  deferred.resolve({
    provider: "ai-sdk",
    requestId: "publish-request-1",
    publicationId: "claude-msg-1",
    publishedAtIso: "2026-02-22T20:01:00.000Z",
    summary: "Acknowledged and queued for patch generation.",
  });

  await waitForListener();

  const publishedState = store.getState().reviewUi;
  assert.equal(publishedState.publishStatus, "published");
  assert.equal(publishedState.publishError, null);
  assert.equal(publishedState.publishResult?.publicationId, "claude-msg-1");
  assert.equal(
    publishedState.publishResult?.summary,
    "Acknowledged and queued for patch generation.",
  );
});

test("publish listener captures adapter failures in UI state", async () => {
  const store = createReviewStore({
    dependencies: {
      reviewPublisher: {
        publishReview: async () => {
          throw new Error("AI adapter unavailable");
        },
      },
      nowIso: () => "2026-02-22T20:00:00.000Z",
      createId: () => "publish-request-2",
    },
  });

  hydrateStoreForPublish(store);

  store.dispatch(
    publishReviewRequested({
      requestedBy: "ui-reviewer",
    }),
  );

  await waitForListener();

  const uiState = store.getState().reviewUi;
  assert.equal(uiState.publishStatus, "error");
  assert.equal(uiState.publishError, "AI adapter unavailable");
  assert.equal(uiState.publishResult, null);
  assert.equal(uiState.lastPublishPackage?.commitId, "commit-1");
});

test("analyse listener skips sequence regeneration when analysis already has sequence steps", async () => {
  let sequenceGenerationCalls = 0;
  const aggregate = createCommitAggregateFixture();
  const standards = createStandardsFixture(aggregate.commit.id, aggregate.files[0]?.path ?? "");

  const store = createReviewStore({
    dependencies: {
      commitAnalyser: {
        analyseCommit: async () => ({
          commitId: aggregate.commit.id,
          overviewCards: [],
          flowComparisons: [],
          sequenceSteps: [
            {
              token: "S1",
              sourceLabel: "UI",
              targetLabel: "ReviewStore",
              message: "DISPATCH analyseCommitRequested",
              filePath: "src/app/store/review/reviewListeners.ts",
            },
          ],
          fileSummaries: [],
          standardsRules: standards.standardsRules,
          standardsResults: standards.standardsResults,
        }),
      },
      sequenceDiagramGenerator: {
        generateSequenceSteps: async () => {
          sequenceGenerationCalls += 1;
          return [];
        },
      },
    },
  });

  hydrateStoreForPublish(store);

  store.dispatch(
    analyseCommitRequested({
      commitId: "commit-1",
    }),
  );

  await waitForListener();
  await waitForListener();

  assert.equal(sequenceGenerationCalls, 0);
  assert.equal(store.getState().reviewUi.aiSequenceStatus, "ready");
});

test("analyse listener regenerates sequence when analysis response has no sequence steps", async () => {
  let sequenceGenerationCalls = 0;
  const aggregate = createCommitAggregateFixture();
  const standards = createStandardsFixture(aggregate.commit.id, aggregate.files[0]?.path ?? "");

  const store = createReviewStore({
    dependencies: {
      commitAnalyser: {
        analyseCommit: async () => ({
          commitId: aggregate.commit.id,
          overviewCards: [],
          flowComparisons: [],
          sequenceSteps: [],
          fileSummaries: [],
          standardsRules: standards.standardsRules,
          standardsResults: standards.standardsResults,
        }),
      },
      sequenceDiagramGenerator: {
        generateSequenceSteps: async () => {
          sequenceGenerationCalls += 1;
          return [
            {
              token: "S1",
              sourceLabel: "UI",
              targetLabel: "ReviewStore",
              message: "DISPATCH analyseCommitRequested",
              filePath: "src/app/store/review/reviewListeners.ts",
            },
          ];
        },
      },
    },
  });

  hydrateStoreForPublish(store);

  store.dispatch(
    analyseCommitRequested({
      commitId: "commit-1",
    }),
  );

  await waitForListener();
  await waitForListener();

  assert.equal(sequenceGenerationCalls, 1);
  assert.equal(store.getState().reviewUi.aiSequenceStatus, "ready");
});

test("analyse listener streams file summaries before overview completes and defers standards", async () => {
  const aggregate = createCommitAggregateFixture();
  const standards = createStandardsFixture(aggregate.commit.id, aggregate.files[0]?.path ?? "");
  const summary = {
    filePath: aggregate.files[0]?.path ?? "",
    summary: "Streams the generated file summary immediately.",
    riskNote: "Low risk.",
    technicalDetails: "Updates the review listener pipeline in stages.",
  };
  const commitOutputDeferred = createDeferred<{
    readonly commitId: string;
    readonly overviewCards: readonly [];
    readonly flowComparisons: readonly [];
    readonly sequenceSteps: readonly [];
    readonly fileSummaries: readonly [typeof summary];
    readonly standardsRules: readonly [];
    readonly standardsResults: readonly [];
  }>();
  const sequenceDeferred = createDeferred<
    readonly [
      {
        readonly token: "S1";
        readonly sourceLabel: "UI";
        readonly targetLabel: "ReviewStore";
        readonly message: "DISPATCH regenerateSequenceRequested";
        readonly filePath: string;
      },
    ]
  >();
  const standardsDeferred = createDeferred<{
    readonly rules: typeof standards.standardsRules;
    readonly results: typeof standards.standardsResults;
  }>();

  const store = createReviewStore({
    dependencies: {
      commitAnalyser: {
        analyseCommit: async (input) => {
          await input.onFileSummary?.(summary, 0, 1);
          await input.onFileSummariesReady?.([summary]);
          return commitOutputDeferred.promise;
        },
      },
      sequenceDiagramGenerator: {
        generateSequenceSteps: async () => sequenceDeferred.promise,
      },
      standardsAnalyser: {
        analyseStandards: async () => standardsDeferred.promise,
      },
    },
  });

  hydrateStoreForPublish(store);

  store.dispatch(
    analyseCommitRequested({
      commitId: "commit-1",
    }),
  );

  await waitForListener();
  await waitForListener();

  const streamedState = store.getState().reviewUi;
  assert.equal(streamedState.aiAnalysisStatus, "analysing");
  assert.equal(streamedState.aiAnalysis?.fileSummaries[0]?.summary, summary.summary);
  assert.equal(streamedState.aiSequenceStatus, "generating");
  assert.equal(streamedState.standardsAnalysisStatus, "idle");

  commitOutputDeferred.resolve({
    commitId: aggregate.commit.id,
    overviewCards: [],
    flowComparisons: [],
    sequenceSteps: [],
    fileSummaries: [summary],
    standardsRules: [],
    standardsResults: [],
  });

  await waitForListener();
  await waitForListener();

  const postSummaryState = store.getState().reviewUi;
  assert.equal(postSummaryState.aiAnalysisStatus, "analysed");
  assert.equal(postSummaryState.aiAnalysis?.fileSummaries[0]?.summary, summary.summary);
  assert.equal(postSummaryState.aiSequenceStatus, "generating");
  assert.equal(postSummaryState.standardsAnalysisStatus, "analysing");

  sequenceDeferred.resolve([
    {
      token: "S1",
      sourceLabel: "UI",
      targetLabel: "ReviewStore",
      message: "DISPATCH regenerateSequenceRequested",
      filePath: aggregate.files[0]?.path ?? "",
    },
  ]);
  standardsDeferred.resolve({
    rules: standards.standardsRules,
    results: standards.standardsResults,
  });

  await waitForListener();
  await waitForListener();
  await waitForListener();

  const finalState = store.getState().reviewUi;
  assert.equal(finalState.aiSequenceStatus, "ready");
  assert.equal(finalState.standardsAnalysisStatus, "ready");
  assert.equal(store.getState().reviewEntities.standardsResultIdsByCommitId["commit-1"]?.length, 1);
});

test("load listener analyses once per commit and reuses cached analysis on reload", async () => {
  installMockLocalStorage();

  let analysisCalls = 0;
  const aggregate = createCommitAggregateFixture();
  const standards = createStandardsFixture(aggregate.commit.id, aggregate.files[0]?.path ?? "");

  const store = createReviewStore({
    dependencies: {
      reviewDataSource: {
        loadCommitReview: async () => aggregate,
        listRepositoryCommits: async () => [],
        readCommitFileVersions: async () => ({
          oldContent: null,
          newContent: null,
        }),
      },
      commitAnalyser: {
        analyseCommit: async () => {
          analysisCalls += 1;
          return {
            commitId: aggregate.commit.id,
            overviewCards: [],
            flowComparisons: [],
            sequenceSteps: [
              {
                token: "S1",
                sourceLabel: "UI",
                targetLabel: "ReviewStore",
                message: "DISPATCH analyseCommitRequested",
                filePath: aggregate.files[0]?.path ?? "",
              },
            ],
            fileSummaries: [
              {
                filePath: aggregate.files[0]?.path ?? "",
                summary: "Cached file summary",
                riskNote: "Low risk.",
              },
            ],
            standardsRules: standards.standardsRules,
            standardsResults: standards.standardsResults,
          };
        },
      },
    },
  });

  store.dispatch(
    loadCommitReviewRequested({
      repositoryPath: aggregate.commit.repositoryPath,
      commitSha: aggregate.commit.commitSha,
      standardsRuleText: "1. Add tests for behavior changes.",
    }),
  );

  await waitForListener();
  await waitForListener();
  await waitForListener();

  assert.equal(analysisCalls, 1);
  assert.equal(store.getState().reviewUi.aiAnalysisStatus, "analysed");
  assert.equal(store.getState().reviewUi.standardsAnalysisStatus, "ready");

  store.dispatch(
    loadCommitReviewRequested({
      repositoryPath: aggregate.commit.repositoryPath,
      commitSha: aggregate.commit.commitSha,
      standardsRuleText: "1. Add tests for behavior changes.",
    }),
  );

  await waitForListener();
  await waitForListener();

  assert.equal(analysisCalls, 1);
  assert.equal(store.getState().reviewUi.aiAnalysisStatus, "analysed");
  assert.equal(store.getState().reviewUi.standardsAnalysisStatus, "ready");
});

test("load listener reruns analysis for cached commits when auto-run-on-change is enabled", async () => {
  installMockLocalStorage({
    autoRunOnCommitChange: true,
  });

  let analysisCalls = 0;
  const aggregate = createCommitAggregateFixture();
  const standards = createStandardsFixture(aggregate.commit.id, aggregate.files[0]?.path ?? "");

  const store = createReviewStore({
    dependencies: {
      reviewDataSource: {
        loadCommitReview: async () => aggregate,
        listRepositoryCommits: async () => [],
        readCommitFileVersions: async () => ({
          oldContent: null,
          newContent: null,
        }),
      },
      commitAnalyser: {
        analyseCommit: async () => {
          analysisCalls += 1;
          return {
            commitId: aggregate.commit.id,
            overviewCards: [],
            flowComparisons: [],
            sequenceSteps: [
              {
                token: "S1",
                sourceLabel: "UI",
                targetLabel: "ReviewStore",
                message: "DISPATCH analyseCommitRequested",
                filePath: aggregate.files[0]?.path ?? "",
              },
            ],
            fileSummaries: [],
            standardsRules: standards.standardsRules,
            standardsResults: standards.standardsResults,
          };
        },
      },
    },
  });

  store.dispatch(
    loadCommitReviewRequested({
      repositoryPath: aggregate.commit.repositoryPath,
      commitSha: aggregate.commit.commitSha,
      standardsRuleText: "1. Add tests for behavior changes.",
    }),
  );

  await waitForListener();
  await waitForListener();
  await waitForListener();

  assert.equal(analysisCalls, 1);

  store.dispatch(
    loadCommitReviewRequested({
      repositoryPath: aggregate.commit.repositoryPath,
      commitSha: aggregate.commit.commitSha,
      standardsRuleText: "1. Add tests for behavior changes.",
    }),
  );

  await waitForListener();
  await waitForListener();
  await waitForListener();

  assert.equal(analysisCalls, 2);
  assert.equal(store.getState().reviewUi.aiAnalysisStatus, "analysed");
});
