import { useMemo } from "react";

import type { FlowDiagram, FlowDiagramNode } from "../types";

const DEFAULT_NODE_WIDTH = 170;
const DEFAULT_NODE_HEIGHT = 80;
const VIEWBOX_PADDING = 90;

interface DiagramCanvasProps {
  diagram: FlowDiagram;
  focusedNodeIds: ReadonlySet<string>;
  focusedEdgeIds: ReadonlySet<string>;
}

interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

interface ViewBoxBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export function DiagramCanvas(props: DiagramCanvasProps): JSX.Element {
  const { diagram, focusedNodeIds, focusedEdgeIds } = props;

  const nodeById = useMemo(() => {
    return new Map(diagram.nodes.map((node) => [node.id, node]));
  }, [diagram.nodes]);

  const viewBox = useMemo(() => {
    if (diagram.nodes.length === 0) {
      return {
        minX: 0,
        minY: 0,
        width: 1000,
        height: 600,
      } satisfies ViewBoxBounds;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    diagram.nodes.forEach((node) => {
      const size = getNodeSize();
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + size.width);
      maxY = Math.max(maxY, node.y + size.height);
    });

    return {
      minX: minX - VIEWBOX_PADDING,
      minY: minY - VIEWBOX_PADDING,
      width: maxX - minX + VIEWBOX_PADDING * 2,
      height: maxY - minY + VIEWBOX_PADDING * 2,
    } satisfies ViewBoxBounds;
  }, [diagram.nodes]);

  return (
    <div className="diagram-wrapper">
      {diagram.nodes.length === 0 ? (
        <div className="empty-diagram">Upload a valid schema to render the diagram.</div>
      ) : (
        <svg
          className="diagram-svg"
          viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
          role="img"
          aria-label="Flow diagram canvas"
        >
          <defs>
            <marker id="arrow-default" markerWidth="10" markerHeight="7" refX="8.5" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" className="diagram-arrow-default" />
            </marker>
            <marker id="arrow-focused" markerWidth="10" markerHeight="7" refX="8.5" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" className="diagram-arrow-focused" />
            </marker>
          </defs>

          <g>
            {diagram.edges.map((edge) => {
              const fromNode = nodeById.get(edge.from);
              const toNode = nodeById.get(edge.to);
              if (fromNode === undefined || toNode === undefined) {
                return null;
              }

              const fromAnchor = getNodeAnchor(fromNode, toNode);
              const toAnchor = getNodeAnchor(toNode, fromNode);
              const labelPosition = getLabelPosition(fromAnchor, toAnchor);
              const isFocused = focusedEdgeIds.has(edge.id);

              return (
                <g key={edge.id}>
                  <line
                    x1={fromAnchor.x}
                    y1={fromAnchor.y}
                    x2={toAnchor.x}
                    y2={toAnchor.y}
                    className={`diagram-edge ${isFocused ? "diagram-edge--focused" : ""}`}
                    markerEnd={isFocused ? "url(#arrow-focused)" : "url(#arrow-default)"}
                  />
                  {edge.label !== undefined && edge.label.length > 0 ? (
                    <text
                      x={labelPosition.x}
                      y={labelPosition.y}
                      textAnchor="middle"
                      className={`diagram-edge-label ${isFocused ? "diagram-edge-label--focused" : ""}`}
                    >
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>

          <g>
            {diagram.nodes.map((node) => {
              const size = getNodeSize();
              const isFocused = focusedNodeIds.has(node.id);

              return (
                <g
                  key={node.id}
                  className={`diagram-node ${isFocused ? "diagram-node--focused" : ""}`}
                  transform={`translate(${node.x} ${node.y})`}
                >
                  <rect width={size.width} height={size.height} rx={14} ry={14} />
                  <text x={size.width / 2} y={size.height / 2 - 2} textAnchor="middle">
                    {node.label}
                  </text>
                  <text x={size.width / 2} y={size.height / 2 + 18} textAnchor="middle" className="diagram-node-id">
                    {node.id}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
}

function getNodeSize(): Size {
  return {
    width: DEFAULT_NODE_WIDTH,
    height: DEFAULT_NODE_HEIGHT,
  };
}

function getNodeCenter(node: FlowDiagramNode): Point {
  const size = getNodeSize();
  return {
    x: node.x + size.width / 2,
    y: node.y + size.height / 2,
  };
}

function getNodeAnchor(source: FlowDiagramNode, target: FlowDiagramNode): Point {
  const sourceCenter = getNodeCenter(source);
  const targetCenter = getNodeCenter(target);
  const sourceSize = getNodeSize();
  const deltaX = targetCenter.x - sourceCenter.x;
  const deltaY = targetCenter.y - sourceCenter.y;

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return {
      x: sourceCenter.x + Math.sign(deltaX || 1) * (sourceSize.width / 2),
      y: sourceCenter.y,
    };
  }

  return {
    x: sourceCenter.x,
    y: sourceCenter.y + Math.sign(deltaY || 1) * (sourceSize.height / 2),
  };
}

function getLabelPosition(from: Point, to: Point): Point {
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2 - 10,
  };
}
