import type {
  ChangedFile,
  CommentThread,
  CommitReviewAggregate,
  CommitReviewDataSource,
  DiffHunk,
  LoadCommitReviewInput,
  OverviewCard,
  ReviewComment,
} from "../../domain/review/index.ts";

type MockCommitPreset = "head" | "a11ce5e7" | "b7c4d9a2" | "c0ffee42";

interface MockCommitMetadata {
  readonly title: string;
  readonly description: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authoredAtIso: string;
  readonly parentCommitShas: readonly string[];
}

function normalizeCommitSha(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : "HEAD";
}

function resolveMockPreset(commitSha: string): MockCommitPreset {
  const normalized = commitSha.trim().toLowerCase();

  if (normalized === "head") {
    return "head";
  }

  if (normalized.startsWith("a11ce5e7")) {
    return "a11ce5e7";
  }

  if (normalized.startsWith("b7c4d9a2")) {
    return "b7c4d9a2";
  }

  if (normalized.startsWith("c0ffee42")) {
    return "c0ffee42";
  }

  return "head";
}

function createCommit(
  input: LoadCommitReviewInput,
  metadata: MockCommitMetadata,
): CommitReviewAggregate["commit"] {
  const commitSha = normalizeCommitSha(input.commitSha);

  return {
    id: `commit-${commitSha}`,
    repositoryPath: input.repositoryPath,
    commitSha,
    shortSha: commitSha.slice(0, 8),
    title: metadata.title,
    description: metadata.description,
    authorName: metadata.authorName,
    authorEmail: metadata.authorEmail,
    authoredAtIso: metadata.authoredAtIso,
    parentCommitShas: metadata.parentCommitShas,
  };
}

function createHeadAggregate(input: LoadCommitReviewInput): CommitReviewAggregate {
  const commit = createCommit(input, {
    title: "Introduce review MVP domain flow",
    description: "Adds entities, selectors, and listener orchestration for review sessions.",
    authorName: "Codex",
    authorEmail: "codex@example.com",
    authoredAtIso: "2026-02-22T16:45:00.000Z",
    parentCommitShas: ["parent-0001"],
  });

  const reviewStoreFileId = `${commit.id}-file-review-store`;
  const selectorsFileId = `${commit.id}-file-selectors`;
  const storeHunkId = `${commit.id}-hunk-store-bootstrap`;
  const selectorsHunkId = `${commit.id}-hunk-selectors`;
  const threadId = `${commit.id}-thread-memoized-selectors`;
  const commentId = `${commit.id}-comment-memoized-selectors`;

  const files: readonly ChangedFile[] = [
    {
      id: reviewStoreFileId,
      commitId: commit.id,
      path: "src/app/store/review/reviewStore.ts",
      status: "added",
      additions: 88,
      deletions: 0,
    },
    {
      id: selectorsFileId,
      commitId: commit.id,
      path: "src/application/review/selectors.ts",
      status: "modified",
      additions: 42,
      deletions: 12,
    },
  ];

  const hunks: readonly DiffHunk[] = [
    {
      id: storeHunkId,
      fileId: reviewStoreFileId,
      header: "@@ -0,0 +1,88 @@",
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 88,
      lines: [
        {
          kind: "add",
          newLineNumber: 1,
          text: "import { configureStore } from '@reduxjs/toolkit';",
        },
        {
          kind: "add",
          newLineNumber: 7,
          text: "import { reviewUiReducer } from './reviewUiSlice.ts';",
        },
        {
          kind: "add",
          newLineNumber: 62,
          text: "reviewListenerBundle.startListening({ actionCreator: loadCommitReviewRequested });",
        },
      ],
    },
    {
      id: selectorsHunkId,
      fileId: selectorsFileId,
      header: "@@ -10,11 +10,21 @@",
      oldStart: 10,
      oldLines: 11,
      newStart: 10,
      newLines: 21,
      lines: [
        {
          kind: "context",
          oldLineNumber: 10,
          newLineNumber: 10,
          text: "export function selectFilesForActiveCommit(state: ReviewRootState) {",
        },
        {
          kind: "remove",
          oldLineNumber: 12,
          text: "  return files.filter((file) => file.commitId === activeCommitId);",
        },
        {
          kind: "add",
          newLineNumber: 12,
          text: "  const memoizedFilteredFiles = memoizedFilesByCommitId[activeCommitId] ?? [];",
        },
        {
          kind: "add",
          newLineNumber: 13,
          text: "  return memoizedFilteredFiles;",
        },
      ],
    },
  ];

  const threads: readonly CommentThread[] = [
    {
      id: threadId,
      commitId: commit.id,
      fileId: selectorsFileId,
      hunkId: selectorsHunkId,
      anchor: {
        fileId: selectorsFileId,
        hunkId: selectorsHunkId,
        side: "new",
        lineNumber: 12,
      },
      messageIds: [commentId],
      status: "open",
      createdAtIso: "2026-02-22T17:00:00.000Z",
      updatedAtIso: "2026-02-22T17:00:00.000Z",
    },
  ];

  const comments: readonly ReviewComment[] = [
    {
      id: commentId,
      threadId,
      authorType: "human",
      authorId: "reviewer-1",
      body: "Can we avoid recomputing this per render?",
      createdAtIso: "2026-02-22T17:00:00.000Z",
      isDraft: true,
    },
  ];

  const overviewCards: readonly OverviewCard[] = [
    {
      id: `${commit.id}-card-summary`,
      commitId: commit.id,
      kind: "summary",
      title: "Review workflow scaffolding",
      body: "Introduces first pass of review state orchestration and selectors.",
      rank: 1,
    },
    {
      id: `${commit.id}-card-risk`,
      commitId: commit.id,
      kind: "risk",
      title: "Listener sequencing",
      body: "Ensure async listeners dispatch deterministic state transitions.",
      rank: 2,
    },
  ];

  return {
    commit,
    files,
    hunks,
    threads,
    comments,
    overviewCards,
    standardsRules: [],
    standardsResults: [],
  };
}

