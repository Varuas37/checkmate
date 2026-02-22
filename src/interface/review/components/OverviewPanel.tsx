import { Badge, Card, CardBody, CardDescription, CardHeader, CardTitle, StatDelta } from "../../../design-system/index.ts";
import { cn } from "../../../shared/index.ts";
import type { OverviewCard } from "../../../domain/review/index.ts";

import type { ArchitectureCluster, CodeSequenceStep, SequencePair } from "../types.ts";
import { CodeSequenceDiagramPanel } from "./CodeSequenceDiagramPanel.tsx";

export interface OverviewPanelProps {
  readonly overviewCards: readonly OverviewCard[];
  readonly architectureClusters: readonly ArchitectureCluster[];
  readonly sequencePairs: readonly SequencePair[];
  readonly codeSequenceSteps: readonly CodeSequenceStep[];
  readonly highlightedFileIds: readonly string[];
  readonly onSelectFiles: (selection: {
    readonly fileIds: readonly string[];
    readonly label?: string;
  }) => void;
}

function toneForCard(kind: OverviewCard["kind"]): "accent" | "positive" | "danger" | "caution" {
  if (kind === "summary") {
    return "accent";
  }

  if (kind === "impact") {
    return "positive";
  }

  if (kind === "risk") {
    return "danger";
  }

  return "caution";
}

