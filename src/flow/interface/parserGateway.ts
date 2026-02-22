import type { FlowDocument } from "../domain";
import { safeParseFlowDocument } from "../infrastructure";
import type { FlowParseIssue } from "../infrastructure";
import type {
  CommitDiffFile,
  CommitListLoadResult,
  CommitReviewLoadResult,
  CommitReviewPayload,
  RepoCommit,
  FlowSchema,
  ParseResult,
  ValidationIssue,
  WorkflowLoadResult,
} from "./types";

export async function parseUploadedFlowSchema(jsonText: string): Promise<ParseResult> {
  let parsedInput: unknown;

  try {
    parsedInput = JSON.parse(jsonText);
  } catch {
    return {
      ok: false,
      errors: [{ message: "Input is not valid JSON.", path: "$" }],
    };
  }

  const parseResult = safeParseFlowDocument(parsedInput);
  if (!parseResult.success) {
    return {
      ok: false,
      errors: parseResult.issues.map(toValidationIssue),
    };
  }

  return {
    ok: true,
    value: toFlowSchema(parseResult.data),
  };
}

interface AgentWorkflowResponse {
  schema: unknown;
  repoRoot: string;
  source: string;
}

function isAgentWorkflowResponse(value: unknown): value is AgentWorkflowResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<AgentWorkflowResponse>;
  return (
    typeof candidate.repoRoot === "string" &&
    typeof candidate.source === "string" &&
    candidate.schema !== undefined
  );
}

export async function loadAgentWorkflowFromRepo(repoPath: string): Promise<WorkflowLoadResult> {
  const searchParams = new URLSearchParams({ repoPath });

  try {
    const response = await fetch(`/api/workflow/agent-app-control?${searchParams.toString()}`);
    const payload = (await response.json()) as unknown;

    if (!response.ok) {
      const message =
        typeof (payload as { error?: unknown }).error === "string"
          ? String((payload as { error?: string }).error)
          : "Unable to load workflow from repository.";
      return {
        ok: false,
        errors: [{ path: "repoPath", message }],
      };
    }

    if (!isAgentWorkflowResponse(payload)) {
      return {
        ok: false,
        errors: [{ path: "response", message: "Workflow response format is invalid." }],
      };
    }

    const parseResult = safeParseFlowDocument(payload.schema);
    if (!parseResult.success) {
      return {
        ok: false,
        errors: parseResult.issues.map(toValidationIssue),
      };
    }

    return {
      ok: true,
      value: toFlowSchema(parseResult.data),
      repoRoot: payload.repoRoot,
      source: payload.source,
    };
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          path: "network",
          message: error instanceof Error ? error.message : "Unexpected workflow loading error.",
        },
      ],
    };
  }
}

interface RepoCommitsResponse {
  repoRoot: string;
  commits: RepoCommit[];
}

function isRepoCommit(value: unknown): value is RepoCommit {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<RepoCommit>;
  return (
    typeof candidate.hash === "string" &&
    typeof candidate.shortHash === "string" &&
    typeof candidate.subject === "string" &&
    typeof candidate.author === "string" &&
    typeof candidate.date === "string" &&
    typeof candidate.prompt === "string"
  );
}

function isRepoCommitsResponse(value: unknown): value is RepoCommitsResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { repoRoot?: unknown; commits?: unknown };
  return (
    typeof candidate.repoRoot === "string" &&
    Array.isArray(candidate.commits) &&
    candidate.commits.every(isRepoCommit)
  );
}

export async function loadRepoCommits(
  repoPath: string,
  limit = 30,
): Promise<CommitListLoadResult> {
  const searchParams = new URLSearchParams({
    repoPath,
    limit: String(limit),
  });

  try {
    const response = await fetch(`/api/review/commits?${searchParams.toString()}`);
    const payload = (await response.json()) as unknown;

    if (!response.ok) {
      const message =
        typeof (payload as { error?: unknown }).error === "string"
          ? String((payload as { error?: string }).error)
          : "Unable to load commit list.";
      return {
        ok: false,
        errors: [{ path: "repoPath", message }],
      };
    }

    if (!isRepoCommitsResponse(payload)) {
      return {
        ok: false,
        errors: [{ path: "response", message: "Commit list response format is invalid." }],
      };
    }

    return {
      ok: true,
      repoRoot: payload.repoRoot,
      commits: payload.commits,
    };
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          path: "network",
          message: error instanceof Error ? error.message : "Unexpected commit list loading error.",
        },
      ],
    };
  }
}

