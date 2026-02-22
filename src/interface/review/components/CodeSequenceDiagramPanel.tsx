import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type mermaidType from "mermaid";

import { Badge, Button, Card, CardBody, CardDescription, CardHeader, CardTitle } from "../../../design-system/index.ts";
import { useTheme } from "../../../design-system/theme/index.ts";
import { cn } from "../../../shared/index.ts";

import type { CodeSequenceStep } from "../types.ts";

export interface CodeSequenceDiagramPanelProps {
  readonly steps: readonly CodeSequenceStep[];
  readonly sequenceGenerationStatus: "idle" | "generating" | "ready" | "error";
  readonly sequenceGenerationError: string | null;
  readonly onRetrySequenceGeneration: () => void;
  readonly highlightedFileIds: readonly string[];
  readonly onSelectFiles: (fileIds: readonly string[]) => void;
}

let mermaidInstance: typeof mermaidType | null = null;
let mermaidPromise: Promise<typeof mermaidType> | null = null;
const MIN_ZOOM_LEVEL = 0.5;
const MAX_ZOOM_LEVEL = 8;
const ZOOM_STEP = 0.25;

interface DiagramStep {
  readonly id: string;
  readonly token: string;
  readonly sourceLabel: string;
  readonly targetLabel: string;
  readonly message: string;
  readonly fileIds: readonly string[];
}

function normalizeMermaidTheme(resolvedTheme: string): "dark" | "default" {
  return resolvedTheme.toLowerCase().includes("dark") ? "dark" : "default";
}

async function getMermaid(resolvedTheme: string): Promise<typeof mermaidType> {
  const theme = normalizeMermaidTheme(resolvedTheme);

  if (mermaidInstance) {
    mermaidInstance.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme,
    });
    return mermaidInstance;
  }

  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((module) => module.default);
  }

  const mermaid = await mermaidPromise;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme,
  });

  mermaidInstance = mermaid;
  return mermaid;
}

