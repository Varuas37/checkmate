import { Badge, Button, Card, CardBody } from "../../../design-system/index.ts";
import type { ChangedFile } from "../../../domain/review/index.ts";
import Skeleton from "react-loading-skeleton";

import type { FileSummary, SequencePair } from "../types.ts";

export interface FileSummaryInspectorProps {
  readonly file: ChangedFile | null;
  readonly fileSummary: FileSummary | null;
  readonly relatedFeatures: readonly SequencePair[];
  readonly aiAnalysisStatus: "idle" | "analysing" | "analysed" | "error";
  readonly onSeeDiff: () => void;
  readonly onOpenFeatureFiles: (fileIds: readonly string[]) => void;
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

function uniqueFileIds(input: readonly string[]): readonly string[] {
  return [...new Set(input.filter((value) => value.trim().length > 0))];
}

export function FileSummaryInspector({
  file,
  fileSummary,
  relatedFeatures,
  aiAnalysisStatus,
  onSeeDiff,
  onOpenFeatureFiles,
}: FileSummaryInspectorProps) {
  if (!file || !fileSummary) {
    return (
      <Card className="h-full rounded-none border-0 shadow-none">
        <CardBody className="flex h-full items-center justify-center text-sm text-muted">
          Select a changed file to review its summary.
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="h-full overflow-auto p-3 xl:p-4">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-3">
        <Card>
          <CardBody className="space-y-3 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-muted">File Summary</p>
                <p className="break-all font-mono text-xs text-text">{fileSummary.path}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={toneForStatus(fileSummary.status)}>{fileSummary.status}</Badge>
                <Button size="sm" onClick={onSeeDiff}>
                  See Diff
                </Button>
              </div>
            </div>

            <p className="text-sm leading-relaxed text-text">{fileSummary.summary}</p>
            <p className="text-sm text-muted">{fileSummary.riskNote}</p>

            <div className="border-t border-border/60 pt-3">
              {(aiAnalysisStatus === "idle" || aiAnalysisStatus === "analysing") && (
                <div className="space-y-2">
                  <Skeleton height={10} width="48%" />
                  <p className="text-xs text-muted">
                    Open the Summary tab to generate AI analysis in background.
                  </p>
                </div>
              )}
              {aiAnalysisStatus === "error" && (
                <p className="text-xs text-danger">
                  AI summary failed. Open Overview and use Refresh AI to retry.
                </p>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3 py-4">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-muted">Feature Context</p>
              <h3 className="font-display text-base font-semibold text-text">Cross-file Feature Summaries</h3>
            </div>

            {relatedFeatures.length === 0 && (
              <p className="text-sm text-muted">
                No cross-file feature summary is linked to this file yet.
              </p>
            )}

            {relatedFeatures.map((feature) => {
              const featureFileIds = uniqueFileIds([...feature.before.fileIds, ...feature.after.fileIds]);
              return (
                <article key={feature.id} className="rounded-md border border-border/60 bg-canvas/55 p-3">
                  <p className="text-sm font-semibold text-text">{feature.after.title}</p>
                  <p className="mt-1 text-sm text-muted">{feature.after.body}</p>
                  <p className="mt-2 text-xs text-muted">Previously: {feature.before.body}</p>
                  {featureFileIds.length > 0 && (
                    <div className="mt-3 flex items-center justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          onOpenFeatureFiles(featureFileIds);
                        }}
                      >
                        Open Related Files
                      </Button>
                    </div>
                  )}
                </article>
              );
            })}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
