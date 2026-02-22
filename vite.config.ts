import { execFile as execFileCallback } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const DEFAULT_CONTEXT_LINES = 8;
const MAX_CONTEXT_LINES = 30;
const MAX_FILE_SIZE_BYTES = 1_000_000;
const MAX_DIFF_LINES_PER_FILE = 1200;
const execFile = promisify(execFileCallback);

interface GitCommit {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  author: string;
  date: string;
}

interface ChangedFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  lineHint: number;
  summary: string;
  diff: string;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function parsePositiveInt(value: string | null, fallbackValue: number): number {
  if (value === null) {
    return fallbackValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return parsed;
}

function assertCommitHash(commit: string): string {
  const normalized = commit.trim();
  if (!/^[0-9a-fA-F]{6,40}$/.test(normalized)) {
    throw new Error("Invalid commit hash format.");
  }
  return normalized;
}

async function runGit(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

async function ensureGitRepository(repoRoot: string): Promise<void> {
  try {
    await runGit(repoRoot, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new Error(`Path is not a git repository: ${repoRoot}`);
  }
}

function inferPromptFromCommit(subject: string, body: string): string {
  const promptPattern = /(?:^|\n)\s*(?:Prompt|User Prompt|Request)\s*:\s*(.+)/i;
  const explicitMatch = body.match(promptPattern);
  if (explicitMatch?.[1]) {
    return explicitMatch[1].trim();
  }

  const firstBodyLine = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstBodyLine !== undefined) {
    return firstBodyLine;
  }

  return subject.trim();
}

function classifyArea(filePath: string): string {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith(".test.ts") || normalized.endsWith(".spec.ts")) {
    return "tests";
  }
  if (normalized.endsWith(".css")) {
    return "styling";
  }
  if (normalized.includes("/interface/") || normalized.endsWith(".tsx")) {
    return "ui";
  }
  if (normalized.includes("/domain/")) {
    return "domain logic";
  }
  if (normalized.includes("/infrastructure/") || normalized.includes("vite.config")) {
    return "infrastructure";
  }
  if (normalized.includes("/application/")) {
    return "application logic";
  }
  if (normalized.endsWith(".md")) {
    return "documentation";
  }
  return "core code";
}

function inferFileSummary(filePath: string, status: string, additions: number, deletions: number): string {
  const area = classifyArea(filePath);
  const verb =
    status === "A" ? "Introduces" : status === "D" ? "Removes" : status.startsWith("R") ? "Renames/updates" : "Updates";
  return `${verb} ${area} (+${Math.max(0, additions)}/-${Math.max(0, deletions)} lines).`;
}

function inferOverallSummary(subject: string, files: ChangedFile[]): string {
  const totalAdditions = files.reduce((sum, file) => sum + Math.max(0, file.additions), 0);
  const totalDeletions = files.reduce((sum, file) => sum + Math.max(0, file.deletions), 0);
  const areaCounts = new Map<string, number>();
  for (const file of files) {
    const area = classifyArea(file.path);
    areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
  }

  const topAreas = [...areaCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([area]) => area);

  const areaSummary = topAreas.length > 0 ? `Main areas: ${topAreas.join(", ")}.` : "Main areas are mixed.";

  return `${subject}. ${files.length} files changed (+${totalAdditions}/-${totalDeletions}). ${areaSummary}`;
}

function extractLineHintFromDiff(diff: string): number {
  const hunkMatch = diff.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/m);
  if (hunkMatch?.[1] === undefined) {
    return 1;
  }

  const parsed = Number.parseInt(hunkMatch[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function trimDiffForDisplay(diff: string): string {
  const lines = diff.split(/\r?\n/);
  if (lines.length <= MAX_DIFF_LINES_PER_FILE) {
    return diff;
  }

  const head = lines.slice(0, MAX_DIFF_LINES_PER_FILE);
  head.push("... diff truncated for display ...");
  return head.join("\n");
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedTarget = path.resolve(targetPath);
  if (normalizedTarget === normalizedRoot) {
    return true;
  }
  return normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

async function resolveExistingDirectory(rootPath: string): Promise<boolean> {
  try {
    const stats = await stat(rootPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function resolveBaseRoot(projectRoot: string, rawRepoRoot: string | null): Promise<string> {
  if (rawRepoRoot === null || rawRepoRoot.trim().length === 0) {
    return projectRoot;
  }

  const normalizedRepoRoot = rawRepoRoot.trim();

  const candidate = path.isAbsolute(normalizedRepoRoot)
    ? path.resolve(normalizedRepoRoot)
    : path.resolve(projectRoot, normalizedRepoRoot);

  const exists = await resolveExistingDirectory(candidate);
  if (!exists) {
    throw new Error(`Repository root does not exist: ${candidate}`);
  }

  return candidate;
}

function normalizeSourcePath(rawPath: string): string {
  return rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function createSourcePreviewMiddleware() {
  const projectRoot = path.resolve(process.cwd());

  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void,
  ): Promise<void> => {
    if (req.method !== "GET" || req.url === undefined) {
      next();
      return;
    }

    const requestUrl = new URL(req.url, "http://localhost");
    if (requestUrl.pathname !== "/api/source") {
      next();
      return;
    }

    const rawPath = requestUrl.searchParams.get("path");
    if (rawPath === null || rawPath.trim().length === 0) {
      sendJson(res, 400, { error: "Missing required query param: path" });
      return;
    }

    let baseRoot = projectRoot;
    try {
      baseRoot = await resolveBaseRoot(projectRoot, requestUrl.searchParams.get("repoRoot"));
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : "Invalid repository root.",
      });
      return;
    }

    const requestedLine = Number.parseInt(requestUrl.searchParams.get("line") ?? "1", 10);
    const requestedContext = Number.parseInt(
      requestUrl.searchParams.get("context") ?? String(DEFAULT_CONTEXT_LINES),
      10,
    );

    const line = Number.isFinite(requestedLine) && requestedLine > 0 ? requestedLine : 1;
    const contextLines =
      Number.isFinite(requestedContext) && requestedContext >= 0
        ? Math.min(requestedContext, MAX_CONTEXT_LINES)
        : DEFAULT_CONTEXT_LINES;

    const normalizedRawPath = rawPath.trim();
    const normalizedPath = normalizeSourcePath(normalizedRawPath);
    const absolutePath = path.isAbsolute(normalizedRawPath)
      ? path.resolve(normalizedRawPath)
      : path.resolve(baseRoot, normalizedPath);

    if (!isPathInsideRoot(absolutePath, baseRoot)) {
      sendJson(res, 403, { error: "File path must stay inside the selected repository root." });
      return;
    }

    try {
      const sourceStats = await stat(absolutePath);
      if (!sourceStats.isFile()) {
        sendJson(res, 400, { error: "Target path is not a file." });
        return;
      }

      const sourceBuffer = await readFile(absolutePath);
      if (sourceBuffer.byteLength > MAX_FILE_SIZE_BYTES) {
        sendJson(res, 413, { error: "File is too large to preview." });
        return;
      }

      const allLines = sourceBuffer.toString("utf8").split(/\r?\n/);
      const startLine = Math.max(1, line - contextLines);
      const endLine = Math.min(allLines.length, line + contextLines);
      const snippet = allLines.slice(startLine - 1, endLine).join("\n");

      sendJson(res, 200, {
        path: path.relative(baseRoot, absolutePath).replace(/\\/g, "/"),
        line,
        startLine,
        endLine,
        snippet,
      });
    } catch (error: unknown) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        sendJson(res, 404, { error: `File not found: ${normalizedPath}` });
        return;
      }

      sendJson(res, 500, { error: "Unable to read source file." });
    }
  };
}

function parseGitLogRecords(stdout: string): GitCommit[] {
  const records = stdout
    .split("\x1e")
    .map((record) => record.trim())
    .filter((record) => record.length > 0);

  return records
    .map((record) => {
      const fields = record.split("\x1f");
      if (fields.length < 6) {
        return null;
      }

      const [hash, shortHash, subject, body, author, date] = fields;
      return {
        hash: hash.trim(),
        shortHash: shortHash.trim(),
        subject: subject.trim(),
        body: body.trim(),
        author: author.trim(),
        date: date.trim(),
      } satisfies GitCommit;
    })
    .filter((commit): commit is GitCommit => commit !== null);
}

async function listRepoCommits(repoRoot: string, limit: number): Promise<GitCommit[]> {
  const stdout = await runGit(repoRoot, [
    "log",
    `-n${limit}`,
    "--date=iso-strict",
    "--pretty=format:%H%x1f%h%x1f%s%x1f%b%x1f%an%x1f%ad%x1e",
  ]);
  return parseGitLogRecords(stdout);
}

async function readSingleCommit(repoRoot: string, commitHash: string): Promise<GitCommit> {
  const stdout = await runGit(repoRoot, [
    "show",
    "-s",
    "--date=iso-strict",
    "--pretty=format:%H%x1f%h%x1f%s%x1f%b%x1f%an%x1f%ad%x1e",
    commitHash,
  ]);
  const parsed = parseGitLogRecords(stdout);
  const commit = parsed[0];
  if (commit === undefined) {
    throw new Error(`Commit not found: ${commitHash}`);
  }
  return commit;
}

type ChangedFileMeta = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
};

function normalizeStatusPathParts(parts: string[]): { status: string; path: string } | null {
  if (parts.length < 2) {
    return null;
  }

  const rawStatus = parts[0]?.trim();
  if (rawStatus === undefined || rawStatus.length === 0) {
    return null;
  }

  if (rawStatus.startsWith("R") || rawStatus.startsWith("C")) {
    const renamedPath = parts[2]?.trim() ?? parts[1]?.trim();
    if (renamedPath === undefined || renamedPath.length === 0) {
      return null;
    }
    return {
      status: rawStatus[0],
      path: renamedPath,
    };
  }

  const statusPath = parts[1]?.trim();
  if (statusPath === undefined || statusPath.length === 0) {
    return null;
  }
  return {
    status: rawStatus[0] ?? "M",
    path: statusPath,
  };
}

async function readChangedFileMetaMap(
  repoRoot: string,
  commitHash: string,
): Promise<Map<string, ChangedFileMeta>> {
  const metaMap = new Map<string, ChangedFileMeta>();

  const statusOutput = await runGit(repoRoot, [
    "show",
    "--name-status",
    "--format=",
    commitHash,
  ]);
  for (const line of statusOutput.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const parsed = normalizeStatusPathParts(trimmed.split("\t"));
    if (parsed === null) {
      continue;
    }
    metaMap.set(parsed.path, {
      path: parsed.path,
      status: parsed.status,
      additions: 0,
      deletions: 0,
    });
  }

  const numstatOutput = await runGit(repoRoot, [
    "show",
    "--numstat",
    "--format=",
    commitHash,
  ]);
  for (const line of numstatOutput.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const parts = trimmed.split("\t");
    if (parts.length < 3) {
      continue;
    }

    const additions = parts[0] === "-" ? 0 : Number.parseInt(parts[0] ?? "0", 10);
    const deletions = parts[1] === "-" ? 0 : Number.parseInt(parts[1] ?? "0", 10);
    const pathValue = parts[2]?.trim();
    if (pathValue === undefined || pathValue.length === 0) {
      continue;
    }

    const existing = metaMap.get(pathValue);
    if (existing !== undefined) {
      existing.additions = Number.isFinite(additions) ? additions : 0;
      existing.deletions = Number.isFinite(deletions) ? deletions : 0;
      continue;
    }

    metaMap.set(pathValue, {
      path: pathValue,
      status: "M",
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
    });
  }

  return metaMap;
}

function parseDiffByFile(diffOutput: string): Map<string, string> {
  const fileDiffs = new Map<string, string>();
  const lines = diffOutput.split(/\r?\n/);

  let currentPath: string | null = null;
  let currentLines: string[] = [];

  const flushCurrentDiff = () => {
    if (currentPath === null) {
      return;
    }
    fileDiffs.set(currentPath, currentLines.join("\n").trimEnd());
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flushCurrentDiff();
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      currentPath = match?.[2]?.trim() ?? null;
      currentLines = [line];
      continue;
    }

    if (currentPath !== null) {
      currentLines.push(line);
    }
  }

  flushCurrentDiff();
  return fileDiffs;
}

async function readChangedFiles(
  repoRoot: string,
  commitHash: string,
): Promise<ChangedFile[]> {
  const metaMap = await readChangedFileMetaMap(repoRoot, commitHash);
  const patchOutput = await runGit(repoRoot, [
    "show",
    "--no-color",
    "--unified=5",
    "--format=",
    commitHash,
  ]);
  const patchByFile = parseDiffByFile(patchOutput);

  const allPaths = new Set<string>([...metaMap.keys(), ...patchByFile.keys()]);
  const files: ChangedFile[] = [];

  for (const filePath of allPaths) {
    const meta = metaMap.get(filePath);
    const diff = patchByFile.get(filePath) ?? "";
    const status = meta?.status ?? "M";
    const additions = meta?.additions ?? 0;
    const deletions = meta?.deletions ?? 0;
    const summary = inferFileSummary(filePath, status, additions, deletions);
    const lineHint = extractLineHintFromDiff(diff);

    files.push({
      path: filePath,
      status,
      additions,
      deletions,
      lineHint,
      summary,
      diff: trimDiffForDisplay(diff),
    });
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

function buildCommitReviewSchema(commit: GitCommit, files: ChangedFile[]): WorkflowSchema {
  const baseNodes: WorkflowNode[] = [
    { id: "prompt", label: "User Prompt", x: 100, y: 80 },
    { id: "commit", label: `Commit ${commit.shortHash}`, x: 390, y: 80 },
    { id: "summary", label: "AI Summary", x: 680, y: 80 },
  ];

  const filesForDiagram = files.slice(0, 12);
  const fileNodes: WorkflowNode[] = filesForDiagram.map((file, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const shortLabel = file.path.split("/").slice(-2).join("/");
    return {
      id: `file-${index + 1}`,
      label: shortLabel,
      x: 100 + column * 250,
      y: 230 + row * 155,
    };
  });

  const nodes = [...baseNodes, ...fileNodes];

  const edges: WorkflowEdge[] = [
    { id: "e-prompt-commit", from: "prompt", to: "commit", label: "request context" },
    { id: "e-commit-summary", from: "commit", to: "summary", label: "review narrative" },
  ];

  const trace: WorkflowTraceStep[] = [];
  filesForDiagram.forEach((file, index) => {
    const fileNodeId = `file-${index + 1}`;
    const edgeToFileId = `e-commit-file-${index + 1}`;
    const edgeToSummaryId = `e-file-summary-${index + 1}`;

    edges.push({ id: edgeToFileId, from: "commit", to: fileNodeId, label: "changed file" });
    edges.push({ id: edgeToSummaryId, from: fileNodeId, to: "summary", label: "impact summary" });

    trace.push({
      id: `s${index + 1}`,
      title: `Review ${file.path}`,
      description: file.summary,
      focusNodeIds: ["commit", fileNodeId, "summary"],
      focusEdgeIds: [edgeToFileId, edgeToSummaryId],
      codeRef: {
        path: file.path,
        line: file.lineHint,
      },
    });
  });

  if (trace.length === 0) {
    trace.push({
      id: "s1",
      title: "No changed files found",
      description: "This commit has no file diffs to visualize.",
      focusNodeIds: ["commit", "summary"],
      focusEdgeIds: ["e-commit-summary"],
      codeRef: {
        path: "README.md",
        line: 1,
      },
    });
  }

  return {
    version: "0.1",
    diagram: {
      nodes,
      edges,
    },
    trace,
  };
}

interface WorkflowNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}

interface WorkflowTraceStep {
  id: string;
  title: string;
  description: string;
  focusNodeIds: string[];
  focusEdgeIds: string[];
  codeRef: {
    path: string;
    line: number;
  };
}

interface WorkflowSchema {
  version: string;
  diagram: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  };
  trace: WorkflowTraceStep[];
}

interface WorkflowStepSpec {
  id: string;
  title: string;
  description: string;
  focusNodeIds: string[];
  focusEdgeIds: string[];
  filePath: string;
  needle: string;
}

const AGENT_WORKFLOW_NODES: WorkflowNode[] = [
  { id: "assistant-response", label: "Assistant Response", x: 70, y: 80 },
  { id: "command-parser", label: "Command Parser", x: 320, y: 80 },
  { id: "approval-gate", label: "Approval Gate", x: 570, y: 80 },
  { id: "bridge-apply", label: "Bridge Apply", x: 820, y: 80 },
  { id: "redux-state", label: "Redux State", x: 1070, y: 80 },
  { id: "audit", label: "Audit Trail", x: 820, y: 280 },
  { id: "activity-sync", label: "Activity Sync", x: 1070, y: 280 },
  { id: "tauri-events", label: "Tauri Events", x: 1320, y: 180 },
];

const AGENT_WORKFLOW_EDGES: WorkflowEdge[] = [
  { id: "e1", from: "assistant-response", to: "command-parser", label: "chat/sendMessage result" },
  { id: "e2", from: "command-parser", to: "approval-gate", label: "extract + classify commands" },
  { id: "e3", from: "approval-gate", to: "bridge-apply", label: "approved command" },
  { id: "e4", from: "bridge-apply", to: "redux-state", label: "dispatch mutations" },
  { id: "e5", from: "redux-state", to: "audit", label: "user mutation actions" },
  { id: "e6", from: "redux-state", to: "activity-sync", label: "state snapshot" },
  { id: "e7", from: "bridge-apply", to: "tauri-events", label: "emit commands" },
  { id: "e8", from: "activity-sync", to: "tauri-events", label: "sync_agent_app_state" },
];

const AGENT_WORKFLOW_STEPS: WorkflowStepSpec[] = [
  {
    id: "s1",
    title: "Detect assistant response completion",
    description: "Agent app-control flow starts when chat send message thunk resolves.",
    focusNodeIds: ["assistant-response", "command-parser"],
    focusEdgeIds: ["e1"],
    filePath: "src/store/middleware/agentAppControlCommand.ts",
    needle: 'typedAction?.type === "chat/sendMessage/fulfilled"',
  },
  {
    id: "s2",
    title: "Extract commands from response payload",
    description: "Parser supports direct JSON, fenced blocks, and <app_control> tags.",
    focusNodeIds: ["command-parser"],
    focusEdgeIds: ["e2"],
    filePath: "src/store/middleware/agentAppControlCommand.ts",
    needle: "export function extractAgentAppCommands",
  },
  {
    id: "s3",
    title: "Enforce command approvals",
    description: "Unapproved command types are blocked and logged as system mutations.",
    focusNodeIds: ["approval-gate"],
    focusEdgeIds: ["e3"],
    filePath: "src/store/middleware/agentAppControlCommand.ts",
    needle: "if (!approvedCommandTypes.includes(command.type))",
  },
  {
    id: "s4",
    title: "Apply approved command through bridge",
    description: "Approved assistant commands are routed to the bridge executor.",
    focusNodeIds: ["approval-gate", "bridge-apply"],
    focusEdgeIds: ["e3"],
    filePath: "src/store/middleware/agentAppControlCommand.ts",
    needle: 'applyAgentAppCommand(store, command, "assistant");',
  },
  {
    id: "s5",
    title: "Bridge records command execution",
    description: "Bridge writes command execution history before applying side effects.",
    focusNodeIds: ["bridge-apply", "redux-state"],
    focusEdgeIds: ["e4"],
    filePath: "src/store/middleware/agentAppControlBridge.ts",
    needle: "dispatch(recordCommandExecution({ command, source }));",
  },
  {
    id: "s6",
    title: "Bridge emits AgentStudio actions",
    description: "Command switch can emit tauri events, open forms, or dispatch slice actions.",
    focusNodeIds: ["bridge-apply", "tauri-events"],
    focusEdgeIds: ["e7"],
    filePath: "src/store/middleware/agentAppControlBridge.ts",
    needle: 'void emit("agent-studio:navigate", { section: command.section });',
  },
  {
    id: "s7",
    title: "Audit middleware captures user mutations",
    description: "Manual mutations are tracked unless they were likely automation side effects.",
    focusNodeIds: ["redux-state", "audit"],
    focusEdgeIds: ["e5"],
    filePath: "src/store/middleware/agentAppControlAudit.ts",
    needle: "const USER_MUTATION_ACTIONS = new Set<string>([",
  },
  {
    id: "s8",
    title: "Activity middleware emits live snapshot",
    description: "Activity snapshot is emitted when app-control is enabled and state changed.",
    focusNodeIds: ["redux-state", "activity-sync"],
    focusEdgeIds: ["e6"],
    filePath: "src/store/middleware/agentAppControlActivity.ts",
    needle: "void emitAgentStudioActivity(snapshot);",
  },
  {
    id: "s9",
    title: "Activity middleware syncs backend state",
    description: "Serialized state payload is sent through sync_agent_app_state invoke.",
    focusNodeIds: ["activity-sync", "tauri-events"],
    focusEdgeIds: ["e8"],
    filePath: "src/store/middleware/agentAppControlActivity.ts",
    needle: 'void invoke("sync_agent_app_state", { state: statePayload }).catch((error) => {',
  },
  {
    id: "s10",
    title: "Command catalog defines allowed command surface",
    description: "Catalog enumerates all supported app-control commands exposed to approvals.",
    focusNodeIds: ["command-parser", "approval-gate"],
    focusEdgeIds: ["e2"],
    filePath: "src/store/middleware/agentAppControlCatalog.ts",
    needle: "export const AGENT_APP_CONTROL_COMMAND_SPECS",
  },
  {
    id: "s11",
    title: "Slice persists command and mutation history",
    description: "State slice stores recent activity, command history, and mutation records.",
    focusNodeIds: ["redux-state"],
    focusEdgeIds: [],
    filePath: "src/store/slices/agentAppControlSlice.ts",
    needle: "recordCommandExecution:",
  },
  {
    id: "s12",
    title: "Store wires app-control middleware chain",
    description: "Redux store configuration determines middleware order for the full workflow.",
    focusNodeIds: ["redux-state", "command-parser", "audit", "activity-sync"],
    focusEdgeIds: ["e2", "e5", "e6"],
    filePath: "src/store/index.ts",
    needle: "agentAppControlCommandMiddleware,",
  },
];

async function readWorkflowFileLines(
  repoRoot: string,
  relativePath: string,
): Promise<string[]> {
  const absolutePath = path.resolve(repoRoot, relativePath);
  if (!isPathInsideRoot(absolutePath, repoRoot)) {
    throw new Error(`Workflow file path escaped root: ${relativePath}`);
  }

  const fileStats = await stat(absolutePath);
  if (!fileStats.isFile()) {
    throw new Error(`Expected workflow file but found non-file: ${relativePath}`);
  }
  if (fileStats.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`Workflow file is too large: ${relativePath}`);
  }

  const content = await readFile(absolutePath, "utf8");
  return content.split(/\r?\n/);
}

