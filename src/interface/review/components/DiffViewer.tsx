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
  const isAdded = line.kind === "add";
  const isRemoved = line.kind === "remove";
  const isContext = line.kind === "context";

  return (
    <div
      key={`${hunkId}-${rowIndex}`}
      className="flex border-b border-border/50 font-mono text-[11px] leading-6"
    >
      <div
        className={cn(
          "flex w-1/2 min-w-0 border-r border-border/50",
          isRemoved && "bg-danger/10",
          isAdded && "bg-canvas",
        )}
      >
        <span className="w-12 shrink-0 select-none border-r border-border/40 px-2 text-right text-muted/80">
          {isAdded ? "" : line.oldLineNumber ?? ""}
        </span>
        <span
          className={cn(
            "w-6 shrink-0 select-none border-r border-border/40 px-1 text-center",
            isRemoved && "bg-danger/15 text-danger",
          )}
        >
          {isRemoved ? "-" : isContext ? " " : ""}
        </span>
        <pre
          className={cn(
            "min-w-0 flex-1 overflow-x-auto px-2 whitespace-pre",
            isRemoved && "text-danger",
            isContext && "text-text/75",
            isAdded && "text-transparent",
          )}
        >
          {isAdded ? "" : line.text}
        </pre>
      </div>

      <div
        className={cn(
          "flex w-1/2 min-w-0",
          isAdded && "bg-positive/10",
          isRemoved && "bg-canvas",
        )}
      >
        <span className="w-12 shrink-0 select-none border-r border-border/40 px-2 text-right text-muted/80">
          {isRemoved ? "" : line.newLineNumber ?? ""}
        </span>
        <span
          className={cn(
            "w-6 shrink-0 select-none border-r border-border/40 px-1 text-center",
            isAdded && "bg-positive/15 text-positive",
          )}
        >
          {isAdded ? "+" : isContext ? " " : ""}
        </span>
        <pre
          className={cn(
            "min-w-0 flex-1 overflow-x-auto px-2 whitespace-pre",
            isAdded && "text-positive",
            isContext && "text-text/75",
            isRemoved && "text-transparent",
          )}
        >
          {isRemoved ? "" : line.text}
        </pre>
      </div>
    </div>
  );
}

function renderUnifiedLine(hunkId: string, rowIndex: number, line: DiffHunk["lines"][number]) {
  const marker = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";

  return (
    <div
      key={`${hunkId}-${rowIndex}`}
      className="grid grid-cols-[3rem_3rem_1.5rem_minmax(0,1fr)] border-b border-border/50 font-mono text-[11px] leading-6"
    >
      <div className="border-r border-border/40 px-2 text-right text-muted/80">{line.oldLineNumber ?? ""}</div>
      <div className="border-r border-border/40 px-2 text-right text-muted/80">{line.newLineNumber ?? ""}</div>
      <div className={cn("border-r border-border/40 px-1 text-center", lineKindClass(line.kind))}>{marker}</div>
      <pre className={cn("min-w-0 overflow-x-auto px-2 whitespace-pre", lineKindClass(line.kind))}>{line.text}</pre>
    </div>
  );
}

export function DiffViewer({ file, hunks, orientation, onOrientationChange }: DiffViewerProps) {
  return (
    <Card className="flex h-full min-h-[28rem] flex-col">
      <CardHeader className="shrink-0 border-b border-border bg-elevated/35 px-3 py-2">
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

            {orientation === "split" && (
              <div className="grid grid-cols-2 border-b border-border/50 bg-surface-subtle/60 text-[10px] uppercase tracking-[0.08em] text-muted">
                <p className="border-r border-border/40 px-3 py-1.5">Old</p>
                <p className="px-3 py-1.5">New</p>
              </div>
            )}

            <div className="overflow-x-auto">
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