interface RawCommitDiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  lineHint: number;
  summary: string;
  diff: string;
}

interface RawCommitReviewResponse {
  source: string;
  repoRoot: string;
  commit: RepoCommit;
  prompt: string;
  overallSummary: string;
  changedFiles: RawCommitDiffFile[];
  schema: unknown;
}

function isRawCommitDiffFile(value: unknown): value is RawCommitDiffFile {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<RawCommitDiffFile>;
  return (
    typeof candidate.path === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.additions === "number" &&
    typeof candidate.deletions === "number" &&
    typeof candidate.lineHint === "number" &&
    typeof candidate.summary === "string" &&
    typeof candidate.diff === "string"
  );
}

function isRawCommitReviewResponse(value: unknown): value is RawCommitReviewResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    source?: unknown;
    repoRoot?: unknown;
    commit?: unknown;
    prompt?: unknown;
    overallSummary?: unknown;
    changedFiles?: unknown;
    schema?: unknown;
  };
  return (
    typeof candidate.source === "string" &&
    typeof candidate.repoRoot === "string" &&
    isRepoCommit(candidate.commit) &&
    typeof candidate.prompt === "string" &&
    typeof candidate.overallSummary === "string" &&
    Array.isArray(candidate.changedFiles) &&
    candidate.changedFiles.every(isRawCommitDiffFile) &&
    candidate.schema !== undefined
  );
}

function normalizeCommitDiffFiles(files: RawCommitDiffFile[]): CommitDiffFile[] {
  return files.map((file) => ({
    path: file.path,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    lineHint: file.lineHint,
    summary: file.summary,
    diff: file.diff,
  }));
}

export async function loadCommitReviewFromRepo(
  repoPath: string,
  commitHash: string,
): Promise<CommitReviewLoadResult> {
  const searchParams = new URLSearchParams({
    repoPath,
    commit: commitHash,
  });

  try {
    const response = await fetch(`/api/review/commit?${searchParams.toString()}`);
    const payload = (await response.json()) as unknown;

    if (!response.ok) {
      const message =
        typeof (payload as { error?: unknown }).error === "string"
          ? String((payload as { error?: string }).error)
          : "Unable to load commit review.";
      return {
        ok: false,
        errors: [{ path: "commit", message }],
      };
    }

    if (!isRawCommitReviewResponse(payload)) {
      return {
        ok: false,
        errors: [{ path: "response", message: "Commit review response format is invalid." }],
      };
    }

    const parseResult = safeParseFlowDocument(payload.schema);
    if (!parseResult.success) {
      return {
        ok: false,
        errors: parseResult.issues.map(toValidationIssue),
      };
    }

    const value: CommitReviewPayload = {
      source: payload.source,
      repoRoot: payload.repoRoot,
      commit: payload.commit,
      prompt: payload.prompt,
      overallSummary: payload.overallSummary,
      changedFiles: normalizeCommitDiffFiles(payload.changedFiles),
      schema: toFlowSchema(parseResult.data),
    };

    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          path: "network",
          message: error instanceof Error ? error.message : "Unexpected commit review loading error.",
        },
      ],
    };
  }
}

function toValidationIssue(issue: FlowParseIssue): ValidationIssue {
  return {
    message: issue.message,
    path: issue.path,
  };
}

function toFlowSchema(document: FlowDocument): FlowSchema {
  return {
    version: document.version,
    diagram: {
      nodes: document.diagram.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        x: node.x,
        y: node.y,
      })),
      edges: document.diagram.edges.map((edge) => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        label: edge.label,
      })),
    },
    trace: document.trace.map((step) => ({
      id: step.id,
      title: step.title,
      description: step.description,
      focusNodeIds: [...step.focusNodeIds],
      focusEdgeIds: [...step.focusEdgeIds],
      codeRef: {
        path: step.codeRef.path,
        line: step.codeRef.line,
      },
    })),
  };
}