async function buildAgentAppControlWorkflow(repoRoot: string): Promise<WorkflowSchema> {
  const cache = new Map<string, string[]>();

  const trace: WorkflowTraceStep[] = [];
  for (const spec of AGENT_WORKFLOW_STEPS) {
    let lines = cache.get(spec.filePath);
    if (lines === undefined) {
      lines = await readWorkflowFileLines(repoRoot, spec.filePath);
      cache.set(spec.filePath, lines);
    }

    const lineIndex = lines.findIndex((line) => line.includes(spec.needle));
    const lineNumber = lineIndex >= 0 ? lineIndex + 1 : 1;

    trace.push({
      id: spec.id,
      title: spec.title,
      description: spec.description,
      focusNodeIds: spec.focusNodeIds,
      focusEdgeIds: spec.focusEdgeIds,
      codeRef: {
        path: spec.filePath,
        line: lineNumber,
      },
    });
  }

  return {
    version: "0.1",
    diagram: {
      nodes: AGENT_WORKFLOW_NODES,
      edges: AGENT_WORKFLOW_EDGES,
    },
    trace,
  };
}

function createWorkflowMiddleware() {
  const projectRoot = path.resolve(process.cwd());

  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void,
  ): Promise<void> => {
    if (req.method !== "GET" || req.url === undefined) {
      next();
      return;
    }

    const requestUrl = new URL(req.url, "http://localhost");
    if (requestUrl.pathname !== "/api/workflow/agent-app-control") {
      next();
      return;
    }

    const rawRepoPath = requestUrl.searchParams.get("repoPath");
    if (rawRepoPath === null || rawRepoPath.trim().length === 0) {
      sendJson(res, 400, { error: "Missing required query param: repoPath" });
      return;
    }

    let repoRoot = projectRoot;
    try {
      repoRoot = await resolveBaseRoot(projectRoot, rawRepoPath);
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : "Invalid repository path.",
      });
      return;
    }

    try {
      const schema = await buildAgentAppControlWorkflow(repoRoot);
      sendJson(res, 200, {
        source: "clawdia-agent-app-control",
        repoRoot,
        schema,
      });
    } catch (error) {
      sendJson(res, 422, {
        error:
          error instanceof Error
            ? error.message
            : "Unable to generate workflow from repository.",
      });
    }
  };
}

