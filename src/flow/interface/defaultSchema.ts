import type { FlowSchema } from "./types";

export const DEFAULT_FLOW_SCHEMA: FlowSchema = {
  version: "0.1",
  diagram: {
    nodes: [
      { id: "upload", label: "Schema Upload", x: 70, y: 100 },
      { id: "app", label: "UI App Shell", x: 350, y: 100 },
      { id: "parser", label: "Schema Parser", x: 620, y: 100 },
      { id: "timeline", label: "Timeline Engine", x: 350, y: 280 },
    ],
    edges: [
      { id: "e1", from: "upload", to: "app", label: "raw JSON" },
      { id: "e2", from: "app", to: "parser", label: "validate" },
      { id: "e3", from: "parser", to: "app", label: "typed flow" },
      { id: "e4", from: "app", to: "timeline", label: "advance step" },
    ],
  },
  trace: [
    {
      id: "s1",
      title: "Read schema input",
      description: "Reads user-provided JSON from upload and starts validation flow.",
      focusNodeIds: ["upload", "app"],
      focusEdgeIds: ["e1"],
      codeRef: { path: "src/App.tsx", line: 58 },
    },
    {
      id: "s2",
      title: "Validate structure",
      description: "Parses and validates schema shape plus domain invariants.",
      focusNodeIds: ["app", "parser"],
      focusEdgeIds: ["e2"],
      codeRef: { path: "src/flow/interface/parserGateway.ts", line: 33 },
    },
    {
      id: "s3",
      title: "Render first frame",
      description: "Draws diagram nodes and edges and highlights focus targets.",
      focusNodeIds: ["app", "parser"],
      focusEdgeIds: ["e3"],
      codeRef: { path: "src/flow/interface/components/DiagramCanvas.tsx", line: 27 },
    },
    {
      id: "s4",
      title: "Playback timeline",
      description: "Advances current step index and drives step-focused UI state.",
      focusNodeIds: ["app", "timeline"],
      focusEdgeIds: ["e4"],
      codeRef: { path: "src/flow/interface/hooks/useTimeline.ts", line: 31 },
    },
  ],
};
