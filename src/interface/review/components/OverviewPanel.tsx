import { Badge, Card, CardBody, CardDescription, CardHeader, CardTitle, StatDelta } from "../../../design-system/index.ts";
import { cn } from "../../../shared/index.ts";
import type { OverviewCard } from "../../../domain/review/index.ts";

import type { ArchitectureCluster, SequencePair } from "../types.ts";

export interface OverviewPanelProps {
  readonly overviewCards: readonly OverviewCard[];
  readonly architectureClusters: readonly ArchitectureCluster[];
  readonly sequencePairs: readonly SequencePair[];
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
  highlightedFileIds,
  onSelectFiles,
}: OverviewPanelProps) {
  const highlightedSet = new Set(highlightedFileIds);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>AI Overview</CardTitle>
          <CardDescription>Commit-level intent and risk notes grounded in changed files.</CardDescription>
        </CardHeader>
        <CardBody className="grid gap-3 md:grid-cols-2">
          {overviewCards.map((card) => (
            <div key={card.id} className="rounded-md border border-border bg-elevated/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="font-display text-sm font-semibold">{card.title}</h4>
                <Badge tone={toneForCard(card.kind)}>{card.kind}</Badge>
              </div>
              <p className="text-sm text-muted">{card.body}</p>
            </div>
          ))}

          {overviewCards.length === 0 && (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
              No overview cards are available for this commit yet.
            </p>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Architecture Impact Map</CardTitle>
            <CardDescription>Click an area to focus affected files.</CardDescription>
          </CardHeader>
          <CardBody className="space-y-3">
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

        <Card>
          <CardHeader>
            <CardTitle>Before / After Sequence</CardTitle>
            <CardDescription>Each block maps to one or more affected files.</CardDescription>
          </CardHeader>
          <CardBody className="space-y-3">
            {sequencePairs.map((pair) => {
              const beforeHighlighted = pair.before.fileIds.some((fileId) => highlightedSet.has(fileId));
              const afterHighlighted = pair.after.fileIds.some((fileId) => highlightedSet.has(fileId));

              return (
                <div key={pair.id} className="grid gap-2 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
                  <button
                    type="button"
                    onClick={() => onSelectFiles(pair.before.fileIds)}
                    className={cn(
                      "rounded-md border border-border bg-surface px-3 py-2 text-left transition-colors",
                      "hover:border-accent/50 hover:bg-elevated",
                      beforeHighlighted && "border-caution/80 bg-caution/10",
                    )}
                  >
                    <p className="mb-1 font-display text-xs font-semibold uppercase tracking-wide text-muted">
                      Before
                    </p>
                    <h4 className="font-medium text-text">{pair.before.title}</h4>
                    <p className="text-sm text-muted">{pair.before.body}</p>
                  </button>

                  <div className="hidden items-center justify-center text-muted md:flex">{">"}</div>

                  <button
                    type="button"
                    onClick={() => onSelectFiles(pair.after.fileIds)}
                    className={cn(
                      "rounded-md border border-border bg-elevated/50 px-3 py-2 text-left transition-colors",
                      "hover:border-accent/50 hover:bg-elevated",
                      afterHighlighted && "border-caution/80 bg-caution/10",
                    )}
                  >
                    <p className="mb-1 font-display text-xs font-semibold uppercase tracking-wide text-muted">
                      After
                    </p>
                    <h4 className="font-medium text-text">{pair.after.title}</h4>
                    <p className="text-sm text-muted">{pair.after.body}</p>
                  </button>
                </div>
              );
            })}

            {sequencePairs.length === 0 && (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
                Sequence blocks render after commit data has loaded.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
