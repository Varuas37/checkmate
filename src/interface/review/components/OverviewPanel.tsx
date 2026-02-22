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
  readonly onSelectFiles: (fileIds: readonly string[]) => void;
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
  const secondaryCards = primaryCard ? overviewCards.slice(1) : [];
  const totalFiles = architectureClusters.reduce((count, cluster) => count + cluster.fileCount, 0);
  const totalAdditions = architectureClusters.reduce((count, cluster) => count + cluster.additions, 0);
  const totalDeletions = architectureClusters.reduce((count, cluster) => count + cluster.deletions, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Overview Narrative</CardTitle>
            <CardDescription>Commit-level intent and risk notes grounded in changed files.</CardDescription>
          </CardHeader>
          <CardBody className="space-y-3">
            {primaryCard && (
              <div className="rounded-md border border-border bg-elevated/50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="font-display text-sm font-semibold">{primaryCard.title}</h4>
                  <Badge tone={toneForCard(primaryCard.kind)}>{primaryCard.kind}</Badge>
                </div>
                <p className="text-sm text-muted">{primaryCard.body}</p>
              </div>
            )}

            {!primaryCard && (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
                No overview cards are available for this commit yet.
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Review Snapshot</CardTitle>
            <CardDescription>Scope and diagram coverage for this commit.</CardDescription>
          </CardHeader>
          <CardBody className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-md border border-border bg-elevated/40 px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-muted">Changed Files</p>
              <p className="text-lg font-semibold text-text">{totalFiles}</p>
            </div>
            <div className="rounded-md border border-border bg-elevated/40 px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-muted">Code Sequence Steps</p>
              <p className="text-lg font-semibold text-text">{codeSequenceSteps.length}</p>
            </div>
            <div className="rounded-md border border-border bg-elevated/40 px-3 py-2 sm:col-span-2 xl:col-span-1">
              <p className="mb-1 text-xs uppercase tracking-wide text-muted">Net Churn</p>
              <StatDelta additions={totalAdditions} deletions={totalDeletions} />
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Architecture Impact Map</CardTitle>
            <CardDescription>Click an area to focus affected files.</CardDescription>
          </CardHeader>
          <CardBody className="space-y-2">
            {architectureClusters.map((cluster) => {
              const isHighlighted = cluster.fileIds.some((fileId) => highlightedSet.has(fileId));

              return (
                <button
                  key={cluster.id}
                  type="button"
                  onClick={() => onSelectFiles(cluster.fileIds)}
                  className={cn(
                    "w-full rounded-md border px-3 py-3 text-left transition-colors",
                    "hover:border-accent/60 hover:bg-elevated",
                    isHighlighted && "border-caution/80 bg-caution/10",
                  )}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h4 className="font-display text-sm font-semibold">{cluster.label}</h4>
                    <Badge tone="accent">{cluster.fileCount} files</Badge>
                  </div>
                  <StatDelta additions={cluster.additions} deletions={cluster.deletions} />
                </button>
              );
            })}

            {architectureClusters.length === 0 && (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
                Architecture coverage appears after changed files are loaded.
              </p>
            )}
          </CardBody>
        </Card>

        <CodeSequenceDiagramPanel
          steps={codeSequenceSteps}
          highlightedFileIds={highlightedFileIds}
          onSelectFiles={onSelectFiles}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Before / After Trace</CardTitle>
          <CardDescription>Compact transition notes linked to file focus.</CardDescription>
        </CardHeader>
        <CardBody className="space-y-2">
          {sequencePairs.map((pair) => {
            const fileIds = [...pair.before.fileIds, ...pair.after.fileIds];
            const isHighlighted = fileIds.some((fileId) => highlightedSet.has(fileId));

            return (
              <button
                key={pair.id}
                type="button"
                onClick={() => onSelectFiles(fileIds)}
                className={cn(
                  "w-full rounded-md border border-border bg-surface px-3 py-3 text-left transition-colors",
                  "hover:border-accent/50 hover:bg-elevated",
                  isHighlighted && "border-caution/80 bg-caution/10",
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h4 className="font-display text-sm font-semibold text-text">{pair.after.title}</h4>
                  <Badge tone="neutral">{fileIds.length} link</Badge>
                </div>
                <p className="text-sm text-muted">{pair.before.body}</p>
              </button>
            );
          })}

          {sequencePairs.length === 0 && (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
              Sequence blocks render after commit data has loaded.
            </p>
          )}

          {secondaryCards.length > 0 && (
            <div className="grid gap-2 pt-1 md:grid-cols-2">
              {secondaryCards.map((card) => (
                <div key={card.id} className="rounded-md border border-border bg-elevated/40 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <h4 className="font-display text-sm font-semibold">{card.title}</h4>
                    <Badge tone={toneForCard(card.kind)}>{card.kind}</Badge>
                  </div>
                  <p className="text-sm text-muted">{card.body}</p>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