function createAuthHardeningAggregate(input: LoadCommitReviewInput): CommitReviewAggregate {
  const commit = createCommit(input, {
    title: "Harden auth session verification",
    description: "Moves token validation into middleware and introduces explicit drift handling for rotated keys.",
    authorName: "Clawdia",
    authorEmail: "clawdia@example.com",
    authoredAtIso: "2026-02-19T13:26:00.000Z",
    parentCommitShas: ["parent-auth-4471"],
  });

  const middlewareFileId = `${commit.id}-file-auth-middleware`;
  const sessionPolicyFileId = `${commit.id}-file-session-policy`;
  const userServiceFileId = `${commit.id}-file-user-service`;
  const middlewareHunkId = `${commit.id}-hunk-auth-middleware`;
  const sessionPolicyHunkId = `${commit.id}-hunk-session-policy`;
  const userServiceHunkId = `${commit.id}-hunk-user-service`;
  const threadAId = `${commit.id}-thread-clock-skew`;
  const threadBId = `${commit.id}-thread-audit-log`;
  const commentAId = `${commit.id}-comment-clock-skew`;
  const commentBId = `${commit.id}-comment-clock-skew-agent`;
  const commentCId = `${commit.id}-comment-audit-log`;

  const files: readonly ChangedFile[] = [
    {
      id: middlewareFileId,
      commitId: commit.id,
      path: "src/infrastructure/http/authMiddleware.ts",
      status: "added",
      additions: 79,
      deletions: 0,
    },
    {
      id: sessionPolicyFileId,
      commitId: commit.id,
      path: "src/domain/auth/sessionPolicy.ts",
      status: "modified",
      additions: 36,
      deletions: 8,
    },
    {
      id: userServiceFileId,
      commitId: commit.id,
      path: "src/application/user/userService.ts",
      status: "modified",
      additions: 24,
      deletions: 19,
    },
  ];

  const hunks: readonly DiffHunk[] = [
    {
      id: middlewareHunkId,
      fileId: middlewareFileId,
      header: "@@ -0,0 +1,79 @@",
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 79,
      lines: [
        {
          kind: "add",
          newLineNumber: 1,
          text: "import { verifyJwt, type JwtClaims } from '../../domain/auth/jwt.ts';",
        },
        {
          kind: "add",
          newLineNumber: 18,
          text: "const authHeader = request.headers['authorization']?.trim();",
        },
        {
          kind: "add",
          newLineNumber: 42,
          text: "request.authContext = mapClaimsToContext(claims as JwtClaims);",
        },
        {
          kind: "add",
          newLineNumber: 67,
          text: "next();",
        },
      ],
    },
    {
      id: sessionPolicyHunkId,
      fileId: sessionPolicyFileId,
      header: "@@ -21,11 +21,20 @@",
      oldStart: 21,
      oldLines: 11,
      newStart: 21,
      newLines: 20,
      lines: [
        {
          kind: "context",
          oldLineNumber: 21,
          newLineNumber: 21,
          text: "export function validateSessionLifetime(session: SessionToken) {",
        },
        {
          kind: "remove",
          oldLineNumber: 24,
          text: "  const driftWindowMs = 0;",
        },
        {
          kind: "add",
          newLineNumber: 24,
          text: "  const driftWindowMs = session.allowedClockSkewMs ?? 30_000;",
        },
        {
          kind: "add",
          newLineNumber: 25,
          text: "  const expiryWithSkew = session.expiresAtMs + driftWindowMs;",
        },
        {
          kind: "context",
          oldLineNumber: 28,
          newLineNumber: 29,
          text: "  return nowMs <= expiryWithSkew;",
        },
      ],
    },
    {
      id: userServiceHunkId,
      fileId: userServiceFileId,
      header: "@@ -88,14 +88,19 @@",
      oldStart: 88,
      oldLines: 14,
      newStart: 88,
      newLines: 19,
      lines: [
        {
          kind: "context",
          oldLineNumber: 88,
          newLineNumber: 88,
          text: "if (!session.isValid) {",
        },
        {
          kind: "remove",
          oldLineNumber: 90,
          text: "  return null;",
        },
        {
          kind: "add",
          newLineNumber: 90,
          text: "  auditLogger.warn('invalid-session', { userId, sessionId: session.id });",
        },
        {
          kind: "add",
          newLineNumber: 91,
          text: "  return null;",
        },
        {
          kind: "add",
          newLineNumber: 93,
          text: "refreshSessionClaims(session);",
        },
      ],
    },
  ];

  const threads: readonly CommentThread[] = [
    {
      id: threadAId,
      commitId: commit.id,
      fileId: sessionPolicyFileId,
      hunkId: sessionPolicyHunkId,
      anchor: {
        fileId: sessionPolicyFileId,
        hunkId: sessionPolicyHunkId,
        side: "new",
        lineNumber: 24,
      },
      messageIds: [commentAId, commentBId],
      status: "open",
      createdAtIso: "2026-02-19T14:04:00.000Z",
      updatedAtIso: "2026-02-19T14:07:00.000Z",
    },
    {
      id: threadBId,
      commitId: commit.id,
      fileId: userServiceFileId,
      hunkId: userServiceHunkId,
      anchor: {
        fileId: userServiceFileId,
        hunkId: userServiceHunkId,
        side: "new",
        lineNumber: 90,
      },
      messageIds: [commentCId],
      status: "resolved",
      createdAtIso: "2026-02-19T14:18:00.000Z",
      updatedAtIso: "2026-02-19T14:26:00.000Z",
    },
  ];

  const comments: readonly ReviewComment[] = [
    {
      id: commentAId,
      threadId: threadAId,
      authorType: "human",
      authorId: "security-reviewer",
      body: "Should the skew window be configurable by deployment environment?",
      createdAtIso: "2026-02-19T14:04:00.000Z",
      isDraft: false,
    },
    {
      id: commentBId,
      threadId: threadAId,
      authorType: "agent",
      authorId: "agent-auth",
      body: "Recommend default 30s with env override to prevent region clock drift false negatives.",
      createdAtIso: "2026-02-19T14:07:00.000Z",
      isDraft: false,
    },
    {
      id: commentCId,
      threadId: threadBId,
      authorType: "human",
      authorId: "platform-lead",
      body: "Audit signal looks good. Keep this warning structured for SIEM ingestion.",
      createdAtIso: "2026-02-19T14:18:00.000Z",
      isDraft: false,
    },
  ];

  const overviewCards: readonly OverviewCard[] = [
    {
      id: `${commit.id}-card-summary`,
      commitId: commit.id,
      kind: "summary",
      title: "Auth checks moved to middleware boundary",
      body: "Session verification now runs before route handlers, reducing duplicated auth checks.",
      rank: 1,
    },
    {
      id: `${commit.id}-card-impact`,
      commitId: commit.id,
      kind: "impact",
      title: "Touches HTTP + domain + application layers",
      body: "Three-layer edit increases blast radius; verify middleware ordering and claim propagation.",
      rank: 2,
    },
    {
      id: `${commit.id}-card-risk`,
      commitId: commit.id,
      kind: "risk",
      title: "Clock skew policy changed",
      body: "Default skew allowance could mask invalid token clocks if not monitored.",
      rank: 3,
    },
  ];

  return {
    commit,
    files,
    hunks,
    threads,
    comments,
    overviewCards,
    standardsRules: [],
    standardsResults: [],
  };
}

