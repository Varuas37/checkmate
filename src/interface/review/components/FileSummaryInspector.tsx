import { useState } from "react";

import { Button } from "../../../design-system/index.ts";
import type { ChangedFile } from "../../../domain/review/index.ts";
import Skeleton from "react-loading-skeleton";

import type { FileSummary, SequencePair } from "../types.ts";
import { MarkdownComment } from "./MarkdownComment.tsx";

export interface FileSummaryInspectorProps {
  readonly file: ChangedFile | null;
  readonly fileSummary: FileSummary | null;
  readonly relatedFeatures: readonly SequencePair[];
  readonly aiAnalysisStatus: "idle" | "analysing" | "analysed" | "error";
  readonly onOpenFeatureFiles: (fileIds: readonly string[]) => void;
}

function uniqueFileIds(input: readonly string[]): readonly string[] {
  return [...new Set(input.filter((value) => value.trim().length > 0))];
}

function uniqueStatements(input: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const statements: string[] = [];

  input.forEach((value) => {
    const normalized = value.replaceAll(/\s+/g, " ").trim();
    if (normalized.length === 0) {
      return;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    statements.push(normalized);
  });

  return statements;
}

export function FileSummaryInspector({
  file,
  fileSummary,
  relatedFeatures,
  aiAnalysisStatus,
  onOpenFeatureFiles,
}: FileSummaryInspectorProps) {
  const [isFileTechnicalExpanded, setIsFileTechnicalExpanded] = useState(false);
  const [expandedFeatureIds, setExpandedFeatureIds] = useState<Readonly<Record<string, boolean>>>({});

  if (!file || !fileSummary) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-muted">
        Select a changed file to review its summary.
      </div>
    );
  }

  const beforeStatements = uniqueStatements(relatedFeatures.map((feature) => feature.before.body)).slice(0, 2);
  const nowStatements = uniqueStatements(relatedFeatures.map((feature) => feature.after.body)).slice(0, 2);
  const beforeNarrative = beforeStatements.length > 0
    ? beforeStatements
    : ["This area had less clear behavior guidance before this update."];
  const nowNarrative = nowStatements.length > 0
    ? nowStatements
    : [fileSummary.summary];
  const overallBehavior = fileSummary.summary.replaceAll(/\s+/g, " ").trim();
  const riskNote = fileSummary.riskNote.replaceAll(/\s+/g, " ").trim();
  const fileTechnicalDetails = fileSummary.technicalDetails?.trim() ?? "";
  const showRiskNote = riskNote.length > 0 && riskNote.toLowerCase() !== "low risk.";
  const aiLoading = aiAnalysisStatus === "idle" || aiAnalysisStatus === "analysing";
  const beforeSummaryMarkdown = [
    "### What Used To Happen",
    ...beforeNarrative.map((line) => `- ${line}`),
  ].join("\n");
  const updatedSummaryMarkdown = [
    "### What Happens Now",
    ...nowNarrative.map((line) => `- ${line}`),
    "",
    "### Overall Behavior",
    overallBehavior,
    ...(showRiskNote ? ["", `**Watch-outs:** ${riskNote}`] : []),
  ].join("\n");

  return (
    <div className="h-full overflow-auto p-3">
      <div className="space-y-3">
        <article className="overflow-hidden rounded-md border border-border/60 bg-canvas/55">
          <div className="grid border-b border-border/60 text-[11px] uppercase tracking-[0.1em] md:grid-cols-2">
            <p className="border-b border-border/60 px-3 py-2 text-muted md:border-b-0 md:border-r md:border-border/60">
              Original
            </p>
            <p className="px-3 py-2 text-muted">Updated</p>
          </div>
          <div className="grid md:grid-cols-2">
            <div className="border-b border-border/60 px-3 py-3 md:border-b-0 md:border-r md:border-border/60">
              <MarkdownComment body={beforeSummaryMarkdown} className="text-sm leading-6 text-text" />
            </div>
            <div className="px-3 py-3">
              <MarkdownComment body={updatedSummaryMarkdown} className="text-sm leading-6 text-text" />
              <div className="mt-2 flex items-center justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() => setIsFileTechnicalExpanded((current) => !current)}
                >
                  {isFileTechnicalExpanded ? "Collapse" : "Expand"} Technical Details
                </Button>
              </div>
            </div>
          </div>
          {isFileTechnicalExpanded && (
            <div className="border-t border-border/60 px-3 py-3">
              <p className="mb-1 text-[11px] uppercase tracking-[0.1em] text-muted">Technical Details</p>
              {fileTechnicalDetails.length > 0 ? (
                <MarkdownComment body={fileTechnicalDetails} className="text-sm leading-6 text-text" />
              ) : (
                <p className="text-sm text-muted">Technical detail generation is not available for this analysis yet.</p>
              )}
            </div>
          )}
        </article>

        <article className="overflow-hidden rounded-md border border-border/60 bg-canvas/55">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="text-xs uppercase tracking-[0.12em] text-muted">Feature Flows</p>
            <p className="text-sm text-text">Related behavior changes connected to this file.</p>
          </div>

          {relatedFeatures.length === 0 && (
            <p className="px-3 py-3 text-sm text-muted">
              No cross-file feature summary is linked to this file yet.
            </p>
          )}

          {relatedFeatures.length > 0 && (
            <div className="divide-y divide-border/60">
              {relatedFeatures.map((feature) => {
                const featureFileIds = uniqueFileIds([...feature.before.fileIds, ...feature.after.fileIds]);
                const beforeFeatureMarkdown = [
                  `### ${feature.after.title}`,
                  feature.before.body,
                ].join("\n\n");
                const updatedFeatureMarkdown = [
                  `### ${feature.after.title}`,
                  feature.after.body,
                ].join("\n\n");
                const featureTechnicalDetails = feature.technicalDetails?.trim() ?? "";
                const isExpanded = expandedFeatureIds[feature.id] === true;

                return (
                  <article key={feature.id}>
                    <div className="grid md:grid-cols-2">
                      <div className="border-b border-border/60 px-3 py-3 md:border-b-0 md:border-r md:border-border/60">
                        <MarkdownComment body={beforeFeatureMarkdown} className="text-sm leading-6 text-text" />
                      </div>
                      <div className="px-3 py-3">
                        <MarkdownComment body={updatedFeatureMarkdown} className="text-sm leading-6 text-text" />
                        <div className="mt-2 flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => {
                              setExpandedFeatureIds((current) => ({
                                ...current,
                                [feature.id]: !current[feature.id],
                              }));
                            }}
                          >
                            {isExpanded ? "Collapse" : "Expand"} Technical Details
                          </Button>
                          {featureFileIds.length > 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              onClick={() => {
                                onOpenFeatureFiles(featureFileIds);
                              }}
                            >
                              Open Related Files
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="border-t border-border/60 px-3 py-3">
                        <p className="mb-1 text-[11px] uppercase tracking-[0.1em] text-muted">Technical Details</p>
                        {featureTechnicalDetails.length > 0 ? (
                          <MarkdownComment body={featureTechnicalDetails} className="text-sm leading-6 text-text" />
                        ) : (
                          <p className="text-sm text-muted">
                            Technical detail generation is not available for this feature yet.
                          </p>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </article>

        <div className="border-t border-border/60 pt-2">
          {aiLoading && (
            <div className="space-y-2">
              <Skeleton height={10} width="48%" />
              <p className="text-xs text-muted">
                Generating AI analysis in the background for this commit.
              </p>
            </div>
          )}
          {aiAnalysisStatus === "error" && (
            <p className="text-xs text-danger">
              AI summary failed. Reload the commit or run AI analysis again.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
