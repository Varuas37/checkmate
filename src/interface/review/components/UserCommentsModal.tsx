import { Badge, Modal } from "../../../design-system/index.ts";
import type { CommentAuthorSummary, CommitCommentActivity } from "../types.ts";

export interface UserCommentsModalProps {
  readonly open: boolean;
  readonly authors: readonly CommentAuthorSummary[];
  readonly selectedAuthorKey: string | null;
  readonly comments: readonly CommitCommentActivity[];
  readonly onSelectAuthorKey: (authorKey: string) => void;
  readonly onClose: () => void;
}

function formatAuthorLabel(author: CommentAuthorSummary): string {
  const role = author.authorType === "agent" ? "agent" : "human";
  return `${author.authorId} (${role}, ${author.commentCount})`;
}

export function UserCommentsModal({
  open,
  authors,
  selectedAuthorKey,
  comments,
  onSelectAuthorKey,
  onClose,
}: UserCommentsModalProps) {
  const selectedAuthor =
    (selectedAuthorKey
      ? authors.find((author) => author.authorKey === selectedAuthorKey)
      : null) ?? authors[0] ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Comments By User"
      panelClassName="w-[min(96vw,72rem)] max-w-none"
    >
      <div className="space-y-3">
        {authors.length === 0 ? (
          <p className="text-sm text-muted">No comments found for this commit yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="commentAuthorFilter" className="font-mono text-[11px] uppercase text-muted">
                User
              </label>
              <select
                id="commentAuthorFilter"
                value={selectedAuthor?.authorKey ?? ""}
                onChange={(event) => onSelectAuthorKey(event.target.value)}
                className="h-8 min-w-[22rem] max-w-full rounded-md border border-border bg-canvas px-2 font-mono text-xs text-text shadow-inset"
              >
                {authors.map((author) => (
                  <option key={author.authorKey} value={author.authorKey}>
                    {formatAuthorLabel(author)}
                  </option>
                ))}
              </select>
              {selectedAuthor && (
                <Badge tone={selectedAuthor.authorType === "agent" ? "caution" : "accent"}>
                  {selectedAuthor.authorType}
                </Badge>
              )}
            </div>

            <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
              {comments.length === 0 ? (
                <p className="text-sm text-muted">No comments from this user in the selected commit.</p>
              ) : (
                comments.map((comment) => (
                  <article
                    key={comment.id}
                    className="space-y-1.5 rounded-md border border-border/60 bg-canvas/60 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-xs text-text">
                        {comment.filePath}:{comment.lineNumber} ({comment.side})
                      </p>
                      <Badge tone={comment.threadStatus === "open" ? "caution" : "positive"}>
                        {comment.threadStatus}
                      </Badge>
                      <p className="text-xs text-muted">
                        {new Date(comment.createdAtIso).toLocaleString()}
                      </p>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-text">{comment.body}</p>
                  </article>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
