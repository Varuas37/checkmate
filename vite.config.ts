import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const DEFAULT_CONTEXT_LINES = 8;
const MAX_CONTEXT_LINES = 30;
const MAX_FILE_SIZE_BYTES = 1_000_000;

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
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

const sourcePreviewMiddleware = createSourcePreviewMiddleware();
const workflowMiddleware = createWorkflowMiddleware();

export default defineConfig({
  plugins: [
    react(),
    {
      name: "workflow-source-api",
      configureServer(server) {
        server.middlewares.use(workflowMiddleware);
        server.middlewares.use(sourcePreviewMiddleware);
      },
      configurePreviewServer(server) {
        server.middlewares.use(workflowMiddleware);
        server.middlewares.use(sourcePreviewMiddleware);
      },
    },
  ],
});
