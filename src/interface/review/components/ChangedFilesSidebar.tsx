import { useMemo } from "react";

import { Badge, Button, Card, CardBody, CardDescription, CardHeader, CardTitle, Input, StatDelta } from "../../../design-system/index.ts";
import { cn } from "../../../shared/index.ts";
import type { FileFilter } from "../../../application/review/index.ts";
import type { ChangedFile, FileChangeStatus, ThreadStatus } from "../../../domain/review/index.ts";

export interface ChangedFilesSidebarProps {
  readonly files: readonly ChangedFile[];
  readonly allFilesCount: number;
  readonly activeFileId: string | null;
  readonly highlightedFileIds: readonly string[];
  readonly filter: FileFilter;
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
  allFilesCount,
  activeFileId,
  highlightedFileIds,
  filter,
  onQueryChange,
  onToggleStatus,
  onOnlyCommentedChange,
  onOnlyFailingChange,
  onThreadStatusChange,
  onSelectFile,
}: ChangedFilesSidebarProps) {
  const highlightedSet = useMemo(() => new Set(highlightedFileIds), [highlightedFileIds]);

  return (
    <Card className="flex h-full min-h-[24rem] flex-col lg:min-h-0">
      <CardHeader>
        <CardTitle>Changed Files</CardTitle>
        <CardDescription>
          {files.length} visible of {allFilesCount} total
        </CardDescription>
      </CardHeader>
      <CardBody className="flex min-h-0 flex-1 flex-col gap-3">
        <Input
          value={filter.query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search by path"
          aria-label="Search changed files"
        />

        <div className="flex flex-wrap gap-2">
          {statusOptions.map((status) => {
            const isEnabled = filter.statuses.includes(status);

            return (
              <Button
                key={status}
                size="sm"
                variant={isEnabled ? "primary" : "secondary"}
                onClick={() => onToggleStatus(status)}
                className="capitalize"
              >
                {status}
              </Button>
            );
          })}
        </div>

        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={filter.onlyCommented}
            onChange={(event) => onOnlyCommentedChange(event.target.checked)}
          />
          Only files with comments
        </label>

        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={filter.onlyFailingStandards}
            onChange={(event) => onOnlyFailingChange(event.target.checked)}
          />
          Only files with failing standards
        </label>

        <div className="flex items-center gap-2">
          <label htmlFor="threadStatus" className="text-sm text-muted">
            Thread status
          </label>
          <select
            id="threadStatus"
            className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
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
                <p className="break-all font-mono text-xs text-text">{file.path}</p>
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
      </CardBody>
    </Card>
  );
}
