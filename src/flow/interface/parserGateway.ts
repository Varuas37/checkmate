import type { FlowDocument } from "../domain";
import { safeParseFlowDocument } from "../infrastructure";
import type { FlowParseIssue } from "../infrastructure";
import type {
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