function sanitizeMermaidText(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function sanitizeParticipantLabel(value: string): string {
  const sanitized = sanitizeMermaidText(value).replaceAll(/["`\\]/g, "'");
  return sanitized.length > 0 ? sanitized : "Component";
}

function sanitizeMessageText(value: string): string {
  const sanitized = sanitizeMermaidText(value)
    .replaceAll(/["`\\]/g, "'")
    .replaceAll(/[<>[\]{}]/g, " ");
  return sanitized.length > 0 ? sanitized : "Update";
}

function sanitizeToken(value: string, index: number): string {
  const sanitized = sanitizeMermaidText(value).replaceAll(/[^A-Za-z0-9_-]/g, "");
  if (sanitized.length > 0) {
    return sanitized.slice(0, 24);
  }
  return `STEP${index + 1}`;
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeParticipantId(label: string, index: number): string {
  const normalized = label.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  return `p_${normalized.length > 0 ? normalized : "actor"}_${index + 1}`;
}

function clampZoomLevel(value: number): number {
  if (value < MIN_ZOOM_LEVEL) {
    return MIN_ZOOM_LEVEL;
  }

  if (value > MAX_ZOOM_LEVEL) {
    return MAX_ZOOM_LEVEL;
  }

  return value;
}

function buildPrimaryDefinition(diagramSteps: readonly DiagramStep[]): string {
  const participantIdsByLabel = new Map<string, string>();
  const participantLines: string[] = [];

  const resolveParticipant = (label: string): string => {
    const existing = participantIdsByLabel.get(label);

    if (existing) {
      return existing;
    }

    const participantId = normalizeParticipantId(label, participantIdsByLabel.size);
    participantIdsByLabel.set(label, participantId);
    participantLines.push(`participant ${participantId} as "${label}"`);
    return participantId;
  };

  const messageLines = diagramSteps.map((step) => {
    const sourceId = resolveParticipant(step.sourceLabel);
    const targetId = resolveParticipant(step.targetLabel);
    return `${sourceId}->>${targetId}: ${step.token} ${step.message}`;
  });

  return ["sequenceDiagram", "autonumber", ...participantLines, ...messageLines].join("\n");
}

function buildFallbackDefinition(diagramSteps: readonly DiagramStep[]): string {
  const participantIdsByLabel = new Map<string, string>();
  const participantLines: string[] = [];

  const resolveParticipant = (label: string): string => {
    const existing = participantIdsByLabel.get(label);

    if (existing) {
      return existing;
    }

    const nextId = `p_safe_${participantIdsByLabel.size + 1}`;
    participantIdsByLabel.set(label, nextId);
    participantLines.push(`participant ${nextId} as "Actor ${participantIdsByLabel.size}"`);
    return nextId;
  };

  const messageLines = diagramSteps.map((step, index) => {
    const sourceId = resolveParticipant(step.sourceLabel);
    const targetId = resolveParticipant(step.targetLabel);
    const safeToken = step.token.length > 0 ? step.token : `S${index + 1}`;
    return `${sourceId}->>${targetId}: ${safeToken}`;
  });

  return ["sequenceDiagram", "autonumber", ...participantLines, ...messageLines].join("\n");
}

export function CodeSequenceDiagramPanel({
  steps,
  sequenceGenerationStatus,
  sequenceGenerationError,
  onRetrySequenceGeneration,
  highlightedFileIds,
  onSelectFiles,
}: CodeSequenceDiagramPanelProps) {
  const { resolvedTheme } = useTheme();
  const diagramContainerRef = useRef<HTMLDivElement | null>(null);
  const expandedDiagramContainerRef = useRef<HTMLDivElement | null>(null);
  const expandedViewportRef = useRef<HTMLDivElement | null>(null);
  const panOriginRef = useRef({ x: 0, y: 0 });
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const panningPointerIdRef = useRef<number | null>(null);
  const zoomLevelRef = useRef(1);
  const expandedContentSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [expandedContentSize, setExpandedContentSize] = useState<{ width: number; height: number } | null>(null);
  const highlightedSet = useMemo(() => new Set(highlightedFileIds), [highlightedFileIds]);
  const isSequenceGenerating = sequenceGenerationStatus === "generating";
  const combinedSequenceError = sequenceGenerationError ?? renderError;

  const diagramSteps = useMemo<readonly DiagramStep[]>(
    () =>
      steps.map((step, index) => ({
        id: step.id,
        token: sanitizeToken(step.token, index),
        sourceLabel: sanitizeParticipantLabel(step.sourceLabel),
        targetLabel: sanitizeParticipantLabel(step.targetLabel),
        message: sanitizeMessageText(step.message),
        fileIds: step.fileIds,
      })),
    [steps],
  );

  const definition = useMemo(() => buildPrimaryDefinition(diagramSteps), [diagramSteps]);
  const fallbackDefinition = useMemo(() => buildFallbackDefinition(diagramSteps), [diagramSteps]);

  useEffect(() => {
    panOffsetRef.current = panOffset;
  }, [panOffset]);

  useEffect(() => {
    zoomLevelRef.current = zoomLevel;
  }, [zoomLevel]);

  useEffect(() => {
    if (!isExpanded) {
      return;
    }

    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    setIsPanning(false);
    panningPointerIdRef.current = null;
  }, [isExpanded]);

  useEffect(() => {
    if (!isExpanded) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsExpanded(false);
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isExpanded]);

  const bindSequenceTokenClicks = useCallback(
    (container: HTMLDivElement): Array<() => void> => {
      const removers: Array<() => void> = [];
      const tokenMap = new Map(diagramSteps.map((step) => [step.token, step.fileIds] as const));
      const searchableTokens = [...tokenMap.keys()].sort((left, right) => right.length - left.length);
      const textNodes = container.querySelectorAll<SVGTextElement>("text");

      textNodes.forEach((textNode) => {
        const text = (textNode.textContent ?? "").trim();
        if (text.length === 0) {
          return;
        }

        const token = searchableTokens.find((candidate) => {
          const matcher = new RegExp(`\\b${escapeRegExp(candidate)}\\b`);
          return matcher.test(text);
        });
        if (!token) {
          return;
        }

        const fileIds = tokenMap.get(token);

        if (!fileIds || fileIds.length === 0) {
          return;
        }

        textNode.style.cursor = "pointer";
        textNode.style.fill = "hsl(var(--color-accent))";

        const handleClick = () => onSelectFiles(fileIds);
        textNode.addEventListener("click", handleClick);
        removers.push(() => textNode.removeEventListener("click", handleClick));
      });

      return removers;
    },
    [diagramSteps, onSelectFiles],
  );

  const applyFitView = useCallback(
    (targetZoom?: number) => {
      const viewport = expandedViewportRef.current;
      const contentSize = expandedContentSizeRef.current;

      if (!viewport || !contentSize) {
        return;
      }

      const bounds = viewport.getBoundingClientRect();
      const availableWidth = Math.max(0, bounds.width - 36);
      const availableHeight = Math.max(0, bounds.height - 36);
      const fitZoom = clampZoomLevel(
        Math.min(
          availableWidth / Math.max(contentSize.width, 1),
          availableHeight / Math.max(contentSize.height, 1),
        ),
      );
      const nextZoom = clampZoomLevel(targetZoom ?? fitZoom);

      setZoomLevel(nextZoom);
      setPanOffset({
        x: (bounds.width - contentSize.width * nextZoom) / 2,
        y: (bounds.height - contentSize.height * nextZoom) / 2,
      });
    },
    [],
  );

  useEffect(() => {
    if (!isExpanded) {
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applyFitView();
      });
    });
  }, [applyFitView, isExpanded]);

  useEffect(() => {
    const containers = [diagramContainerRef.current, expandedDiagramContainerRef.current].filter(
      (container): container is HTMLDivElement => container !== null,
    );

    if (containers.length === 0) {
      return;
    }

    if (steps.length === 0) {
      containers.forEach((container) => {
        container.innerHTML = "";
      });
      setRenderError(null);
      setExpandedContentSize(null);
      return;
    }

    let disposed = false;
    const removers: Array<() => void> = [];

    const renderDiagram = async () => {
      try {
        const mermaid = await getMermaid(resolvedTheme);
        const definitionCandidates: readonly string[] = [definition, fallbackDefinition];
        let lastError: unknown = null;

        for (const definitionCandidate of definitionCandidates) {
          try {
            await mermaid.parse(definitionCandidate);

            for (const container of containers) {
              const renderId = `review-sequence-${Math.random().toString(36).slice(2, 10)}`;
              const { svg } = await mermaid.render(renderId, definitionCandidate);

              if (disposed) {
                return;
              }

              container.innerHTML = svg;
              removers.push(...bindSequenceTokenClicks(container));

              if (container === expandedDiagramContainerRef.current) {
                const renderedSvg = container.querySelector("svg");

                if (renderedSvg) {
                  const viewBoxWidth = renderedSvg.viewBox.baseVal?.width ?? 0;
                  const viewBoxHeight = renderedSvg.viewBox.baseVal?.height ?? 0;
                  const fallbackWidth = Number.parseFloat(renderedSvg.getAttribute("width") ?? "0");
                  const fallbackHeight = Number.parseFloat(renderedSvg.getAttribute("height") ?? "0");
                  const resolvedContentSize = {
                    width: viewBoxWidth > 0 ? viewBoxWidth : Number.isFinite(fallbackWidth) && fallbackWidth > 0 ? fallbackWidth : 1200,
                    height: viewBoxHeight > 0 ? viewBoxHeight : Number.isFinite(fallbackHeight) && fallbackHeight > 0 ? fallbackHeight : 700,
                  };
                  expandedContentSizeRef.current = resolvedContentSize;
                  setExpandedContentSize(resolvedContentSize);
                  renderedSvg.style.width = `${resolvedContentSize.width}px`;
                  renderedSvg.style.height = `${resolvedContentSize.height}px`;
                  renderedSvg.style.maxWidth = "none";
                  renderedSvg.style.display = "block";
                }
              }
            }

            setRenderError(null);
            if (isExpanded) {
              requestAnimationFrame(() => {
                applyFitView();
              });
            }
            return;
          } catch (error) {
            lastError = error;
          }
        }

        if (disposed) {
          return;
        }

        containers.forEach((container) => {
          container.innerHTML = "";
        });

        if (lastError instanceof Error && lastError.message.trim().length > 0) {
          setRenderError(`Unable to render sequence diagram (${lastError.message}).`);
          return;
        }
        setRenderError("Unable to render sequence diagram.");
      } catch (error) {
        if (disposed) {
          return;
        }

        containers.forEach((container) => {
          container.innerHTML = "";
        });

        if (error instanceof Error && error.message.trim().length > 0) {
          setRenderError(`Unable to render sequence diagram (${error.message}).`);
          return;
        }
        setRenderError("Unable to render sequence diagram.");
      }
    };

    void renderDiagram();

    return () => {
      disposed = true;
      removers.forEach((remove) => remove());
    };
  }, [applyFitView, bindSequenceTokenClicks, definition, fallbackDefinition, isExpanded, resolvedTheme, steps.length]);

  const closeExpanded = () => {
    setIsExpanded(false);
    setIsPanning(false);
    panningPointerIdRef.current = null;
  };

  const handleZoomIn = () => {
    setZoomLevel((currentZoomLevel) => clampZoomLevel(currentZoomLevel + ZOOM_STEP));
  };

  const handleZoomOut = () => {
    setZoomLevel((currentZoomLevel) => clampZoomLevel(currentZoomLevel - ZOOM_STEP));
  };

  const handleResetView = () => {
    applyFitView();
  };

  const handleExpandedPanStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target;

    if (target instanceof Element && target.closest("text")) {
      return;
    }

    panningPointerIdRef.current = event.pointerId;
    panOriginRef.current = {
      x: event.clientX - panOffsetRef.current.x,
      y: event.clientY - panOffsetRef.current.y,
    };

    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleExpandedPanMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isPanning || panningPointerIdRef.current !== event.pointerId) {
      return;
    }

    setPanOffset({
      x: event.clientX - panOriginRef.current.x,
      y: event.clientY - panOriginRef.current.y,
    });
  };

  const handleExpandedPanEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panningPointerIdRef.current !== event.pointerId) {
      return;
    }

    panningPointerIdRef.current = null;
    setIsPanning(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleExpandedWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();

    const viewport = expandedViewportRef.current;
    if (!viewport) {
      return;
    }

    const currentZoom = zoomLevelRef.current;
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextZoom = clampZoomLevel(currentZoom + direction * ZOOM_STEP);

    if (nextZoom === currentZoom) {
      return;
    }

    const bounds = viewport.getBoundingClientRect();
    const cursorX = event.clientX - bounds.left;
    const cursorY = event.clientY - bounds.top;
    const worldX = (cursorX - panOffsetRef.current.x) / currentZoom;
    const worldY = (cursorY - panOffsetRef.current.y) / currentZoom;

    setZoomLevel(nextZoom);
    setPanOffset({
      x: cursorX - worldX * nextZoom,
      y: cursorY - worldY * nextZoom,
    });
  };

  return (
    <>
      <Card className="h-full border-border/40 bg-transparent shadow-none">
        <CardHeader className="flex items-start justify-between gap-3 border-border/40 bg-transparent px-3 py-2">
          <div>
            <CardTitle>Code Sequence</CardTitle>
            <CardDescription>Click a sequence step to focus relevant files.</CardDescription>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setIsExpanded(true)} disabled={steps.length === 0}>
            Expand
          </Button>
        </CardHeader>
        <CardBody className="space-y-2 px-3 pb-2 pt-2">
          {isSequenceGenerating && (
            <p className="text-xs text-muted">
              Generating Mermaid sequence diagram with specialized AI agent...
            </p>
          )}

          {steps.length === 0 && !isSequenceGenerating && (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
              Sequence diagram appears after changed files are loaded.
            </p>
          )}

          {steps.length === 0 && combinedSequenceError && (
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

          {steps.length > 0 && (
            <>
              <div className="rounded-md border border-border bg-elevated/30 p-2">
                <div ref={diagramContainerRef} className="min-h-[16rem] overflow-x-auto [&_svg]:h-auto [&_svg]:w-full" />
              </div>

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

              <div className="overflow-hidden rounded-md border border-border bg-surface">
                <div className="max-h-48 divide-y divide-border/60 overflow-y-auto">
                  {steps.map((step) => {
                    const isHighlighted = step.fileIds.some((fileId) => highlightedSet.has(fileId));

                    return (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => onSelectFiles(step.fileIds)}
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
        </CardBody>
      </Card>

      {isExpanded && steps.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Expanded code sequence diagram"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeExpanded();
            }
          }}
        >
          <Card className="flex h-full max-h-[92vh] w-full max-w-[1120px] flex-col">
            <CardHeader className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Code Sequence (Expanded)</CardTitle>
                <CardDescription>Drag to pan, zoom for details, and click steps to focus files.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="rounded-md border border-border bg-elevated/45 px-2 py-1 font-mono text-[11px] text-muted">
                  {Math.round(zoomLevel * 100)}%
                </p>
                <Button variant="secondary" size="sm" onClick={handleZoomOut} disabled={zoomLevel <= MIN_ZOOM_LEVEL}>
                  -
                </Button>
                <Button variant="secondary" size="sm" onClick={handleZoomIn} disabled={zoomLevel >= MAX_ZOOM_LEVEL}>
                  +
                </Button>
                <Button variant="ghost" size="sm" onClick={handleResetView}>
                  Fit
                </Button>
                <Button variant="secondary" size="sm" onClick={closeExpanded}>
                  Close
                </Button>
              </div>
            </CardHeader>
            <CardBody className="flex-1 overflow-hidden">
              <div
                ref={expandedViewportRef}
                className={cn(
                  "relative h-full min-h-[26rem] touch-none overflow-hidden rounded-md border border-border bg-elevated/30",
                  isPanning ? "cursor-grabbing" : "cursor-grab",
                )}
                onPointerDown={handleExpandedPanStart}
                onPointerMove={handleExpandedPanMove}
                onPointerUp={handleExpandedPanEnd}
                onPointerCancel={handleExpandedPanEnd}
                onWheel={handleExpandedWheel}
              >
                <div
                  className="absolute left-0 top-0 origin-top-left will-change-transform [&_svg]:h-auto [&_svg]:max-w-none [&_svg]:w-auto"
                  style={{
                    width: expandedContentSize?.width,
                    height: expandedContentSize?.height,
                    transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
                  }}
                >
                  <div ref={expandedDiagramContainerRef} className="min-h-[24rem] min-w-[24rem]" />
                </div>
              </div>

              {combinedSequenceError && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
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
        </div>
      )}
    </>
  );
}
