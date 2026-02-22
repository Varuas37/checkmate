import type { ChangedFile, CommitReview, FileChangeStatus } from "../../../domain/review/index.ts";
import { cn } from "../../../shared/index.ts";

export interface CommitPanelProps {
  readonly commit: CommitReview | null;
  readonly files: readonly ChangedFile[];
  readonly onOpenFileDiff: (fileId: string) => void;
}

function normalizeText(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim().toLowerCase();
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

function statusClass(status: FileChangeStatus): string {
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

function formatAuthoredAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function CommitPanel({ commit, files, onOpenFileDiff }: CommitPanelProps) {
  if (!commit) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-sm text-muted">
        No active commit selected.
      </div>
    );
  }

  const hasDistinctDescription =
    normalizeText(commit.description).length > 0 &&
    normalizeText(commit.description) !== normalizeText(commit.title);

  return (
    <div className="h-full overflow-auto px-4 py-4">
      <div className="mx-auto w-full max-w-[1100px] space-y-5">
        <section className="border-b border-border/60 pb-4">
          <p className="text-xs uppercase tracking-[0.12em] text-muted">Commit</p>
          <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-text">{commit.title}</h2>
          {hasDistinctDescription && (
            <p className="mt-2 text-sm leading-relaxed text-text">{commit.description}</p>
          )}
          <p className="mt-2 font-mono text-xs text-muted">
            {commit.shortSha} · {commit.authorName} &lt;{commit.authorEmail}&gt; · {formatAuthoredAt(commit.authoredAtIso)}
          </p>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text">Files Changed</h3>
            <p className="text-xs text-muted">{files.length} files</p>
          </div>

          <p className="mb-2 text-xs text-muted">Click any file to jump straight to its diff.</p>

          <div className="overflow-hidden rounded-md border border-border/60">
            <ul className="divide-y divide-border/40">
              {files.map((file) => (
                <li key={file.id}>
                  <button
                    type="button"
                    onClick={() => onOpenFileDiff(file.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                      "hover:bg-elevated/45",
                    )}
                    title={file.path}
                  >
                    <span className={cn("w-4 font-mono text-xs font-semibold", statusClass(file.status))}>
                      {shortStatus(file.status)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-text">{file.path}</span>
                    <span className="font-mono text-[11px] text-positive">+{file.additions}</span>
                    <span className="font-mono text-[11px] text-danger">-{file.deletions}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
