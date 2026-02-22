import { useEffect, useMemo, useRef, useState } from "react";
import type mermaidType from "mermaid";

import { Badge, Card, CardBody, CardDescription, CardHeader, CardTitle } from "../../../design-system/index.ts";
import { useTheme } from "../../../design-system/theme/index.ts";
import { cn } from "../../../shared/index.ts";

import type { CodeSequenceStep } from "../types.ts";

export interface CodeSequenceDiagramPanelProps {
  readonly steps: readonly CodeSequenceStep[];
  readonly highlightedFileIds: readonly string[];
  readonly onSelectFiles: (fileIds: readonly string[]) => void;
}

let mermaidInstance: typeof mermaidType | null = null;
let mermaidPromise: Promise<typeof mermaidType> | null = null;

function normalizeMermaidTheme(resolvedTheme: string): "dark" | "default" {
  return resolvedTheme.toLowerCase().includes("dark") ? "dark" : "default";
}

async function getMermaid(resolvedTheme: string): Promise<typeof mermaidType> {
  if (mermaidInstance) {
    mermaidInstance.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: normalizeMermaidTheme(resolvedTheme),
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
    theme: normalizeMermaidTheme(resolvedTheme),
  });

  mermaidInstance = mermaid;
  return mermaid;
}

function sanitizeMermaidText(value: string): string {
  return value.replaceAll('"', "'").replaceAll("\n", " ").trim();
}

function normalizeParticipantId(label: string, index: number): string {
  const normalized = label.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  return `${normalized.length > 0 ? normalized : "actor"}_${index + 1}`;
}

export function CodeSequenceDiagramPanel({ steps, highlightedFileIds, onSelectFiles }: CodeSequenceDiagramPanelProps) {
  const { resolvedTheme } = useTheme();
  const diagramContainerRef = useRef<HTMLDivElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const highlightedSet = useMemo(() => new Set(highlightedFileIds), [highlightedFileIds]);

  const definition = useMemo(() => {
    const participantIdsByLabel = new Map<string, string>();
    const participantLines: string[] = [];

    const resolveParticipant = (label: string): string => {
      const existing = participantIdsByLabel.get(label);

      if (existing) {
        return existing;
      }

      const participantId = normalizeParticipantId(label, participantIdsByLabel.size);
      participantIdsByLabel.set(label, participantId);
      participantLines.push(`participant ${participantId} as ${sanitizeMermaidText(label)}`);
      return participantId;
    };

    const messageLines = steps.map((step) => {
      const sourceId = resolveParticipant(step.sourceLabel);
      const targetId = resolveParticipant(step.targetLabel);
      const message = sanitizeMermaidText(step.message);
      return `${sourceId}->>${targetId}: [${step.token}] ${message}`;
    });

    return ["sequenceDiagram", "autonumber", ...participantLines, ...messageLines].join("\n");
  }, [steps]);

  useEffect(() => {
    const container = diagramContainerRef.current;

    if (!container) {
      return;
    }

    if (steps.length === 0) {
      container.innerHTML = "";
      setRenderError(null);
      return;
    }

    let disposed = false;
    const removers: Array<() => void> = [];

    const renderDiagram = async () => {
      try {
        const mermaid = await getMermaid(resolvedTheme);
        const renderId = `review-sequence-${Math.random().toString(36).slice(2, 10)}`;
        const { svg } = await mermaid.render(renderId, definition);

        if (disposed) {
          return;
        }

        container.innerHTML = svg;

        const tokenMap = new Map(steps.map((step) => [step.token, step.fileIds] as const));
        const textNodes = container.querySelectorAll<SVGTextElement>("text");

        textNodes.forEach((textNode) => {
          const text = textNode.textContent ?? "";
          const tokenMatch = text.match(/\[(F\d+)\]/);

          if (!tokenMatch) {
            return;
          }

          const token = tokenMatch[1];

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

        setRenderError(null);
      } catch {
        if (disposed) {
          return;
        }

        container.innerHTML = "";
        setRenderError("Unable to render sequence diagram.");
      }
    };

    void renderDiagram();

    return () => {
      disposed = true;
      removers.forEach((remove) => remove());
    };
  }, [definition, onSelectFiles, resolvedTheme, steps]);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Code Sequence</CardTitle>
        <CardDescription>Click a sequence step to focus relevant files.</CardDescription>
      </CardHeader>
      <CardBody className="space-y-3">
        {steps.length === 0 && (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
            Sequence diagram appears after changed files are loaded.
          </p>
        )}

        {steps.length > 0 && (
          <>
            <div className="rounded-md border border-border bg-elevated/30 p-2">
              <div ref={diagramContainerRef} className="min-h-[16rem] overflow-x-auto [&_svg]:h-auto [&_svg]:w-full" />
            </div>

            {renderError && <p className="text-xs text-danger">{renderError}</p>}

            <div className="grid gap-2">
              {steps.map((step) => {
                const isHighlighted = step.fileIds.some((fileId) => highlightedSet.has(fileId));

                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => onSelectFiles(step.fileIds)}
                    className={cn(
                      "w-full rounded-md border border-border bg-surface px-3 py-2 text-left transition-colors",
                      "hover:border-accent/50 hover:bg-elevated",
                      isHighlighted && "border-caution/80 bg-caution/10",
                    )}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <Badge tone="accent">{step.token}</Badge>
                      <p className="text-xs text-muted">
                        {step.sourceLabel} to {step.targetLabel}
                      </p>
                    </div>
                    <p className="font-mono text-xs text-text">{step.message}</p>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
