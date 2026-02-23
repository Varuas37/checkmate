import { useState, type ReactNode } from "react";

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  Modal,
} from "../../../design-system/index.ts";
import { cn } from "../../../shared/index.ts";
import type { OverviewCard } from "../../../domain/review/index.ts";

import type { ArchitectureCluster, CodeSequenceStep } from "../types.ts";
import { CodeSequenceDiagramPanel } from "./CodeSequenceDiagramPanel.tsx";

export interface OverviewPanelProps {
  readonly overviewCards: readonly OverviewCard[];
  readonly architectureClusters: readonly ArchitectureCluster[];
  readonly codeSequenceSteps: readonly CodeSequenceStep[];
  readonly aiAnalysisStatus: "idle" | "analysing" | "analysed" | "error";
  readonly sequenceGenerationStatus: "idle" | "generating" | "ready" | "error";
  readonly sequenceGenerationError: string | null;
  readonly sequenceViewMode: "compact" | "expanded";
  readonly onRefreshAiAnalysis: () => void;
  readonly onRetrySequenceGeneration: () => void;
  readonly onOpenSequenceExplorer: () => void;
  readonly onCloseSequenceExplorer: () => void;
  readonly onOpenSequenceFilesInExplorer: (fileIds: readonly string[]) => void;
  readonly sequenceExpandedSidePanel?: ReactNode;
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

const sectionEyebrowClass = "text-[11px] uppercase tracking-[0.14em] text-muted";

export function OverviewPanel({
  overviewCards,
  architectureClusters,
  codeSequenceSteps,
  aiAnalysisStatus,
  sequenceGenerationStatus,
  sequenceGenerationError,
  sequenceViewMode,
  onRefreshAiAnalysis,
  onRetrySequenceGeneration,
  onOpenSequenceExplorer,
  onCloseSequenceExplorer,
  onOpenSequenceFilesInExplorer,
  sequenceExpandedSidePanel,
  highlightedFileIds,
  onSelectFiles,
}: OverviewPanelProps) {
  const highlightedSet = new Set(highlightedFileIds);
  const [expandedText, setExpandedText] = useState<{
    readonly title: string;
    readonly body: string;
  } | null>(null);
  const primaryCard = overviewCards[0] ?? null;
  const summaryCards = overviewCards.slice(1, 4);

  const totalAdditions = architectureClusters.reduce((count, cluster) => count + cluster.additions, 0);
  const totalDeletions = architectureClusters.reduce((count, cluster) => count + cluster.deletions, 0);
  const totalFiles = architectureClusters.reduce((count, cluster) => count + cluster.fileCount, 0);
  const handleSequenceSelection = (fileIds: readonly string[]) => {
    onSelectFiles({
      fileIds,
      label: "Sequence focus",
    });
  };

  if (sequenceViewMode === "expanded") {
    return (
      <div className="h-full min-h-0 overflow-hidden p-2 xl:p-3">
        <div className="h-full min-h-0 overflow-hidden rounded-md border border-border/50 bg-transparent">
          <CodeSequenceDiagramPanel
            steps={codeSequenceSteps}
            sequenceGenerationStatus={sequenceGenerationStatus}
            sequenceGenerationError={sequenceGenerationError}
            onRetrySequenceGeneration={onRetrySequenceGeneration}
            highlightedFileIds={highlightedFileIds}
            onSelectFiles={handleSequenceSelection}
            mode="expanded"
            onCloseExpanded={onCloseSequenceExplorer}
            onOpenExpandedFiles={onOpenSequenceFilesInExplorer}
            expandedSidePanel={sequenceExpandedSidePanel}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="grid w-full gap-2 p-2 xl:grid-cols-12 xl:p-3">
        <Card className="xl:col-span-8 border-border/40 bg-transparent shadow-none">
          <CardHeader className="border-border/40 bg-transparent px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={sectionEyebrowClass}>Overview</p>
                <CardTitle>AI Summary</CardTitle>
                <CardDescription>Commit intent and review scope generated from changed files.</CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={onRefreshAiAnalysis}
                disabled={aiAnalysisStatus === "analysing"}
                title="Refresh AI summary and diagrams for this commit"
              >
                {aiAnalysisStatus === "analysing" ? "Refreshing..." : "Refresh AI"}
              </Button>
            </div>
          </CardHeader>
          <CardBody className="space-y-2 px-3 pb-2 pt-2">
            {primaryCard ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-base font-semibold text-text">{primaryCard.title}</h3>
                  <Badge tone={toneForCard(primaryCard.kind)}>{primaryCard.kind}</Badge>
                </div>
                <button
                  type="button"
                  className="w-full text-left text-sm leading-relaxed text-muted transition-colors hover:text-text"
                  onClick={() => {
                    setExpandedText({
                      title: primaryCard.title,
                      body: primaryCard.body,
                    });
                  }}
                >
                  {primaryCard.body}
                </button>
                <p className="font-mono text-xs text-muted">
                  <span className="text-positive">{totalAdditions} additions</span>
                  {"  "}
                  <span className="text-danger">{totalDeletions} deletions</span>
                  {"  "}
                  <span className="text-text">{totalFiles} files changed</span>
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">No commit summary is available yet.</p>
            )}

            {summaryCards.length > 0 && (
              <div className="grid gap-1.5 border-t border-border/60 pt-2 md:grid-cols-2">
                {summaryCards.map((card) => (
                  <div key={card.id} className="min-w-0">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="truncate text-left text-sm font-semibold text-text transition-colors hover:text-accent"
                        onClick={() => {
                          setExpandedText({
                            title: card.title,
                            body: card.body,
                          });
                        }}
                      >
                        {card.title}
                      </button>
                      <Badge tone={toneForCard(card.kind)}>{card.kind}</Badge>
                    </div>
                    <button
                      type="button"
                      className="line-clamp-2 text-left text-xs text-muted transition-colors hover:text-text"
                      onClick={() => {
                        setExpandedText({
                          title: card.title,
                          body: card.body,
                        });
                      }}
                    >
                      {card.body}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="xl:col-span-4 border-border/40 bg-transparent shadow-none">
          <CardHeader className="border-border/40 bg-transparent px-3 py-2">
            <p className={sectionEyebrowClass}>Impact</p>
            <CardTitle>Change Impact</CardTitle>
            <CardDescription>Click a group to filter files.</CardDescription>
          </CardHeader>
          <CardBody className="space-y-1.5 px-3 pb-2 pt-2">
            {architectureClusters.length > 0 ? (
              architectureClusters.map((cluster) => {
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
                      "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left transition-colors",
                      "hover:bg-elevated",
                      isHighlighted && "bg-accent/10",
                    )}
                  >
                    <span className="truncate text-sm text-text">{cluster.label}</span>
                    <span className="shrink-0 font-mono text-xs text-muted">
                      <span className="text-positive">+{cluster.additions}</span>
                      {" "}
                      <span className="text-danger">-{cluster.deletions}</span>
                      {" "}
                      <span>{cluster.fileCount}</span>
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="text-sm text-muted">Impact clusters appear after files are loaded.</p>
            )}
          </CardBody>
        </Card>

        <div className="xl:col-span-12">
          <CodeSequenceDiagramPanel
            steps={codeSequenceSteps}
            sequenceGenerationStatus={sequenceGenerationStatus}
            sequenceGenerationError={sequenceGenerationError}
            onRetrySequenceGeneration={onRetrySequenceGeneration}
            highlightedFileIds={highlightedFileIds}
            onSelectFiles={handleSequenceSelection}
            onExpand={onOpenSequenceExplorer}
          />
        </div>

      </div>

      <Modal
        open={expandedText !== null}
        onClose={() => setExpandedText(null)}
        title={expandedText?.title ?? "Details"}
        panelClassName="max-w-2xl"
      >
        {expandedText && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.08em] text-muted">Full Text</p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">{expandedText.body}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
