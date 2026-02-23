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

function installMockLocalStorage(): void {
  const storage = new Map<string, string>();
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

  const store = createReviewStore({
    dependencies: {
      commitAnalyser: {
        analyseCommit: async () => ({
          commitId: "commit-1",
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
          standardsRules: [],
          standardsResults: [],
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

  const store = createReviewStore({
    dependencies: {
      commitAnalyser: {
        analyseCommit: async () => ({
          commitId: "commit-1",
          overviewCards: [],
          flowComparisons: [],
          sequenceSteps: [],
          fileSummaries: [],
          standardsRules: [],
          standardsResults: [],
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

test("load listener analyses once per commit and reuses cached analysis on reload", async () => {
  installMockLocalStorage();

  let analysisCalls = 0;
  const aggregate = createCommitAggregateFixture();

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
            sequenceSteps: [],
            fileSummaries: [
              {
                filePath: aggregate.files[0]?.path ?? "",
                summary: "Cached file summary",
                riskNote: "Low risk.",
              },
            ],
            standardsRules: [
              {
                id: "rule-1",
                title: "Add tests",
                description: "Add tests for behavior changes.",
                severity: "medium",
              },
            ],
            standardsResults: [
              {
                id: `result-${aggregate.commit.id}-rule-1`,
                commitId: aggregate.commit.id,
                ruleId: "rule-1",
                status: "pass",
                summary: "Tests were updated in this commit.",
                evidence: [
                  {
                    filePath: aggregate.files[0]?.path ?? "src/app/store/review/reviewListeners.ts",
                    note: "Test file was changed.",
                  },
                ],
              },
            ],
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
