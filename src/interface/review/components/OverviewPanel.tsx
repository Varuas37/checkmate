import { useState } from "react";

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

import type { ArchitectureCluster, CodeSequenceStep, SequencePair } from "../types.ts";
import { CodeSequenceDiagramPanel } from "./CodeSequenceDiagramPanel.tsx";

export interface OverviewPanelProps {
  readonly overviewCards: readonly OverviewCard[];
  readonly architectureClusters: readonly ArchitectureCluster[];
  readonly sequencePairs: readonly SequencePair[];
  readonly codeSequenceSteps: readonly CodeSequenceStep[];
  readonly aiAnalysisStatus: "idle" | "analysing" | "analysed" | "error";
  readonly sequenceGenerationStatus: "idle" | "generating" | "ready" | "error";
  readonly sequenceGenerationError: string | null;
  readonly onRefreshAiAnalysis: () => void;
  readonly onRetrySequenceGeneration: () => void;
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
  sequencePairs,
  codeSequenceSteps,
  aiAnalysisStatus,
  sequenceGenerationStatus,
  sequenceGenerationError,
  onRefreshAiAnalysis,
  onRetrySequenceGeneration,
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
  const previewPairs = sequencePairs.slice(0, 3);
  const fallbackFlowSteps = codeSequenceSteps.slice(0, 4);

  const totalAdditions = architectureClusters.reduce((count, cluster) => count + cluster.additions, 0);
  const totalDeletions = architectureClusters.reduce((count, cluster) => count + cluster.deletions, 0);
  const totalFiles = architectureClusters.reduce((count, cluster) => count + cluster.fileCount, 0);

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

        <Card className="xl:col-span-6 border-border/40 bg-transparent shadow-none">
          <CardHeader className="border-border/40 bg-transparent px-3 py-2">
            <p className={sectionEyebrowClass}>Flow</p>
            <CardTitle>Flow Comparison</CardTitle>
            <CardDescription>Before and after snapshots linked to changed files.</CardDescription>
          </CardHeader>
          <CardBody className="space-y-0 px-3 pb-2 pt-2">
            {previewPairs.length > 0 &&
              previewPairs.map((pair, index) => {
                const isHighlighted =
                  pair.before.fileIds.some((fileId) => highlightedSet.has(fileId)) ||
                  pair.after.fileIds.some((fileId) => highlightedSet.has(fileId));

                return (
                  <div
                    key={pair.id}
                    className={cn(
                      "grid gap-1.5 border-border/60 py-2 md:grid-cols-2",
                      index > 0 && "border-t",
                      isHighlighted && "bg-accent/5",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onSelectFiles({
                          fileIds: pair.before.fileIds,
                          label: pair.before.title,
                        })
                      }
                      className="min-w-0 rounded-sm px-2 py-1 text-left transition-colors hover:bg-danger/10"
                    >
                      <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-danger">Before</p>
                      <p
                        className="truncate text-xs font-semibold text-text"
                        title={pair.before.title}
                      >
                        {pair.before.title}
                      </p>
                      <p
                        className="line-clamp-2 cursor-pointer text-xs text-muted transition-colors hover:text-text"
                        title={pair.before.body}
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedText({
                            title: pair.before.title,
                            body: pair.before.body,
                          });
                        }}
                      >
                        {pair.before.body}
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onSelectFiles({
                          fileIds: pair.after.fileIds,
                          label: pair.after.title,
                        })
                      }
                      className="min-w-0 rounded-sm px-2 py-1 text-left transition-colors hover:bg-positive/10"
                    >
                      <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-positive">After</p>
                      <p
                        className="truncate text-xs font-semibold text-text"
                        title={pair.after.title}
                      >
                        {pair.after.title}
                      </p>
                      <p
                        className="line-clamp-2 cursor-pointer text-xs text-muted transition-colors hover:text-text"
                        title={pair.after.body}
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedText({
                            title: pair.after.title,
                            body: pair.after.body,
                          });
                        }}
                      >
                        {pair.after.body}
                      </p>
                    </button>
                  </div>
                );
              })}

            {previewPairs.length === 0 && fallbackFlowSteps.length > 0 && (
              <div className="space-y-1.5">
                {fallbackFlowSteps.map((step) => {
                  const isHighlighted = step.fileIds.some((fileId) => highlightedSet.has(fileId));

                  return (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() =>
                        onSelectFiles({
                          fileIds: step.fileIds,
                          label: `${step.targetLabel} flow`,
                        })
                      }
                      className={cn(
                        "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left transition-colors",
                        "hover:bg-elevated",
                        isHighlighted && "bg-accent/10",
                      )}
                    >
                      <p
                        className="truncate text-xs text-text"
                        title={step.message}
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedText({
                            title: `${step.token} ${step.sourceLabel} -> ${step.targetLabel}`,
                            body: step.message,
                          });
                        }}
                      >
                        {step.message}
                      </p>
                      <Badge tone="accent">{step.token}</Badge>
                    </button>
                  );
                })}
              </div>
            )}

            {previewPairs.length === 0 && fallbackFlowSteps.length === 0 && (
              <p className="text-sm text-muted">Flow comparisons render after commit data has loaded.</p>
            )}
          </CardBody>
        </Card>

        <div className="xl:col-span-6">
          <CodeSequenceDiagramPanel
            steps={codeSequenceSteps}
            sequenceGenerationStatus={sequenceGenerationStatus}
            sequenceGenerationError={sequenceGenerationError}
            onRetrySequenceGeneration={onRetrySequenceGeneration}
            highlightedFileIds={highlightedFileIds}
            onSelectFiles={(fileIds) =>
              onSelectFiles({
                fileIds,
                label: "Sequence focus",
              })
            }
          />
        </div>

        <section className="xl:col-span-12 border-t border-border/60 pt-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className={sectionEyebrowClass}>Architecture</p>
              <p className="text-sm font-semibold text-text">Architecture Overview</p>
            </div>
            <p className="font-mono text-xs text-muted">{architectureClusters.length} groups</p>
          </div>
          {architectureClusters.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {architectureClusters.map((cluster, index) => {
                const isHighlighted = cluster.fileIds.some((fileId) => highlightedSet.has(fileId));
                return (
                  <div key={cluster.id} className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        onSelectFiles({
                          fileIds: cluster.fileIds,
                          label: cluster.label,
                        })
                      }
                      className={cn(
                        "rounded-sm px-2 py-1 text-xs transition-colors",
                        "hover:bg-elevated",
                        isHighlighted ? "bg-accent/12 text-accent" : "text-text",
                      )}
                    >
                      {cluster.label}
                      <span className="ml-1 font-mono text-[10px] text-muted">{cluster.fileCount}</span>
                    </button>
                    {index < architectureClusters.length - 1 && <span className="text-xs text-muted">{">"}</span>}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">Architecture nodes render after commit data has loaded.</p>
          )}
        </section>
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
