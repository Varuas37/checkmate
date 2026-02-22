import type { ChangedFile, DiffHunk, DiffLineKind, DiffOrientation } from "../../../domain/review/index.ts";
import { Badge, Button, Card, CardBody, CardDescription, CardHeader, CardTitle } from "../../../design-system/index.ts";
import { cn } from "../../../shared/index.ts";

export interface DiffViewerProps {
  readonly file: ChangedFile | null;
  readonly hunks: readonly DiffHunk[];
  readonly orientation: DiffOrientation;
  readonly onOrientationChange: (orientation: DiffOrientation) => void;
}

function diffSummaryForFile(file: ChangedFile): string {
  if (file.status === "added") {
    return `New file introduced with ${file.additions} added lines.`;
  }

  if (file.status === "deleted") {
    return `File removed with ${file.deletions} deleted lines.`;
  }

  if (file.status === "renamed") {
    return `File was renamed with +${file.additions}/-${file.deletions} line churn.`;
  }

  return `Modified file with +${file.additions}/-${file.deletions} line churn.`;
}

function lineKindClass(kind: DiffLineKind): string {
  if (kind === "add") {
    return "bg-positive/10 text-positive";
  }

  if (kind === "remove") {
    return "bg-danger/10 text-danger";
  }

  return "bg-surface text-text";
}

function renderSplitLine(hunkId: string, rowIndex: number, line: DiffHunk["lines"][number]) {
  const hasOld = line.kind !== "add";
  const hasNew = line.kind !== "remove";

  return (
    <div
      key={`${hunkId}-${rowIndex}`}
      className="grid grid-cols-[3rem_minmax(0,1fr)_3rem_minmax(0,1fr)] border-b border-border/60 font-mono text-[11px] leading-[1.35]"
    >
      <div className="border-r border-border/40 px-1.5 py-0.5 text-right text-muted">{hasOld ? line.oldLineNumber : ""}</div>
      <pre
        className={cn(
          "min-w-0 overflow-x-auto border-r border-border/40 px-2 py-0.5 whitespace-pre-wrap",
          hasOld ? lineKindClass(line.kind) : "bg-surface text-muted",
        )}
      >
        {hasOld ? line.text : ""}
      </pre>
      <div className="border-r border-border/40 px-1.5 py-0.5 text-right text-muted">{hasNew ? line.newLineNumber : ""}</div>
      <pre
        className={cn(
          "min-w-0 overflow-x-auto px-2 py-0.5 whitespace-pre-wrap",
          hasNew ? lineKindClass(line.kind) : "bg-surface text-muted",
        )}
      >
        {hasNew ? line.text : ""}
      </pre>
    </div>
  );
}

function renderUnifiedLine(hunkId: string, rowIndex: number, line: DiffHunk["lines"][number]) {
  const marker = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";

  return (
    <div
      key={`${hunkId}-${rowIndex}`}
      className="grid grid-cols-[3rem_3rem_auto_minmax(0,1fr)] border-b border-border/60 font-mono text-[11px] leading-[1.35]"
    >
      <div className="border-r border-border/40 px-1.5 py-0.5 text-right text-muted">{line.oldLineNumber ?? ""}</div>
      <div className="border-r border-border/40 px-1.5 py-0.5 text-right text-muted">{line.newLineNumber ?? ""}</div>
      <div className={cn("border-r border-border/40 px-2 py-0.5 text-center", lineKindClass(line.kind))}>{marker}</div>
      <pre className={cn("min-w-0 overflow-x-auto px-2 py-0.5 whitespace-pre-wrap", lineKindClass(line.kind))}>{line.text}</pre>
    </div>
  );
}

export function DiffViewer({ file, hunks, orientation, onOrientationChange }: DiffViewerProps) {
  return (
    <Card className="flex h-full min-h-[28rem] flex-col">
      <CardHeader className="shrink-0 border-b border-border bg-elevated/35 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-sm">Files Diff</CardTitle>
            <CardDescription className="truncate font-mono text-[11px]">
              {file ? file.path : "Select a changed file from the sidebar"}
            </CardDescription>
            {file && (
              <div className="mt-1.5 flex items-center gap-2">
                <Badge tone={file.status === "added" ? "positive" : file.status === "deleted" ? "danger" : "accent"}>
                  {file.status}
                </Badge>
                <p className="font-mono text-xs text-positive">+{file.additions}</p>
                <p className="font-mono text-xs text-danger">-{file.deletions}</p>
              </div>
            )}
            {file && <p className="mt-1 text-xs text-muted">{diffSummaryForFile(file)}</p>}
          </div>

          <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-elevated/30 p-0.5">
            <Button
              size="sm"
              variant={orientation === "split" ? "primary" : "ghost"}
              aria-pressed={orientation === "split"}
              onClick={() => onOrientationChange("split")}
              className="h-7 px-2"
            >
              Split
            </Button>
            <Button
              size="sm"
              variant={orientation === "unified" ? "primary" : "ghost"}
              aria-pressed={orientation === "unified"}
              onClick={() => onOrientationChange("unified")}
              className="h-7 px-2"
            >
              Unified
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardBody className="min-h-0 flex-1 overflow-auto px-0 py-0">
        {!file && (
          <div className="m-3 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted">
            Choose a file to inspect the diff.
          </div>
        )}

        {file && hunks.length === 0 && (
          <div className="m-3 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted">
            No parsed hunks available for this file.
          </div>
        )}

        {hunks.map((hunk) => (
          <div key={hunk.id} className="overflow-hidden border-b border-border bg-canvas last:border-b-0">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-subtle px-3 py-1.5">
              <Badge tone="accent">{hunk.id}</Badge>
              <p className="truncate font-mono text-[11px] text-muted">{hunk.header}</p>
            </div>

            <div>
              {orientation === "split"
                ? hunk.lines.map((line, rowIndex) => renderSplitLine(hunk.id, rowIndex, line))
                : hunk.lines.map((line, rowIndex) => renderUnifiedLine(hunk.id, rowIndex, line))}
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
