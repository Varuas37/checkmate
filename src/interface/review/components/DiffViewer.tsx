import type { ChangedFile, DiffHunk, DiffLineKind, DiffOrientation } from "../../../domain/review/index.ts";
import { Badge, Button, Card, CardBody, CardDescription, CardHeader, CardTitle } from "../../../design-system/index.ts";
import { cn } from "../../../shared/index.ts";

export interface DiffViewerProps {
  readonly file: ChangedFile | null;
  readonly hunks: readonly DiffHunk[];
  readonly orientation: DiffOrientation;
  readonly onOrientationChange: (orientation: DiffOrientation) => void;
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
      className="grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem_minmax(0,1fr)] border-b border-border/60 font-mono text-xs"
    >
      <div className="border-r border-border/40 px-2 py-1 text-right text-muted">{hasOld ? line.oldLineNumber : ""}</div>
      <pre
        className={cn(
          "overflow-x-auto border-r border-border/40 px-2 py-1 whitespace-pre-wrap",
          hasOld ? lineKindClass(line.kind) : "bg-surface text-muted",
        )}
      >
        {hasOld ? line.text : ""}
      </pre>
      <div className="border-r border-border/40 px-2 py-1 text-right text-muted">{hasNew ? line.newLineNumber : ""}</div>
      <pre
        className={cn(
          "overflow-x-auto px-2 py-1 whitespace-pre-wrap",
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
    <div key={`${hunkId}-${rowIndex}`} className="grid grid-cols-[3.5rem_3.5rem_auto_minmax(0,1fr)] border-b border-border/60 font-mono text-xs">
      <div className="border-r border-border/40 px-2 py-1 text-right text-muted">{line.oldLineNumber ?? ""}</div>
      <div className="border-r border-border/40 px-2 py-1 text-right text-muted">{line.newLineNumber ?? ""}</div>
      <div className={cn("border-r border-border/40 px-2 py-1 text-center", lineKindClass(line.kind))}>{marker}</div>
      <pre className={cn("overflow-x-auto px-2 py-1 whitespace-pre-wrap", lineKindClass(line.kind))}>{line.text}</pre>
    </div>
  );
}

export function DiffViewer({ file, hunks, orientation, onOrientationChange }: DiffViewerProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Diff Viewer</CardTitle>
            <CardDescription>
              {file ? file.path : "Select a changed file from the sidebar"}
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={orientation === "split" ? "primary" : "secondary"}
              onClick={() => onOrientationChange("split")}
            >
              Vertical
            </Button>
            <Button
              size="sm"
              variant={orientation === "unified" ? "primary" : "secondary"}
              onClick={() => onOrientationChange("unified")}
            >
              Horizontal
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardBody className="space-y-4">
        {!file && (
          <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted">
            Choose a file to inspect the diff.
          </div>
        )}

        {file && hunks.length === 0 && (
          <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted">
            No parsed hunks available for this file.
          </div>
        )}

        {hunks.map((hunk) => (
          <div key={hunk.id} className="overflow-hidden rounded-md border border-border">
            <div className="flex items-center justify-between gap-2 bg-elevated px-3 py-2">
              <Badge tone="accent">{hunk.id}</Badge>
              <p className="font-mono text-xs text-muted">{hunk.header}</p>
            </div>

            <div className="max-h-[32rem] overflow-auto">
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