function createOverviewVisualAggregate(input: LoadCommitReviewInput): CommitReviewAggregate {
  const commit = createCommit(input, {
    title: "Ship interactive overview visuals",
    description: "Introduces architecture map + sequence rendering updates and ties them to file focus behavior.",
    authorName: "Mina",
    authorEmail: "mina@example.com",
    authoredAtIso: "2026-02-20T09:12:00.000Z",
    parentCommitShas: ["parent-visual-2040"],
  });

  const architectureMapFileId = `${commit.id}-file-architecture-map`;
  const overviewPanelFileId = `${commit.id}-file-overview-panel`;
  const sequenceFileId = `${commit.id}-file-before-after-sequence`;
  const mapHunkId = `${commit.id}-hunk-architecture-map`;
  const overviewHunkId = `${commit.id}-hunk-overview-panel`;
  const sequenceHunkId = `${commit.id}-hunk-before-after-sequence`;
  const threadId = `${commit.id}-thread-sequence-linking`;
  const commentAId = `${commit.id}-comment-sequence-linking`;
  const commentBId = `${commit.id}-comment-sequence-linking-agent`;

  const files: readonly ChangedFile[] = [
    {
      id: architectureMapFileId,
      commitId: commit.id,
      path: "src/interface/review/components/ArchitectureMap.tsx",
      status: "added",
      additions: 132,
      deletions: 0,
    },
    {
      id: overviewPanelFileId,
      commitId: commit.id,
      path: "src/interface/review/components/OverviewPanel.tsx",
      status: "modified",
      additions: 57,
      deletions: 21,
    },
    {
      id: sequenceFileId,
      commitId: commit.id,
      path: "src/interface/review/components/BeforeAfterSequence.tsx",
      previousPath: "src/interface/review/components/SequencePanel.tsx",
      status: "renamed",
      additions: 48,
      deletions: 14,
    },
  ];

  const hunks: readonly DiffHunk[] = [
    {
      id: mapHunkId,
      fileId: architectureMapFileId,
      header: "@@ -0,0 +1,132 @@",
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 132,
      lines: [
        {
          kind: "add",
          newLineNumber: 1,
          text: "import { buildGraphLayout } from './graphLayout.ts';",
        },
        {
          kind: "add",
          newLineNumber: 28,
          text: "const nodes = buildGraphLayout(clusters, viewportSize);",
        },
        {
          kind: "add",
          newLineNumber: 67,
          text: "<svg className=\"h-[22rem] w-full\" viewBox={viewBox}>",
        },
        {
          kind: "add",
          newLineNumber: 101,
          text: "onClick={() => onSelectFiles(node.fileIds)}",
        },
      ],
    },
    {
      id: overviewHunkId,
      fileId: overviewPanelFileId,
      header: "@@ -41,20 +41,36 @@",
      oldStart: 41,
      oldLines: 20,
      newStart: 41,
      newLines: 36,
      lines: [
        {
          kind: "context",
          oldLineNumber: 41,
          newLineNumber: 41,
          text: "export function OverviewPanel({ overviewCards, architectureClusters, sequencePairs, onSelectFiles }: Props) {",
        },
        {
          kind: "remove",
          oldLineNumber: 58,
          text: "<CardTitle>Architecture Impact Map</CardTitle>",
        },
        {
          kind: "add",
          newLineNumber: 58,
          text: "<CardTitle>Architecture Graph</CardTitle>",
        },
        {
          kind: "add",
          newLineNumber: 72,
          text: "<ArchitectureMap clusters={architectureClusters} onSelectFiles={onSelectFiles} />",
        },
      ],
    },
    {
      id: sequenceHunkId,
      fileId: sequenceFileId,
      header: "@@ -11,13 +11,31 @@",
      oldStart: 11,
      oldLines: 13,
      newStart: 11,
      newLines: 31,
      lines: [
        {
          kind: "context",
          oldLineNumber: 11,
          newLineNumber: 11,
          text: "export function BeforeAfterSequence({ pairs, highlightedFileIds, onSelectFiles }: Props) {",
        },
        {
          kind: "add",
          newLineNumber: 18,
          text: "const beforeTone = isBeforeFocused ? 'border-caution/80 bg-caution/10' : 'border-border';",
        },
        {
          kind: "add",
          newLineNumber: 26,
          text: "onClick={() => onSelectFiles(pair.after.fileIds)}",
        },
      ],
    },
  ];

  const threads: readonly CommentThread[] = [
    {
      id: threadId,
      commitId: commit.id,
      fileId: overviewPanelFileId,
      hunkId: overviewHunkId,
      anchor: {
        fileId: overviewPanelFileId,
        hunkId: overviewHunkId,
        side: "new",
        lineNumber: 72,
      },
      messageIds: [commentAId, commentBId],
      status: "open",
      createdAtIso: "2026-02-20T09:39:00.000Z",
      updatedAtIso: "2026-02-20T09:44:00.000Z",
    },
  ];

  const comments: readonly ReviewComment[] = [
    {
      id: commentAId,
      threadId,
      authorType: "human",
      authorId: "ux-reviewer",
      body: "Can we sync architecture node clicks with the file sidebar highlight state?",
      createdAtIso: "2026-02-20T09:39:00.000Z",
      isDraft: false,
    },
    {
      id: commentBId,
      threadId,
      authorType: "agent",
      authorId: "agent-ui",
      body: "Yes. A shared callback can set `highlightedFileIds` before switching to the Files tab.",
      createdAtIso: "2026-02-20T09:44:00.000Z",
      isDraft: false,
    },
  ];

  const overviewCards: readonly OverviewCard[] = [
    {
      id: `${commit.id}-card-summary`,
      commitId: commit.id,
      kind: "summary",
      title: "Overview tab now renders richer visual context",
      body: "Architecture graph and sequence blocks are introduced as first-class review navigation tools.",
      rank: 1,
    },
    {
      id: `${commit.id}-card-impact`,
      commitId: commit.id,
      kind: "impact",
      title: "Strong coupling to changed-file selection",
      body: "Map and sequence interactions both push file focus to keep context synchronized.",
      rank: 2,
    },
    {
      id: `${commit.id}-card-question`,
      commitId: commit.id,
      kind: "question",
      title: "Interaction density tradeoff",
      body: "Consider whether both visuals should auto-jump tabs or support inline diff preview.",
      rank: 3,
    },
    {
      id: `${commit.id}-card-risk`,
      commitId: commit.id,
      kind: "risk",
      title: "Large UI component additions",
      body: "Added component size raises maintainability risk without extracted view models.",
      rank: 4,
    },
  ];

  return {
    commit,
    files,
    hunks,
    threads,
    comments,
    overviewCards,
    standardsRules: [],
    standardsResults: [],
  };
}