function createReviewMiddleware() {
  const projectRoot = path.resolve(process.cwd());

  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void,
  ): Promise<void> => {
    if (req.method !== "GET" || req.url === undefined) {
      next();
      return;
    }

    const requestUrl = new URL(req.url, "http://localhost");
    const isCommitListRoute = requestUrl.pathname === "/api/review/commits";
    const isCommitReviewRoute = requestUrl.pathname === "/api/review/commit";

    if (!isCommitListRoute && !isCommitReviewRoute) {
      next();
      return;
    }

    const rawRepoPath = requestUrl.searchParams.get("repoPath");
    if (rawRepoPath === null || rawRepoPath.trim().length === 0) {
      sendJson(res, 400, { error: "Missing required query param: repoPath" });
      return;
    }

    let repoRoot = projectRoot;
    try {
      repoRoot = await resolveBaseRoot(projectRoot, rawRepoPath);
      await ensureGitRepository(repoRoot);
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : "Invalid repository path.",
      });
      return;
    }

    if (isCommitListRoute) {
      try {
        const limit = Math.min(100, parsePositiveInt(requestUrl.searchParams.get("limit"), 30));
        const commits = await listRepoCommits(repoRoot, limit);
        sendJson(res, 200, {
          repoRoot,
          commits: commits.map((commit) => ({
            hash: commit.hash,
            shortHash: commit.shortHash,
            subject: commit.subject,
            author: commit.author,
            date: commit.date,
            prompt: inferPromptFromCommit(commit.subject, commit.body),
          })),
        });
      } catch (error) {
        sendJson(res, 422, {
          error: error instanceof Error ? error.message : "Unable to list commits.",
        });
      }
      return;
    }

    const rawCommit = requestUrl.searchParams.get("commit");
    if (rawCommit === null || rawCommit.trim().length === 0) {
      sendJson(res, 400, { error: "Missing required query param: commit" });
      return;
    }

    let commitHash = "";
    try {
      commitHash = assertCommitHash(rawCommit);
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : "Invalid commit hash.",
      });
      return;
    }

    try {
      const commit = await readSingleCommit(repoRoot, commitHash);
      const files = await readChangedFiles(repoRoot, commitHash);
      const prompt = inferPromptFromCommit(commit.subject, commit.body);
      const overallSummary = inferOverallSummary(commit.subject, files);
      const schema = buildCommitReviewSchema(commit, files);

      sendJson(res, 200, {
        source: "git-commit-review",
        repoRoot,
        commit: {
          hash: commit.hash,
          shortHash: commit.shortHash,
          subject: commit.subject,
          author: commit.author,
          date: commit.date,
          prompt,
        },
        prompt,
        overallSummary,
        changedFiles: files,
        schema,
      });
    } catch (error) {
      sendJson(res, 422, {
        error: error instanceof Error ? error.message : "Unable to load commit review.",
      });
    }
  };
}

const sourcePreviewMiddleware = createSourcePreviewMiddleware();
const workflowMiddleware = createWorkflowMiddleware();
const reviewMiddleware = createReviewMiddleware();

export default defineConfig({
  plugins: [
    react(),
    {
      name: "workflow-source-api",
      configureServer(server) {
        server.middlewares.use(reviewMiddleware);
        server.middlewares.use(workflowMiddleware);
        server.middlewares.use(sourcePreviewMiddleware);
      },
      configurePreviewServer(server) {
        server.middlewares.use(reviewMiddleware);
        server.middlewares.use(workflowMiddleware);
        server.middlewares.use(sourcePreviewMiddleware);
      },
    },
  ],
});
