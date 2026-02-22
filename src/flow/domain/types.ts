export interface CodeReference {
  readonly path: string;
  readonly line: number;
}

export interface DiagramNode {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

export interface DiagramEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

export interface TraceStep {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly focusNodeIds: readonly string[];
  readonly focusEdgeIds: readonly string[];
  readonly codeRef: CodeReference;
}

export interface FlowDiagram {
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
}

export interface FlowDocument {
  readonly version: string;
  readonly diagram: FlowDiagram;
  readonly trace: readonly TraceStep[];
}
