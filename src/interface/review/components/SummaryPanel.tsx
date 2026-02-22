import { Badge, Button } from "../../../design-system/index.ts";
import type { PublishReviewPackage } from "../../../application/review/index.ts";
import type { CommitReview, OverviewCard, PublishReviewResult } from "../../../domain/review/index.ts";

import type { FileSummary } from "../types.ts";

export interface SummaryPanelProps {
  readonly commit: CommitReview | null;
  readonly overviewCards: readonly OverviewCard[];
  readonly fileSummaries: readonly FileSummary[];
  readonly publishPackage: PublishReviewPackage | null;
  readonly publishStatus: "idle" | "ready" | "publishing" | "published" | "error";
  readonly publishResult: PublishReviewResult | null;
  readonly publishError: string | null;
  readonly canPublish: boolean;
  readonly onPublishReview: () => void;
}

function toneForStatus(status: FileSummary["status"]): "positive" | "accent" | "danger" | "caution" {
  if (status === "added") {
    return "positive";
  }

  if (status === "modified") {
    return "accent";
  }

  if (status === "deleted") {
    return "danger";
  }

  return "caution";
}

function toneForPublishStatus(status: SummaryPanelProps["publishStatus"]): "positive" | "accent" | "danger" | "neutral" {
  if (status === "published") {
    return "positive";
  }

  if (status === "publishing") {
    return "accent";
  }

  if (status === "error") {
    return "danger";
  }

  return "neutral";
}

export function SummaryPanel({
  commit,
  overviewCards,
  fileSummaries,
  publishPackage,
  publishStatus,
  publishResult,
  publishError,
  canPublish,
  onPublishReview,
}: SummaryPanelProps) {
  const publishPreview = publishPackage ? JSON.stringify(publishPackage, null, 2) : null;

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
            <p className="text-sm leading-relaxed text-text">{commit.description}</p>
            <p className="mt-1.5 text-xs text-muted">
              {commit.authorName} · {commit.authorEmail} · {new Date(commit.authoredAtIso).toLocaleString()}
            </p>
          </>
        )}

        {overviewCards.length > 0 ? (
          <div className="mt-4 grid gap-x-4 gap-y-3 md:grid-cols-2">
            {overviewCards.map((card) => (
              <article key={card.id}>
                <h3 className="mb-1 text-sm font-semibold text-text">{card.title}</h3>
                <p className="text-sm text-muted">{card.body}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">AI overview cards will appear once commit data is loaded.</p>
        )}
      </section>

      <section className="border-b border-border/60 pb-4">
        <h3 className="text-base font-semibold text-text">Claude Publish Status</h3>
        <p className="text-sm text-muted">Current handoff state for the review package.</p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={toneForPublishStatus(publishStatus)}>{publishStatus}</Badge>
          {publishResult && <Badge tone="accent">{publishResult.provider}</Badge>}
        </div>

        {publishError && <p className="mt-2 text-sm text-danger">{publishError}</p>}
        {publishResult && (
          <>
            <p className="mt-2 text-sm text-text">{publishResult.summary}</p>
            <p className="font-mono text-xs text-muted">{publishResult.publicationId}</p>
          </>
        )}
      </section>

      <section className="border-b border-border/60 pb-3">
        <h3 className="text-base font-semibold text-text">Per-file Summaries</h3>
        <p className="text-sm text-muted">High-level summary and risk note for each changed file.</p>

        {fileSummaries.length > 0 ? (
          <div className="mt-2 divide-y divide-border/60">
            {fileSummaries.map((fileSummary) => (
              <article key={fileSummary.fileId} className="py-2.5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="break-all font-mono text-xs text-text">{fileSummary.path}</p>
                  <Badge tone={toneForStatus(fileSummary.status)}>{fileSummary.status}</Badge>
                </div>
                <p className="text-sm text-text">{fileSummary.summary}</p>
                <p className="mt-1 text-sm text-muted">{fileSummary.riskNote}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">No changed files available for summary output.</p>
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
