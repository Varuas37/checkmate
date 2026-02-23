import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import Skeleton from "react-loading-skeleton";
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../design-system/index.ts";
import { cn } from "../../../shared/index.ts";

import type { CodeSequenceStep } from "../types.ts";

export interface CodeSequenceDiagramPanelProps {
  readonly steps: readonly CodeSequenceStep[];
  readonly sequenceGenerationStatus: "idle" | "generating" | "ready" | "error";
  readonly sequenceGenerationError: string | null;
  readonly onRetrySequenceGeneration: () => void;
  readonly highlightedFileIds: readonly string[];
  readonly onSelectFiles: (fileIds: readonly string[]) => void;
  readonly mode?: "compact" | "expanded";
  readonly onExpand?: () => void;
  readonly onCloseExpanded?: () => void;
  readonly onOpenExpandedFiles?: (fileIds: readonly string[]) => void;
  readonly expandedSidePanel?: ReactNode;
}

const MIN_ZOOM_LEVEL = 0.5;
const MAX_ZOOM_LEVEL = 4;
const ZOOM_STEP = 0.2;
const DEFAULT_LEFT_PANE_PERCENT = 58;
const MIN_LEFT_PANE_PERCENT = 28;
const MAX_LEFT_PANE_PERCENT = 78;

const MIN_SVG_WIDTH = 860;
const LANE_GAP = 165;
const LANE_START_X = 72;
const LANE_END_PADDING = 72;
const ACTOR_BOX_WIDTH = 132;
const ACTOR_BOX_HEIGHT = 30;
const TOP_BOX_Y = 24;
const ROW_START_Y = TOP_BOX_Y + ACTOR_BOX_HEIGHT + 56;
const ROW_GAP = 52;

interface DiagramStep {
  readonly id: string;
  readonly token: string;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly targetId: string;
  readonly targetLabel: string;
  readonly message: string;
  readonly fileIds: readonly string[];
}

interface SequenceParticipant {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly fileIds: readonly string[];
}

interface SequenceInteraction {
  readonly id: string;
  readonly token: string;
  readonly message: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly y: number;
  readonly fileIds: readonly string[];
}

interface SequenceLayout {
  readonly participants: readonly SequenceParticipant[];
  readonly interactions: readonly SequenceInteraction[];
  readonly width: number;
  readonly height: number;
  readonly laneTopY: number;
  readonly laneBottomY: number;
  readonly topBoxY: number;
  readonly bottomBoxY: number;
}

function clampZoom(value: number): number {
  if (value < MIN_ZOOM_LEVEL) {
    return MIN_ZOOM_LEVEL;
  }

  if (value > MAX_ZOOM_LEVEL) {
    return MAX_ZOOM_LEVEL;
  }

  return value;
}

function clampLeftPanePercent(value: number): number {
  if (value < MIN_LEFT_PANE_PERCENT) {
    return MIN_LEFT_PANE_PERCENT;
  }

  if (value > MAX_LEFT_PANE_PERCENT) {
    return MAX_LEFT_PANE_PERCENT;
  }

  return value;
}

function normalizeWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function normalizeId(value: string, fallback: string): string {
  const normalized = normalizeWhitespace(value)
    .replaceAll(/[^A-Za-z0-9_-]/g, "_")
    .replaceAll(/_+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 48) : fallback;
}

