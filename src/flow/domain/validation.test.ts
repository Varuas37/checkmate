import { describe, expect, it } from "vitest";

import type { FlowDocument } from "./types";
import { validateFlowDocumentInvariants } from "./validation";

function createValidFlowDocument(): FlowDocument {
  return {
    version: "0.1",
    diagram: {
      nodes: [
        { id: "api", label: "API", x: 100, y: 100 },
        { id: "worker", label: "Worker", x: 320, y: 100 },
      ],
      edges: [{ id: "e1", from: "api", to: "worker", label: "enqueue" }],
    },
    trace: [
      {
        id: "s1",
        title: "request",
        focusNodeIds: ["api"],
        focusEdgeIds: [],
        codeRef: { path: "src/api.ts", line: 10 },
      },
      {
        id: "s2",
        title: "queued",
        focusNodeIds: ["api", "worker"],
        focusEdgeIds: ["e1"],
        codeRef: { path: "src/queue.ts", line: 21 },
      },
    ],
  };
}

describe("validateFlowDocumentInvariants", () => {
  it("returns no issues for a valid document", () => {
    const issues = validateFlowDocumentInvariants(createValidFlowDocument());
    expect(issues).toHaveLength(0);
  });

  it("returns duplicate id issues", () => {
    const base = createValidFlowDocument();
    const document: FlowDocument = {
      ...base,
      diagram: {
        ...base.diagram,
        nodes: [...base.diagram.nodes, { id: "api", label: "API copy", x: 500, y: 100 }],
      },
    };

    const issues = validateFlowDocumentInvariants(document);
    expect(issues.some((issue) => issue.code === "duplicate-node-id")).toBe(true);
  });

  it("returns missing trace reference issues", () => {
    const base = createValidFlowDocument();
    const firstStep = base.trace[0];

    if (firstStep === undefined) {
      throw new Error("Expected test fixture trace to contain at least one step.");
    }

    const document: FlowDocument = {
      ...base,
      trace: [
        {
          ...firstStep,
          focusNodeIds: ["missing-node"],
          focusEdgeIds: ["missing-edge"],
        },
      ],
    };

    const issues = validateFlowDocumentInvariants(document);
    expect(issues.some((issue) => issue.code === "missing-trace-node-reference")).toBe(true);
    expect(issues.some((issue) => issue.code === "missing-trace-edge-reference")).toBe(true);
  });
});
