import { Button } from "../../../design-system/index.ts";
import type { PublishReviewPackage } from "../../../application/review/index.ts";
import type { CommitReview, OverviewCard } from "../../../domain/review/index.ts";
import Skeleton from "react-loading-skeleton";

import type { ArchitectureCluster, SequencePair } from "../types.ts";

export interface SummaryPanelProps {
  readonly commit: CommitReview | null;
  readonly overviewCards: readonly OverviewCard[];
  readonly impactClusters: readonly ArchitectureCluster[];
  readonly featureSummaries: readonly SequencePair[];
  readonly publishPackage: PublishReviewPackage | null;
  readonly publishStatus: "idle" | "ready" | "publishing" | "published" | "error";
  readonly canPublish: boolean;
  readonly aiAnalysisStatus: "idle" | "analysing" | "analysed" | "error";
  readonly onOpenImpactFiles: (fileIds: readonly string[]) => void;
  readonly onOpenFeatureFiles: (fileIds: readonly string[]) => void;
  readonly onPublishReview: () => void;
}

function normalizeSummaryText(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim().toLowerCase();
}

export function SummaryPanel({
  commit,
  overviewCards,
  impactClusters,
  featureSummaries,
  publishPackage,
  publishStatus,
  canPublish,
  aiAnalysisStatus,
  onOpenImpactFiles,
  onOpenFeatureFiles,
  onPublishReview,
}: SummaryPanelProps) {
  const publishPreview = publishPackage ? JSON.stringify(publishPackage, null, 2) : null;
  const isSummaryLoading = aiAnalysisStatus === "idle" || aiAnalysisStatus === "analysing";
  const hasDistinctDescription =
    commit !== null &&
    normalizeSummaryText(commit.description).length > 0 &&
    normalizeSummaryText(commit.description) !== normalizeSummaryText(commit.title);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-1">
      <section className="border-b border-border/60 pb-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted">Summary</p>
            <h2 className="font-display text-xl font-semibold tracking-tight text-text">Commit Narrative</h2>
            <p className="text-sm text-muted">
              {commit ? `${commit.title} (${commit.shortSha})` : "No active commit selected."}
            </p>
          </div>
          <Button size="sm" onClick={onPublishReview} disabled={!canPublish}>
            {publishStatus === "publishing" ? "Publishing..." : "Publish Review"}
          </Button>
        </div>

        {commit && (
          <>
            {hasDistinctDescription && (
              <p className="text-sm leading-relaxed text-text">{commit.description}</p>
            )}
            <p className="mt-1.5 text-xs text-muted">
              {commit.authorName} · {commit.authorEmail} · {new Date(commit.authoredAtIso).toLocaleString()}
            </p>
          </>
        )}

        {isSummaryLoading ? (
          <div className="mt-4 space-y-3">
            <Skeleton height={16} width="46%" />
            <Skeleton height={14} count={3} />
            <div className="grid gap-2 md:grid-cols-2">
              <Skeleton height={74} />
              <Skeleton height={74} />
            </div>
          </div>
        ) : overviewCards.length > 0 ? (
          <div className="mt-4 grid gap-x-4 gap-y-3 md:grid-cols-2">
            {overviewCards.map((card) => (
              <article key={card.id}>
                <h3 className="mb-1 text-sm font-semibold text-text">{card.title}</h3>
                <p className="text-sm text-muted">{card.body}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">AI overview cards are generated only when requested.</p>
        )}
        {isSummaryLoading && (
          <p className="mt-3 text-xs text-muted">Generating AI summary in background...</p>
        )}
        {aiAnalysisStatus === "error" && (
          <p className="mt-3 text-xs text-danger">
            AI summary generation failed. Reload the commit or run AI analysis again.
          </p>
        )}
      </section>

      <section className="border-b border-border/60 pb-4">
        <h3 className="text-base font-semibold text-text">Change Impact</h3>
        <p className="text-sm text-muted">Quick view of where most changes landed.</p>

        {isSummaryLoading ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <Skeleton height={54} />
            <Skeleton height={54} />
          </div>
        ) : impactClusters.length > 0 ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {impactClusters.map((cluster) => (
              <button
                key={cluster.id}
                type="button"
                onClick={() => onOpenImpactFiles(cluster.fileIds)}
                className="rounded-md border border-border/60 bg-canvas/55 px-3 py-2 text-left transition-colors hover:border-accent/55 hover:bg-accent/10"
              >
                <p className="text-sm font-semibold text-text">{cluster.label}</p>
                <p className="mt-1 font-mono text-xs text-muted">
                  <span className="text-positive">+{cluster.additions}</span>
                  {" "}
                  <span className="text-danger">-{cluster.deletions}</span>
                  {" "}
                  <span>{cluster.fileCount} files</span>
                </p>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">Impact clusters will appear after analysis loads.</p>
        )}
      </section>

      <section className="border-b border-border/60 pb-4">
        <h3 className="text-base font-semibold text-text">Feature Flow Changes</h3>
        <p className="text-sm text-muted">
          Simple, non-technical before and now snapshots by feature.
        </p>

        {isSummaryLoading ? (
          <div className="mt-3 space-y-2">
            <Skeleton height={96} />
            <Skeleton height={96} />
          </div>
        ) : featureSummaries.length > 0 ? (
          <div className="mt-3 space-y-2">
            {featureSummaries.map((feature) => {
              const fileIds = [...new Set([...feature.before.fileIds, ...feature.after.fileIds])];

              return (
                <article key={feature.id} className="rounded-md border border-border/60 bg-canvas/55 p-3">
                  <p className="text-sm font-semibold text-text">{feature.after.title}</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <div className="rounded-md border border-danger/35 bg-danger/5 p-2">
                      <p className="text-[11px] uppercase tracking-[0.1em] text-danger">Before</p>
                      <p className="mt-1 text-sm text-muted">{feature.before.body}</p>
                    </div>
                    <div className="rounded-md border border-positive/35 bg-positive/5 p-2">
                      <p className="text-[11px] uppercase tracking-[0.1em] text-positive">Now</p>
                      <p className="mt-1 text-sm text-text">{feature.after.body}</p>
                    </div>
                  </div>
                  {fileIds.length > 0 && (
                    <div className="mt-3 flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => onOpenFeatureFiles(fileIds)}
                      >
                        Open Related Files
                      </Button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">AI analysis will appear here once background generation completes.</p>
        )}
      </section>

      {publishPreview && (
        <section>
          <h3 className="text-sm font-semibold text-text">Latest Publish Payload</h3>
          <p className="text-sm text-muted">Mock package preview generated by the publish use-case.</p>
          <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border/60 bg-elevated/35 p-3 font-mono text-xs text-text">
            {publishPreview}
          </pre>
        </section>
      )}
    </div>
  );
}