function sanitizeLabel(value: string, fallback: string): string {
  const normalized = normalizeWhitespace(value).replaceAll(/["`\\<>]/g, "");
  return normalized.length > 0 ? normalized.slice(0, 28) : fallback;
}

function sanitizeMessage(value: string, fallback: string): string {
  const normalized = normalizeWhitespace(value)
    .replaceAll(/["`\\<>]/g, "")
    .replaceAll(/[{}[\]]/g, " ");
  return normalized.length > 0 ? normalized.slice(0, 88) : fallback;
}

function sanitizeToken(value: string, index: number): string {
  const normalized = normalizeWhitespace(value).replaceAll(/[^A-Za-z0-9_-]/g, "");
  return normalized.length > 0 ? normalized.slice(0, 12) : `S${index + 1}`;
}

function trimLabel(value: string, max = 20): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, Math.max(1, max - 1))}\u2026`;
}

function buildSequenceLayout(steps: readonly DiagramStep[]): SequenceLayout {
  const participantOrder: string[] = [];
  const labelById = new Map<string, string>();
  const fileIdsByParticipant = new Map<string, Set<string>>();

  steps.forEach((step) => {
    const nodes = [
      { id: step.sourceId, label: step.sourceLabel },
      { id: step.targetId, label: step.targetLabel },
    ];

    nodes.forEach((node) => {
      if (!labelById.has(node.id)) {
        participantOrder.push(node.id);
      }
      labelById.set(node.id, node.label);
      if (!fileIdsByParticipant.has(node.id)) {
        fileIdsByParticipant.set(node.id, new Set<string>());
      }
      step.fileIds.forEach((fileId) => {
        fileIdsByParticipant.get(node.id)?.add(fileId);
      });
    });
  });

  const participants: SequenceParticipant[] = participantOrder.map((participantId, index) => ({
    id: participantId,
    label: labelById.get(participantId) ?? "Component",
    x: LANE_START_X + index * LANE_GAP,
    fileIds: [...(fileIdsByParticipant.get(participantId) ?? new Set<string>())],
  }));

  const interactions: SequenceInteraction[] = steps.map((step, index) => ({
    id: step.id,
    token: step.token,
    message: step.message,
    sourceId: step.sourceId,
    targetId: step.targetId,
    y: ROW_START_Y + index * ROW_GAP,
    fileIds: step.fileIds,
  }));

  const furthestLaneX =
    participants.length > 0
      ? participants[participants.length - 1]?.x ?? LANE_START_X
      : LANE_START_X;
  const width = Math.max(MIN_SVG_WIDTH, furthestLaneX + LANE_END_PADDING);

  const laneTopY = TOP_BOX_Y + ACTOR_BOX_HEIGHT + 10;
  const lastInteractionY =
    interactions.length > 0
      ? interactions[interactions.length - 1]?.y ?? ROW_START_Y
      : ROW_START_Y;
  const bottomBoxY = lastInteractionY + 28;
  const laneBottomY = bottomBoxY - 8;
  const height = Math.max(360, bottomBoxY + ACTOR_BOX_HEIGHT + 24);

  return {
    participants,
    interactions,
    width,
    height,
    laneTopY,
    laneBottomY,
    topBoxY: TOP_BOX_Y,
    bottomBoxY,
  };
}

export function CodeSequenceDiagramPanel({
  steps,
  sequenceGenerationStatus,
  sequenceGenerationError,
  onRetrySequenceGeneration,
  highlightedFileIds,
  onSelectFiles,
  mode = "compact",
  onExpand,
  onCloseExpanded,
  onOpenExpandedFiles,
  expandedSidePanel,
}: CodeSequenceDiagramPanelProps) {
  const isExpandedMode = mode === "expanded";
  const isSequenceGenerating = sequenceGenerationStatus === "generating";
  const [zoomPercent, setZoomPercent] = useState(100);
  const [leftPanePercent, setLeftPanePercent] = useState(DEFAULT_LEFT_PANE_PERCENT);
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const expandedSplitContainerRef = useRef<HTMLDivElement | null>(null);
  const expandedViewportRef = useRef<HTMLDivElement | null>(null);
  const resizePointerIdRef = useRef<number | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);

  const highlightedSet = useMemo(() => new Set(highlightedFileIds), [highlightedFileIds]);

  const diagramSteps = useMemo<readonly DiagramStep[]>(
    () =>
      steps.map((step, index) => {
        const sourceLabel = sanitizeLabel(step.sourceLabel, "Source");
        const targetLabel = sanitizeLabel(step.targetLabel, "Target");
        return {
          id: step.id,
          token: sanitizeToken(step.token, index),
          sourceId: normalizeId(step.sourceId, normalizeId(sourceLabel.toLowerCase(), `source_${index + 1}`)),
          sourceLabel,
          targetId: normalizeId(step.targetId, normalizeId(targetLabel.toLowerCase(), `target_${index + 1}`)),
          targetLabel,
          message: sanitizeMessage(step.message, `UPDATED ${index + 1}`),
          fileIds: [...step.fileIds],
        };
      }),
    [steps],
  );

  const layout = useMemo(() => buildSequenceLayout(diagramSteps), [diagramSteps]);

  useEffect(() => {
    if (!isExpandedMode) {
      return;
    }

    setLeftPanePercent(DEFAULT_LEFT_PANE_PERCENT);
    setIsResizingSplit(false);
    resizePointerIdRef.current = null;
  }, [isExpandedMode]);

  useEffect(() => {
    if (!isResizingSplit) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizingSplit]);

  useEffect(() => {
    if (!isExpandedMode || !onCloseExpanded) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseExpanded();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isExpandedMode, onCloseExpanded]);

  const applySelection = useCallback(
    (fileIds: readonly string[], expandedSurface: boolean) => {
      if (fileIds.length === 0) {
        return;
      }

      onSelectFiles(fileIds);
      if (expandedSurface) {
        onOpenExpandedFiles?.(fileIds);
      }
    },
    [onOpenExpandedFiles, onSelectFiles],
  );

  const updateSplitFromClientX = useCallback((clientX: number) => {
    const container = expandedSplitContainerRef.current;
    if (!container) {
      return;
    }

    const bounds = container.getBoundingClientRect();
    if (bounds.width <= 0) {
      return;
    }

    const percent = ((clientX - bounds.left) / bounds.width) * 100;
    setLeftPanePercent(clampLeftPanePercent(percent));
  }, []);

  const handleSplitPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    resizePointerIdRef.current = event.pointerId;
    setIsResizingSplit(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateSplitFromClientX(event.clientX);
    event.preventDefault();
  };

  const handleSplitPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isResizingSplit || resizePointerIdRef.current !== event.pointerId) {
      return;
    }

    updateSplitFromClientX(event.clientX);
  };

  const handleSplitPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizePointerIdRef.current !== event.pointerId) {
      return;
    }

    setIsResizingSplit(false);
    resizePointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleSplitKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setLeftPanePercent((current) => clampLeftPanePercent(current - 2));
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      setLeftPanePercent((current) => clampLeftPanePercent(current + 2));
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setLeftPanePercent(MIN_LEFT_PANE_PERCENT);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setLeftPanePercent(MAX_LEFT_PANE_PERCENT);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      setLeftPanePercent(DEFAULT_LEFT_PANE_PERCENT);
    }
  };

  const fitExpandedView = useCallback(() => {
    const transformApi = transformRef.current;
    const viewport = expandedViewportRef.current;

    if (!transformApi || !viewport) {
      return;
    }

    const bounds = viewport.getBoundingClientRect();
    const availableWidth = Math.max(0, bounds.width - 30);
    const availableHeight = Math.max(0, bounds.height - 30);
    const nextScale = clampZoom(
      Math.min(
        availableWidth / Math.max(layout.width, 1),
        availableHeight / Math.max(layout.height, 1),
      ),
    );

    const nextX = (bounds.width - layout.width * nextScale) / 2;
    const nextY = (bounds.height - layout.height * nextScale) / 2;
    transformApi.setTransform(nextX, nextY, nextScale, 180, "easeOut");
    setZoomPercent(Math.round(nextScale * 100));
  }, [layout.height, layout.width]);

  useEffect(() => {
    if (!isExpandedMode) {
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitExpandedView();
      });
    });
  }, [fitExpandedView, isExpandedMode, layout.height, layout.width]);

  const renderSequenceSvg = (expandedSurface: boolean) => {
    const participantsById = new Map(layout.participants.map((participant) => [participant.id, participant] as const));

    const drawArrowHead = (x: number, y: number, pointingRight: boolean) => {
      const offset = pointingRight ? -8 : 8;
      const points = pointingRight
        ? `${x},${y} ${x + offset},${y - 4.8} ${x + offset},${y + 4.8}`
        : `${x},${y} ${x + offset},${y - 4.8} ${x + offset},${y + 4.8}`;
      return points;
    };

    return (
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="h-auto w-full text-text"
      >
        {layout.participants.map((participant) => {
          const isHighlighted = participant.fileIds.some((fileId) => highlightedSet.has(fileId));
          return (
            <g key={`lane-${participant.id}`}>
              <line
                x1={participant.x}
                y1={layout.laneTopY}
                x2={participant.x}
                y2={layout.laneBottomY}
                stroke={isHighlighted ? "hsl(var(--color-accent))" : "hsl(var(--color-border))"}
                strokeDasharray="3 5"
                strokeWidth={isHighlighted ? 1.5 : 1}
              />

              {[layout.topBoxY, layout.bottomBoxY].map((boxY, index) => (
                <g
                  key={`${participant.id}-box-${index}`}
                  className={participant.fileIds.length > 0 ? "cursor-pointer" : ""}
                  onClick={() => applySelection(participant.fileIds, expandedSurface)}
                >
                  <rect
                    x={participant.x - ACTOR_BOX_WIDTH / 2}
                    y={boxY}
                    rx={6}
                    ry={6}
                    width={ACTOR_BOX_WIDTH}
                    height={ACTOR_BOX_HEIGHT}
                    fill={isHighlighted ? "hsl(var(--color-accent) / 0.14)" : "hsl(var(--color-canvas) / 0.92)"}
                    stroke={isHighlighted ? "hsl(var(--color-accent) / 0.7)" : "hsl(var(--color-border) / 0.85)"}
                  />
                  <text
                    x={participant.x}
                    y={boxY + ACTOR_BOX_HEIGHT / 2 + 4}
                    textAnchor="middle"
                    fontSize="11"
                    fill={isHighlighted ? "hsl(var(--color-accent))" : "hsl(var(--color-text))"}
                  >
                    {trimLabel(participant.label)}
                  </text>
                </g>
              ))}
            </g>
          );
        })}

        {layout.interactions.map((interaction) => {
          const source = participantsById.get(interaction.sourceId);
          const target = participantsById.get(interaction.targetId);
          if (!source || !target) {
            return null;
          }

          const highlighted = interaction.fileIds.some((fileId) => highlightedSet.has(fileId));
          const strokeColor = highlighted ? "hsl(var(--color-accent))" : "hsl(var(--color-text-subtle))";
          const tone = highlighted ? "hsl(var(--color-accent))" : "hsl(var(--color-text-subtle))";
          const startX = source.x;
          const endX = target.x;
          const y = interaction.y;
          const isSelf = source.id === target.id;

          if (isSelf) {
            const loopWidth = 38;
            const loopHeight = 22;
            const loopPath = `M ${startX} ${y} C ${startX + loopWidth} ${y}, ${startX + loopWidth} ${y + loopHeight}, ${startX} ${y + loopHeight}`;
            return (
              <g key={interaction.id}>
                <path d={loopPath} fill="none" stroke={strokeColor} strokeWidth={highlighted ? 2 : 1.35} />
                <polygon
                  points={`${startX},${y + loopHeight} ${startX + 9},${y + loopHeight - 4.8} ${startX + 9},${y + loopHeight + 4.8}`}
                  fill={tone}
                />
                <rect
                  x={startX - 6}
                  y={y - 12}
                  width={loopWidth + 12}
                  height={loopHeight + 24}
                  fill="transparent"
                  className={interaction.fileIds.length > 0 ? "cursor-pointer" : ""}
                  onClick={() => applySelection(interaction.fileIds, expandedSurface)}
                />
                <text x={startX + 22} y={y - 7} fontSize="10.5" textAnchor="middle" fill={tone}>
                  {interaction.token} {trimLabel(interaction.message, 46)}
                </text>
              </g>
            );
          }

          const directionRight = endX > startX;
          const hitboxX = Math.min(startX, endX);
          const hitboxWidth = Math.max(24, Math.abs(endX - startX));
          const centerX = (startX + endX) / 2;

          return (
            <g key={interaction.id}>
              <line x1={startX} y1={y} x2={endX} y2={y} stroke={strokeColor} strokeWidth={highlighted ? 2 : 1.35} />
              <polygon points={drawArrowHead(endX, y, directionRight)} fill={tone} />
              <rect
                x={hitboxX}
                y={y - 12}
                width={hitboxWidth}
                height={24}
                fill="transparent"
                className={interaction.fileIds.length > 0 ? "cursor-pointer" : ""}
                onClick={() => applySelection(interaction.fileIds, expandedSurface)}
              />
              <text x={centerX} y={y - 7} fontSize="10.5" textAnchor="middle" fill={tone}>
                {interaction.token} {trimLabel(interaction.message, 64)}
              </text>
            </g>
          );
        })}
      </svg>
    );
  };

  const combinedSequenceError = sequenceGenerationError;

  if (!isExpandedMode) {
    return (
      <Card className="h-full border-border/40 bg-transparent shadow-none">
        <CardHeader className="flex items-start justify-between gap-3 border-border/40 bg-transparent px-3 py-2">
          <div>
            <CardTitle>Code Sequence</CardTitle>
            <CardDescription>Native sequence renderer. Click actors/steps to focus files.</CardDescription>
          </div>
          <Button variant="secondary" size="sm" onClick={onExpand} disabled={steps.length === 0 || !onExpand}>
            Expand
          </Button>
        </CardHeader>
        <CardBody className="space-y-2 px-3 pb-2 pt-2">
          {isSequenceGenerating && (
            <div className="space-y-2">
              <Skeleton height={12} width="64%" />
              <Skeleton height={10} count={2} />
            </div>
          )}

          {steps.length === 0 && !isSequenceGenerating && (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
              Sequence diagram appears after changed files are loaded.
            </p>
          )}

          {steps.length > 0 && (
            <>
              <div className="rounded-md border border-border bg-elevated/25 p-2">
                <div className="max-h-[18rem] overflow-auto">{renderSequenceSvg(false)}</div>
              </div>
              <div className="overflow-hidden rounded-md border border-border bg-surface">
                <div className="max-h-48 divide-y divide-border/60 overflow-y-auto">
                  {diagramSteps.map((step) => {
                    const isHighlighted = step.fileIds.some((fileId) => highlightedSet.has(fileId));

                    return (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => applySelection(step.fileIds, false)}
                        className={cn(
                          "flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors",
                          "hover:bg-elevated",
                          isHighlighted && "bg-caution/10",
                        )}
                      >
                        <Badge tone="accent" className="shrink-0">
                          {step.token}
                        </Badge>
                        <p className="min-w-0 whitespace-normal break-words text-xs text-muted">
                          {step.sourceLabel} to {step.targetLabel}
                        </p>
                        <p className="min-w-0 flex-1 whitespace-normal break-all font-mono text-xs text-text">
                          {step.message}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {combinedSequenceError && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-danger">{combinedSequenceError}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={onRetrySequenceGeneration}
                disabled={isSequenceGenerating}
                className="h-7 px-2"
              >
                {isSequenceGenerating ? "Retrying..." : "Retry"}
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-3 py-2">
        <div>
          <p className="text-sm font-semibold text-text">Code Sequence (Expanded)</p>
          <p className="text-xs text-muted">Drag to pan, zoom for details, and click actors/steps to focus files.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="rounded-md border border-border bg-elevated/45 px-2 py-1 font-mono text-[11px] text-muted">
            {zoomPercent}%
          </p>
          {onCloseExpanded && (
            <Button variant="secondary" size="sm" onClick={onCloseExpanded}>
              Close
            </Button>
          )}
        </div>
      </div>

      <div
        ref={expandedSplitContainerRef}
        className="grid min-h-0 flex-1 gap-2 p-3"
        style={{
          gridTemplateColumns: `minmax(0, ${leftPanePercent}%) 0.625rem minmax(0, ${100 - leftPanePercent}%)`,
        }}
      >
        <div className="relative min-h-0 rounded-md border border-border/60 bg-elevated/30">
          <Button
            variant="secondary"
            size="sm"
            onClick={fitExpandedView}
            className="absolute right-2 top-2 z-20 h-8 w-8 px-0"
            title="Re-center"
            aria-label="Re-center sequence diagram"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="10" cy="10" r="5.25" />
              <path d="M10 2.4v2.2" />
              <path d="M10 15.4v2.2" />
              <path d="M2.4 10h2.2" />
              <path d="M15.4 10h2.2" />
            </svg>
          </Button>
          <div ref={expandedViewportRef} className="h-full min-h-[26rem] overflow-hidden rounded-md">
            <TransformWrapper
              ref={transformRef}
              minScale={MIN_ZOOM_LEVEL}
              maxScale={MAX_ZOOM_LEVEL}
              wheel={{ step: ZOOM_STEP }}
              doubleClick={{ disabled: true }}
              limitToBounds={false}
              panning={{ excluded: ["button", "input", "textarea"] }}
              onInit={(ref) => {
                transformRef.current = ref;
                setZoomPercent(Math.round(ref.state.scale * 100));
              }}
              onTransformed={(_, state) => {
                setZoomPercent(Math.round(state.scale * 100));
              }}
            >
              <TransformComponent
                wrapperStyle={{ width: "100%", height: "100%" }}
                contentStyle={{ width: `${layout.width}px`, height: `${layout.height}px` }}
              >
                {renderSequenceSvg(true)}
              </TransformComponent>
            </TransformWrapper>
          </div>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize diagram and file panels"
          aria-valuemin={MIN_LEFT_PANE_PERCENT}
          aria-valuemax={MAX_LEFT_PANE_PERCENT}
          aria-valuenow={Math.round(leftPanePercent)}
          tabIndex={0}
          className={cn(
            "group relative my-1 rounded-sm transition-colors",
            "cursor-col-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
            isResizingSplit ? "bg-accent/20" : "bg-transparent hover:bg-elevated/55",
          )}
          onPointerDown={handleSplitPointerDown}
          onPointerMove={handleSplitPointerMove}
          onPointerUp={handleSplitPointerEnd}
          onPointerCancel={handleSplitPointerEnd}
          onDoubleClick={() => setLeftPanePercent(DEFAULT_LEFT_PANE_PERCENT)}
          onKeyDown={handleSplitKeyDown}
          title="Drag to resize panels (double-click to reset)"
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/75 group-hover:bg-accent/70" />
          <div className="absolute left-1/2 top-1/2 h-8 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/70 bg-canvas/90" />
        </div>

        <aside className="min-h-0 overflow-hidden rounded-md border border-border/60 bg-canvas/75">
          {expandedSidePanel ?? (
            <div className="flex h-full items-center justify-center px-4 text-sm text-muted">
              Click any sequence actor or step to open related changed files here.
            </div>
          )}
        </aside>
      </div>

      {combinedSequenceError && (
        <div className="border-t border-border/60 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-danger">{combinedSequenceError}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={onRetrySequenceGeneration}
              disabled={isSequenceGenerating}
              className="h-7 px-2"
            >
              {isSequenceGenerating ? "Retrying..." : "Retry"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