export function OverviewPanel({
  overviewCards,
  architectureClusters,
  sequencePairs,
  codeSequenceSteps,
  highlightedFileIds,
  onSelectFiles,
}: OverviewPanelProps) {
  const highlightedSet = new Set(highlightedFileIds);
  const primaryCard = overviewCards[0] ?? null;
  const summaryCards = overviewCards.slice(1, 5);

  const totalAdditions = architectureClusters.reduce((count, cluster) => count + cluster.additions, 0);
  const totalDeletions = architectureClusters.reduce((count, cluster) => count + cluster.deletions, 0);
  const totalFiles = architectureClusters.reduce((count, cluster) => count + cluster.fileCount, 0);

  const previewSteps = codeSequenceSteps.slice(0, 5);

  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader className="border-b-0 pb-1">
          <CardTitle>AI Change Summary</CardTitle>
          <CardDescription>Commit context and review scope generated from changed files.</CardDescription>
        </CardHeader>
        <CardBody className="space-y-3 pt-1">
          {primaryCard ? (
            <>
              <div className="rounded-md border border-border bg-elevated/35 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="font-display text-base font-semibold text-text">{primaryCard.title}</h3>
                  <Badge tone={toneForCard(primaryCard.kind)}>{primaryCard.kind}</Badge>
                </div>
                <p className="text-sm leading-relaxed text-muted">{primaryCard.body}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs text-positive">{totalAdditions} additions</p>
                <p className="text-xs text-danger">{totalDeletions} deletions</p>
                <p className="text-xs text-muted">{totalFiles} files changed</p>
              </div>
            </>
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
              No commit summary is available yet.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="border-b-0 pb-2">
          <CardTitle className="text-sm uppercase tracking-[0.08em] text-muted">Change Impact</CardTitle>
          <CardDescription>Click an area to filter affected files in the sidebar.</CardDescription>
        </CardHeader>
        <CardBody className="grid gap-2 pt-0 md:grid-cols-2 xl:grid-cols-4">
          {architectureClusters.map((cluster) => {
            const isHighlighted = cluster.fileIds.some((fileId) => highlightedSet.has(fileId));
            return (
              <button
                key={cluster.id}
                type="button"
                onClick={() =>
                  onSelectFiles({
                    fileIds: cluster.fileIds,
                    label: cluster.label,
                  })
                }
                className={cn(
                  "rounded-md border px-3 py-3 text-left transition-colors",
                  "hover:border-accent/50 hover:bg-elevated",
                  isHighlighted && "border-accent/70 bg-accent/12",
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="font-display text-sm font-semibold text-text">{cluster.label}</p>
                  <Badge tone="neutral">{cluster.fileCount}</Badge>
                </div>
                <StatDelta additions={cluster.additions} deletions={cluster.deletions} />
              </button>
            );
          })}
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-[0.08em] text-muted">Flow Comparison</CardTitle>
            <CardDescription>Before and after flow snapshots linked to changed files.</CardDescription>
          </CardHeader>
          <CardBody className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-danger/30 bg-danger/6 p-3">
              <p className="mb-2 text-xs uppercase tracking-[0.08em] text-danger">Before</p>
              <div className="space-y-2">
                {previewSteps.map((step) => (
                  <div key={`before-${step.id}`} className="rounded border border-border bg-surface px-2 py-1.5">
                    <p className="truncate text-xs text-text">{step.sourceLabel}</p>
                    <p className="truncate text-[11px] text-muted">{step.message}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-positive/30 bg-positive/6 p-3">
              <p className="mb-2 text-xs uppercase tracking-[0.08em] text-positive">After</p>
              <div className="space-y-2">
                {previewSteps.map((step) => {
                  const isHighlighted = step.fileIds.some((fileId) => highlightedSet.has(fileId));
                  return (
                    <button
                      key={`after-${step.id}`}
                      type="button"
                      onClick={() =>
                        onSelectFiles({
                          fileIds: step.fileIds,
                          label: `${step.targetLabel} flow`,
                        })
                      }
                      className={cn(
                        "w-full rounded border border-border bg-surface px-2 py-1.5 text-left transition-colors",
                        "hover:border-accent/60 hover:bg-elevated",
                        isHighlighted && "border-accent/70",
                      )}
                    >
                      <p className="truncate text-xs text-text">{step.targetLabel}</p>
                      <p className="truncate text-[11px] text-muted">{step.message}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </CardBody>
        </Card>

        <CodeSequenceDiagramPanel
          steps={codeSequenceSteps}
          highlightedFileIds={highlightedFileIds}
          onSelectFiles={(fileIds) =>
            onSelectFiles({
              fileIds,
              label: "Sequence focus",
            })
          }
        />
      </div>

      <Card>
        <CardHeader className="border-b-0 pb-1">
          <CardTitle className="text-sm uppercase tracking-[0.08em] text-muted">Architecture Overview</CardTitle>
          <CardDescription>High-level component chain for this commit.</CardDescription>
        </CardHeader>
        <CardBody className="space-y-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            {architectureClusters.map((cluster, index) => {
              const isHighlighted = cluster.fileIds.some((fileId) => highlightedSet.has(fileId));
              return (
                <div key={cluster.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onSelectFiles({
                        fileIds: cluster.fileIds,
                        label: cluster.label,
                      })
                    }
                    className={cn(
                      "rounded-md border px-3 py-2 text-left transition-colors",
                      "hover:border-accent/50 hover:bg-elevated",
                      isHighlighted && "border-accent/70 bg-accent/12",
                    )}
                  >
                    <p className="text-xs font-semibold text-text">{cluster.label}</p>
                    <p className="text-[11px] text-muted">{cluster.fileCount} files</p>
                  </button>
                  {index < architectureClusters.length - 1 && <p className="text-xs text-muted">{">"}</p>}
                </div>
              );
            })}
          </div>

          {summaryCards.length > 0 && (
            <div className="grid gap-2 md:grid-cols-2">
              {summaryCards.map((card) => (
                <div key={card.id} className="rounded-md border border-border bg-elevated/30 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="font-display text-sm font-semibold text-text">{card.title}</p>
                    <Badge tone={toneForCard(card.kind)}>{card.kind}</Badge>
                  </div>
                  <p className="text-sm text-muted">{card.body}</p>
                </div>
              ))}
            </div>
          )}

          {sequencePairs.length === 0 && (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
              Flow details render after commit data has loaded.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
