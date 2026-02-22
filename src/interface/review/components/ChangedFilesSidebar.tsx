import { useMemo } from "react";

import { Input } from "../../../design-system/index.ts";
import { cn } from "../../../shared/index.ts";
import type { FileFilter } from "../../../application/review/index.ts";
import type { ChangedFile, FileChangeStatus } from "../../../domain/review/index.ts";

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
  readonly onSelectFile: (fileId: string) => void;
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function folderPath(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function extension(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith("dockerfile")) {
    return "dockerfile";
  }
  return lower.split(".").pop() ?? "";
}

function languageBadge(path: string): { readonly label: string; readonly className: string } {
  const ext = extension(path);

  if (ext === "ts" || ext === "tsx" || ext === "mts" || ext === "cts") {
    return { label: "TS", className: "border-accent/45 bg-accent/12 text-accent" };
  }

  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") {
    return { label: "JS", className: "border-caution/45 bg-caution/12 text-caution" };
  }

  if (ext === "rs") {
    return { label: "RS", className: "border-danger/45 bg-danger/12 text-danger" };
  }

  if (ext === "json") {
    return { label: "{}", className: "border-border bg-surface-subtle text-muted" };
  }

  if (ext === "md" || ext === "mdx") {
    return { label: "MD", className: "border-positive/45 bg-positive/12 text-positive" };
  }

  if (ext === "yml" || ext === "yaml") {
    return { label: "YML", className: "border-caution/45 bg-caution/12 text-caution" };
  }

  if (ext === "toml") {
    return { label: "TOML", className: "border-border bg-surface-subtle text-muted" };
  }

  return { label: "FILE", className: "border-border bg-surface-subtle text-muted" };
}

function shortStatus(status: FileChangeStatus): string {
  if (status === "added") {
    return "A";
  }

  if (status === "deleted") {
    return "D";
  }

  if (status === "renamed") {
    return "R";
  }

  return "M";
}

function statusTextClass(status: FileChangeStatus): string {
  if (status === "added") {
    return "text-positive";
  }

  if (status === "deleted") {
    return "text-danger";
  }

  if (status === "renamed") {
    return "text-caution";
  }

  return "text-accent";
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
  onSelectFile,
}: ChangedFilesSidebarProps) {
  const highlightedSet = useMemo(() => new Set(highlightedFileIds), [highlightedFileIds]);
  const addedCount = useMemo(() => allFiles.filter((file) => file.status === "added").length, [allFiles]);
  const modifiedCount = useMemo(() => allFiles.filter((file) => file.status === "modified").length, [allFiles]);
  const deletedCount = useMemo(() => allFiles.filter((file) => file.status === "deleted").length, [allFiles]);

  return (
    <section className="flex h-full min-h-[24rem] flex-col overflow-hidden bg-surface-subtle/70 md:min-h-0">
      <div className="shrink-0 border-b border-border/60 px-3 py-2">
        <p className="text-[11px] uppercase tracking-[0.12em] text-text">
          {filterLabel ? "Filtered Files" : "Changed Files"}
        </p>
        <p className="text-[11px] text-muted">
          {files.length} visible of {allFilesCount}
        </p>
      </div>

      <div className="shrink-0 space-y-2 border-b border-border/60 px-3 py-2">
        {filterLabel && (
          <div className="flex items-center justify-between gap-2">
            <span className="truncate rounded border border-accent/35 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-accent">
              {filterLabel}
            </span>
            <button
              type="button"
              onClick={onClearFilter}
              className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted transition-colors hover:text-text"
            >
              Clear
            </button>
          </div>
        )}

        <Input
          value={filter.query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Filter files..."
          aria-label="Search changed files"
          className="h-8 text-xs"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-1.5">
        <div className="space-y-0.5">
          {files.map((file) => {
            const isActive = file.id === activeFileId;
            const isHighlighted = highlightedSet.has(file.id);
            const language = languageBadge(file.path);

            return (
              <button
                key={file.id}
                type="button"
                onClick={() => onSelectFile(file.id)}
                className={cn(
                  "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-sm border-l-2 border-transparent px-2 py-1.5 text-left transition-colors",
                  "hover:bg-elevated/50",
                  isActive && "border-l-accent bg-accent/10",
                  isHighlighted && !isActive && "border-l-caution bg-caution/8",
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border font-mono text-[8px] font-semibold uppercase leading-none tracking-[0.08em]",
                        language.className,
                      )}
                    >
                      {language.label}
                    </span>
                    <p className="truncate font-mono text-xs text-text">{fileName(file.path)}</p>
                  </div>
                  <p className="mt-0.5 truncate pl-6 text-[10px] text-muted">
                    {folderPath(file.path) || "/"}
                    {file.previousPath && ` (from ${file.previousPath})`}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 pl-2">
                  <span
                    className={cn(
                      "inline-flex h-4 min-w-4 items-center justify-center rounded border border-border/60 bg-surface px-1 font-mono text-[9px] font-semibold",
                      statusTextClass(file.status),
                    )}
                    title={file.status}
                  >
                    {shortStatus(file.status)}
                  </span>
                  <p className="font-mono text-[10px] text-positive">+{file.additions}</p>
                  <p className="font-mono text-[10px] text-danger">-{file.deletions}</p>
                </div>
              </button>
            );
          })}

          {files.length === 0 && (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
              No files match the active filters.
            </div>
          )}
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-2 border-t border-border/60 px-3 py-2 text-center">
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
    </section>
  );
}
