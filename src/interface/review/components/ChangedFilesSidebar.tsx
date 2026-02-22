import { useMemo } from "react";

import { Badge, Button, Card, CardBody, CardDescription, CardHeader, CardTitle, Input, StatDelta } from "../../../design-system/index.ts";
import { cn } from "../../../shared/index.ts";
import type { FileFilter } from "../../../application/review/index.ts";
import type { ChangedFile, FileChangeStatus, ThreadStatus } from "../../../domain/review/index.ts";

export interface ChangedFilesSidebarProps {
  readonly files: readonly ChangedFile[];
  readonly allFiles: readonly ChangedFile[];
  readonly allFilesCount: number;
  readonly activeFileId: string | null;
  readonly highlightedFileIds: readonly string[];
  readonly filter: FileFilter;
  readonly filterLabel: string | null;
  readonly onClearFilter: () => void;
  readonly onQueryChange: (query: string) => void;
  readonly onToggleStatus: (status: FileChangeStatus) => void;
  readonly onOnlyCommentedChange: (enabled: boolean) => void;
  readonly onOnlyFailingChange: (enabled: boolean) => void;
  readonly onThreadStatusChange: (status: ThreadStatus | "all") => void;
  readonly onSelectFile: (fileId: string) => void;
}

const statusOptions: readonly FileChangeStatus[] = ["added", "modified", "deleted", "renamed"];

function toneForStatus(status: FileChangeStatus): "positive" | "accent" | "danger" | "caution" {
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

export function ChangedFilesSidebar({
  files,
  allFiles,
  allFilesCount,
  activeFileId,
  highlightedFileIds,
  filter,
  filterLabel,
  onClearFilter,
  onQueryChange,
  onToggleStatus,
  onOnlyCommentedChange,
  onOnlyFailingChange,
  onThreadStatusChange,
  onSelectFile,
}: ChangedFilesSidebarProps) {
  const highlightedSet = useMemo(() => new Set(highlightedFileIds), [highlightedFileIds]);
  const addedCount = useMemo(() => allFiles.filter((file) => file.status === "added").length, [allFiles]);
  const modifiedCount = useMemo(() => allFiles.filter((file) => file.status === "modified").length, [allFiles]);
  const deletedCount = useMemo(() => allFiles.filter((file) => file.status === "deleted").length, [allFiles]);

  return (
    <Card className="flex h-full min-h-[24rem] flex-col rounded-none border-0 shadow-none lg:min-h-0">
      <CardHeader className="border-b border-border/80 bg-surface-subtle">
        <CardTitle className="text-xs uppercase tracking-[0.12em]">
          {filterLabel ? "Filtered Files" : "Changed Files"}
        </CardTitle>
        <CardDescription className="text-xs">
          {files.length} visible of {allFilesCount}
        </CardDescription>
      </CardHeader>

      {filterLabel && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-accent/6 px-4 py-2">
          <Badge tone="accent">{filterLabel}</Badge>
          <button
            type="button"
            onClick={onClearFilter}
            className="rounded border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted transition-colors hover:text-text"
          >
            Clear
          </button>
        </div>
      )}

      <CardBody className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3">
        <Input
          value={filter.query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Filter files..."
          aria-label="Search changed files"
          className="h-8 text-xs"
        />

        <div className="flex flex-wrap gap-1.5">
          {statusOptions.map((status) => {
            const isEnabled = filter.statuses.includes(status);

            return (
              <Button
                key={status}
                size="sm"
                variant={isEnabled ? "primary" : "secondary"}
                onClick={() => onToggleStatus(status)}
                className="h-7 px-2 capitalize"
              >
                {status}
              </Button>
            );
          })}
        </div>

        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={filter.onlyCommented}
            onChange={(event) => onOnlyCommentedChange(event.target.checked)}
          />
          Commented only
        </label>

        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={filter.onlyFailingStandards}
            onChange={(event) => onOnlyFailingChange(event.target.checked)}
          />
          Failing standards only
        </label>

        <div className="flex items-center gap-2">
          <label htmlFor="threadStatus" className="text-sm text-muted">
            Thread status
          </label>
          <select
            id="threadStatus"
            className="h-7 rounded-md border border-border bg-canvas px-2 text-xs"
            value={filter.threadStatus}
            onChange={(event) => {
              const value = event.target.value;

              if (value === "open" || value === "resolved" || value === "all") {
                onThreadStatusChange(value);
              }
            }}
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
          {files.map((file) => {
            const isActive = file.id === activeFileId;
            const isHighlighted = highlightedSet.has(file.id);

            return (
              <button
                key={file.id}
                type="button"
                onClick={() => onSelectFile(file.id)}
                className={cn(
                  "w-full rounded-md border px-3 py-2 text-left transition-colors",
                  "hover:border-accent/50 hover:bg-elevated",
                  isActive && "border-accent bg-accent/10",
                  isHighlighted && !isActive && "border-caution/70",
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Badge tone={toneForStatus(file.status)}>{file.status}</Badge>
                  <StatDelta additions={file.additions} deletions={file.deletions} />
                </div>
                <p className="truncate font-mono text-xs text-text">{file.path.split("/").pop() ?? file.path}</p>
                <p className="truncate text-[11px] text-muted">{file.path.split("/").slice(0, -1).join("/")}</p>
                {file.previousPath && <p className="mt-1 text-xs text-muted">from {file.previousPath}</p>}
              </button>
            );
          })}

          {files.length === 0 && (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
              No files match the active filters.
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-border pt-2 text-center">
          <div>
            <p className="font-mono text-xs text-positive">{addedCount}</p>
            <p className="text-[10px] uppercase tracking-[0.08em] text-muted">Added</p>
          </div>
          <div>
            <p className="font-mono text-xs text-accent">{modifiedCount}</p>
            <p className="text-[10px] uppercase tracking-[0.08em] text-muted">Modified</p>
          </div>
          <div>
            <p className="font-mono text-xs text-danger">{deletedCount}</p>
            <p className="text-[10px] uppercase tracking-[0.08em] text-muted">Deleted</p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