function createStandardsParserAggregate(input: LoadCommitReviewInput): CommitReviewAggregate {
  const commit = createCommit(input, {
    title: "Refactor standards parser pipeline",
    description: "Deletes legacy parser and adds deterministic evaluator parsing for line-scoped evidence output.",
    authorName: "Ivy",
    authorEmail: "ivy@example.com",
    authoredAtIso: "2026-02-21T11:58:00.000Z",
    parentCommitShas: ["parent-standards-8842"],
  });

  const legacyParserFileId = `${commit.id}-file-legacy-parser`;
  const evaluatorFileId = `${commit.id}-file-evaluator`;
  const selectorsFileId = `${commit.id}-file-standards-selectors`;
  const standardsIndexFileId = `${commit.id}-file-standards-index`;
  const legacyParserHunkId = `${commit.id}-hunk-legacy-parser-removal`;
  const evaluatorHunkId = `${commit.id}-hunk-evaluator-refactor`;
  const selectorsHunkId = `${commit.id}-hunk-standards-selectors`;
  const standardsIndexHunkId = `${commit.id}-hunk-standards-index`;
  const threadAId = `${commit.id}-thread-evidence-ordering`;
  const threadBId = `${commit.id}-thread-export-boundary`;
  const commentAId = `${commit.id}-comment-evidence-ordering`;
  const commentBId = `${commit.id}-comment-export-boundary`;

  const files: readonly ChangedFile[] = [
    {
      id: legacyParserFileId,
      commitId: commit.id,
      path: "src/infrastructure/review/legacyRuleParser.ts",
      status: "deleted",
      additions: 0,
      deletions: 96,
    },
    {
      id: evaluatorFileId,
      commitId: commit.id,
      path: "src/infrastructure/review/standardsRuleTextEvaluator.ts",
      status: "modified",
      additions: 67,
      deletions: 31,
    },
    {
      id: selectorsFileId,
      commitId: commit.id,
      path: "src/application/review/standards/selectors.ts",
      status: "added",
      additions: 44,
      deletions: 0,
    },
    {
      id: standardsIndexFileId,
      commitId: commit.id,
      path: "src/application/review/standards/index.ts",
      status: "modified",
      additions: 18,
      deletions: 4,
    },
  ];

  const hunks: readonly DiffHunk[] = [
    {
      id: legacyParserHunkId,
      fileId: legacyParserFileId,
      header: "@@ -1,96 +0,0 @@",
      oldStart: 1,
      oldLines: 96,
      newStart: 0,
      newLines: 0,
      lines: [
        {
          kind: "remove",
          oldLineNumber: 1,
          text: "export function parseLegacyRules(raw: string): ParsedRule[] {",
        },
        {
          kind: "remove",
          oldLineNumber: 47,
          text: "  const sections = raw.split('---').map((section) => section.trim());",
        },
        {
          kind: "remove",
          oldLineNumber: 95,
          text: "}",
        },
      ],
    },
    {
      id: evaluatorHunkId,
      fileId: evaluatorFileId,
      header: "@@ -22,24 +22,49 @@",
      oldStart: 22,
      oldLines: 24,
      newStart: 22,
      newLines: 49,
      lines: [
        {
          kind: "context",
          oldLineNumber: 22,
          newLineNumber: 22,
          text: "export function evaluateStandardsRuleText(input: StandardsEvaluationInput): StandardsEvaluationOutput {",
        },
        {
          kind: "remove",
          oldLineNumber: 33,
          text: "const parsed = parseLegacyRules(input.ruleText);",
        },
        {
          kind: "add",
          newLineNumber: 33,
          text: "const parsed = parseRuleBlocks(input.ruleText).sort((left, right) => left.order - right.order);",
        },
        {
          kind: "add",
          newLineNumber: 58,
          text: "const evidence = collectEvidence(parsedRule, input.files, input.hunks);",
        },
        {
          kind: "add",
          newLineNumber: 65,
          text: "return freezeEvaluation({ rules, results });",
        },
      ],
    },
    {
      id: selectorsHunkId,
      fileId: selectorsFileId,
      header: "@@ -0,0 +1,44 @@",
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 44,
      lines: [
        {
          kind: "add",
          newLineNumber: 1,
          text: "import type { ReviewRootState } from '../types.ts';",
        },
        {
          kind: "add",
          newLineNumber: 12,
          text: "export function selectFailingStandardsResultIds(state: ReviewRootState): readonly string[] {",
        },
        {
          kind: "add",
          newLineNumber: 23,
          text: "return resultIds.filter((resultId) => state.reviewEntities.standardsResultsById[resultId]?.status === 'fail');",
        },
      ],
    },
    {
      id: standardsIndexHunkId,
      fileId: standardsIndexFileId,
      header: "@@ -1,12 +1,26 @@",
      oldStart: 1,
      oldLines: 12,
      newStart: 1,
      newLines: 26,
      lines: [
        {
          kind: "context",
          oldLineNumber: 1,
          newLineNumber: 1,
          text: "export { evaluateStandardsRuleText } from './standardsRuleTextEvaluator.ts';",
        },
        {
          kind: "add",
          newLineNumber: 5,
          text: "export { selectFailingStandardsResultIds } from './selectors.ts';",
        },
        {
          kind: "add",
          newLineNumber: 12,
          text: "export type { StandardsSummary } from './types.ts';",
        },
      ],
    },
  ];

  const threads: readonly CommentThread[] = [
    {
      id: threadAId,
      commitId: commit.id,
      fileId: evaluatorFileId,
      hunkId: evaluatorHunkId,
      anchor: {
        fileId: evaluatorFileId,
        hunkId: evaluatorHunkId,
        side: "new",
        lineNumber: 58,
      },
      messageIds: [commentAId],
      status: "open",
      createdAtIso: "2026-02-21T12:12:00.000Z",
      updatedAtIso: "2026-02-21T12:12:00.000Z",
    },
    {
      id: threadBId,
      commitId: commit.id,
      fileId: standardsIndexFileId,
      hunkId: standardsIndexHunkId,
      anchor: {
        fileId: standardsIndexFileId,
        hunkId: standardsIndexHunkId,
        side: "new",
        lineNumber: 5,
      },
      messageIds: [commentBId],
      status: "open",
      createdAtIso: "2026-02-21T12:22:00.000Z",
      updatedAtIso: "2026-02-21T12:22:00.000Z",
    },
  ];

  const comments: readonly ReviewComment[] = [
    {
      id: commentAId,
      threadId: threadAId,
      authorType: "human",
      authorId: "qa-reviewer",
      body: "Evidence ordering should be deterministic so publish payload snapshots do not flap.",
      createdAtIso: "2026-02-21T12:12:00.000Z",
      isDraft: false,
    },
    {
      id: commentBId,
      threadId: threadBId,
      authorType: "human",
      authorId: "reviewer-2",
      body: "Export looks right. Confirm no circular import between standards index and selectors.",
      createdAtIso: "2026-02-21T12:22:00.000Z",
      isDraft: false,
    },
  ];

  const overviewCards: readonly OverviewCard[] = [
    {
      id: `${commit.id}-card-summary`,
      commitId: commit.id,
      kind: "summary",
      title: "Legacy parser removed",
      body: "Old section-based parser was deleted and replaced with deterministic block parsing.",
      rank: 1,
    },
    {
      id: `${commit.id}-card-impact`,
      commitId: commit.id,
      kind: "impact",
      title: "Standards pipeline reshaped",
      body: "Evaluator + selectors now emit predictable result ordering for downstream summaries.",
      rank: 2,
    },
    {
      id: `${commit.id}-card-question`,
      commitId: commit.id,
      kind: "question",
      title: "Snapshot stability",
      body: "Confirm serialized standards results remain stable across equivalent rule text formatting.",
      rank: 3,
    },
    {
      id: `${commit.id}-card-risk`,
      commitId: commit.id,
      kind: "risk",
      title: "Deletion of compatibility parser",
      body: "Repositories still using legacy syntax could lose standards coverage until migrated.",
      rank: 4,
    },
  ];

  return {
    commit,
    files,
    hunks,
    threads,
    comments,
    overviewCards,
    standardsRules: [],
    standardsResults: [],
  };
}

function createMockAggregate(input: LoadCommitReviewInput): CommitReviewAggregate {
  const preset = resolveMockPreset(input.commitSha);

  if (preset === "a11ce5e7") {
    return createAuthHardeningAggregate(input);
  }

  if (preset === "b7c4d9a2") {
    return createOverviewVisualAggregate(input);
  }

  if (preset === "c0ffee42") {
    return createStandardsParserAggregate(input);
  }

  return createHeadAggregate(input);
}

export class MockCommitReviewDataSource implements CommitReviewDataSource {
  async loadCommitReview(input: LoadCommitReviewInput): Promise<CommitReviewAggregate> {
    return createMockAggregate(input);
  }
}

export function createMockCommitReviewDataSource(): CommitReviewDataSource {
  return new MockCommitReviewDataSource();
}
