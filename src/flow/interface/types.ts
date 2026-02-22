export interface FlowCodeReference {
  path: string;
  line: number;
}

export interface FlowDiagramNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface FlowDiagramEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface FlowStep {
  id: string;
  title: string;
  description?: string;
  focusNodeIds: string[];
  focusEdgeIds: string[];
  codeRef: FlowCodeReference;
}

export interface FlowDiagram {
  nodes: FlowDiagramNode[];
  edges: FlowDiagramEdge[];
}

export interface FlowSchema {
  version: string;
  diagram: FlowDiagram;
  trace: FlowStep[];
}

export interface ValidationIssue {
  message: string;
  path?: string;
}

export interface CodePreview {
  path: string;
  line: number;
  startLine: number;
  endLine: number;
  snippet: string;
}

export interface ParseSuccess {
  ok: true;
  value: FlowSchema;
}

export interface ParseFailure {
  ok: false;
  errors: ValidationIssue[];
}

export type ParseResult = ParseSuccess | ParseFailure;

export interface WorkflowLoadSuccess {
  ok: true;
  value: FlowSchema;
  repoRoot: string;
  source: string;
}

export interface WorkflowLoadFailure {
  ok: false;
  errors: ValidationIssue[];
}

export type WorkflowLoadResult = WorkflowLoadSuccess | WorkflowLoadFailure;

export interface RepoCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
  prompt: string;
}

export interface CommitDiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  lineHint: number;
  summary: string;
  diff: string;
}

export interface CommitReviewPayload {
  source: string;
  repoRoot: string;
  commit: RepoCommit;
  prompt: string;
  overallSummary: string;
  changedFiles: CommitDiffFile[];
  schema: FlowSchema;
}

export interface CommitListLoadSuccess {
  ok: true;
  repoRoot: string;
  commits: RepoCommit[];
}

export interface CommitListLoadFailure {
  ok: false;
  errors: ValidationIssue[];
}

export type CommitListLoadResult = CommitListLoadSuccess | CommitListLoadFailure;

export interface CommitReviewLoadSuccess {
  ok: true;
  value: CommitReviewPayload;
}

export interface CommitReviewLoadFailure {
  ok: false;
  errors: ValidationIssue[];
}

export type CommitReviewLoadResult = CommitReviewLoadSuccess | CommitReviewLoadFailure;
