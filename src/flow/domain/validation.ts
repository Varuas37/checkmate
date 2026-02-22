import type { FlowDocument } from "./types";

export type FlowValidationIssueCode =
  | "duplicate-node-id"
  | "duplicate-edge-id"
  | "duplicate-trace-step-id"
  | "missing-trace-node-reference"
  | "missing-trace-edge-reference";

export interface FlowValidationIssue {
  readonly code: FlowValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export class FlowValidationError extends Error {
  readonly issues: readonly FlowValidationIssue[];

  constructor(issues: readonly FlowValidationIssue[]) {
    super("Flow document violates domain invariants.");
    this.name = "FlowValidationError";
    this.issues = issues;
  }
}

function duplicateIdIssues(
  values: readonly { readonly id: string }[],
  listPath: string,
  code: Extract<
    FlowValidationIssueCode,
    "duplicate-node-id" | "duplicate-edge-id" | "duplicate-trace-step-id"
  >,
  entityLabel: string,
): FlowValidationIssue[] {
  const indexesById = new Map<string, number[]>();

  values.forEach((value, index) => {
    const indexes = indexesById.get(value.id);

    if (indexes) {
      indexes.push(index);
      return;
    }

    indexesById.set(value.id, [index]);
  });

  const issues: FlowValidationIssue[] = [];

  indexesById.forEach((indexes, id) => {
    if (indexes.length < 2) {
      return;
    }

    const locations = indexes.map((index) => `${listPath}[${index}]`).join(", ");
    const message = `Duplicate ${entityLabel} id "${id}" found at ${locations}.`;

    indexes.forEach((index) => {
      issues.push({
        code,
        path: `${listPath}[${index}].id`,
        message,
      });
    });
  });

  return issues;
}

function missingTraceReferenceIssues(document: FlowDocument): FlowValidationIssue[] {
  const nodeIds = new Set(document.diagram.nodes.map((node) => node.id));
  const edgeIds = new Set(document.diagram.edges.map((edge) => edge.id));
  const issues: FlowValidationIssue[] = [];

  document.trace.forEach((step, stepIndex) => {
    step.focusNodeIds.forEach((nodeId, nodeRefIndex) => {
      if (nodeIds.has(nodeId)) {
        return;
      }

      issues.push({
        code: "missing-trace-node-reference",
        path: `trace[${stepIndex}].focusNodeIds[${nodeRefIndex}]`,
        message: `Trace step "${step.id}" references missing node id "${nodeId}".`,
      });
    });

    step.focusEdgeIds.forEach((edgeId, edgeRefIndex) => {
      if (edgeIds.has(edgeId)) {
        return;
      }

      issues.push({
        code: "missing-trace-edge-reference",
        path: `trace[${stepIndex}].focusEdgeIds[${edgeRefIndex}]`,
        message: `Trace step "${step.id}" references missing edge id "${edgeId}".`,
      });
    });
  });

  return issues;
}

export function validateFlowDocumentInvariants(document: FlowDocument): readonly FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];

  issues.push(
    ...duplicateIdIssues(document.diagram.nodes, "diagram.nodes", "duplicate-node-id", "node"),
  );
  issues.push(
    ...duplicateIdIssues(document.diagram.edges, "diagram.edges", "duplicate-edge-id", "edge"),
  );
  issues.push(...duplicateIdIssues(document.trace, "trace", "duplicate-trace-step-id", "trace step"));
  issues.push(...missingTraceReferenceIssues(document));

  return issues;
}

export function assertFlowDocumentInvariants(document: FlowDocument): void {
  const issues = validateFlowDocumentInvariants(document);

  if (issues.length > 0) {
    throw new FlowValidationError(issues);
  }
}
