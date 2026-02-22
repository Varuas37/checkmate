import { Badge, Button, Card, CardBody, CardDescription, CardHeader, CardTitle } from "../../../design-system/index.ts";
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
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-3">
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.16em] text-muted">Summary</p>
              <CardTitle>Commit Narrative</CardTitle>
              <CardDescription>{commit ? `${commit.title} (${commit.shortSha})` : "No active commit selected."}</CardDescription>
            </div>
            <Button size="sm" onClick={onPublishReview} disabled={!canPublish}>
              {publishStatus === "publishing" ? "Publishing..." : "Publish Review"}
            </Button>
          </div>

          {commit && (
            <div className="rounded-md border border-border bg-elevated/30 p-3">
              <p className="text-sm leading-relaxed text-text">{commit.description}</p>
              <p className="mt-2 text-xs text-muted">
                {commit.authorName} · {commit.authorEmail} · {new Date(commit.authoredAtIso).toLocaleString()}
              </p>
            </div>
          )}

          <div className="grid gap-2 md:grid-cols-2">
            {overviewCards.map((card) => (
              <div key={card.id} className="rounded-md border border-border bg-surface px-3 py-2">
                <h4 className="mb-1 font-display text-sm font-semibold text-text">{card.title}</h4>
                <p className="text-sm text-muted">{card.body}</p>
              </div>
            ))}

            {overviewCards.length === 0 && (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
                AI overview cards will appear once commit data is loaded.
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="border-b-0 pb-0">
          <CardTitle>Claude Publish Status</CardTitle>
          <CardDescription>Current handoff state for the review package.</CardDescription>
        </CardHeader>
        <CardBody className="space-y-2 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={publishStatus === "published" ? "positive" : publishStatus === "error" ? "danger" : publishStatus === "publishing" ? "accent" : "neutral"}>
              {publishStatus}
            </Badge>
            {publishResult && <Badge tone="accent">{publishResult.provider}</Badge>}
          </div>

          {publishError && <p className="text-sm text-danger">{publishError}</p>}

          {publishResult && (
            <div className="rounded-md border border-border bg-elevated/30 p-3">
              <p className="text-sm text-text">{publishResult.summary}</p>
              <p className="mt-1 font-mono text-xs text-muted">{publishResult.publicationId}</p>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="border-b-0 pb-0">
          <CardTitle>Per-file Summaries</CardTitle>
          <CardDescription>High-level summary and risk note for each changed file.</CardDescription>
        </CardHeader>
        <CardBody className="space-y-0">
          {fileSummaries.map((fileSummary) => (
            <div key={fileSummary.fileId} className="border-b border-border py-3 last:border-b-0">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="break-all font-mono text-xs text-text">{fileSummary.path}</p>
                <Badge tone={toneForStatus(fileSummary.status)}>{fileSummary.status}</Badge>
              </div>
              <p className="text-sm text-text">{fileSummary.summary}</p>
              <p className="mt-1 text-sm text-muted">{fileSummary.riskNote}</p>
            </div>
          ))}

          {fileSummaries.length === 0 && (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
              No changed files available for summary output.
            </p>
          )}
        </CardBody>
      </Card>

      {publishPreview && (
        <Card>
          <CardHeader className="border-b-0 pb-0">
            <CardTitle>Latest Publish Payload</CardTitle>
            <CardDescription>Mock package preview generated by the publish use-case.</CardDescription>
          </CardHeader>
          <CardBody className="pt-2">
            <pre className="max-h-72 overflow-auto rounded-md bg-elevated p-3 font-mono text-xs text-text">{publishPreview}</pre>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
