import { useEffect, useMemo, useState } from "react";

import { Badge, Button, Card, CardBody, CardDescription, CardHeader, CardTitle, Input, Textarea } from "../../../design-system/index.ts";
import type { PublishReviewPackage } from "../../../application/review/index.ts";
import type { ChangedFile, CommentSide, DiffHunk } from "../../../domain/review/index.ts";
import {
  applyCheckmateMentionSuggestion,
  getCheckmateMentionSuggestion,
  hasCheckmateMention,
  stripCheckmateMentions,
} from "../../../shared/index.ts";

import { MarkdownComment } from "./MarkdownComment.tsx";
import type { CreateThreadInput, ThreadViewModel } from "../types.ts";

export interface FileThreadsPanelProps {
  readonly commitId: string | null;
  readonly file: ChangedFile | null;
  readonly hunks: readonly DiffHunk[];
  readonly threads: readonly ThreadViewModel[];
  readonly publishPackage: PublishReviewPackage | null;
  readonly onCreateThread: (input: CreateThreadInput) => { readonly ok: boolean; readonly message: string };
  readonly onAskAgent: (threadId: string, prompt: string) => void;
  readonly onPublishReview: () => void;
}

function toneForThread(status: "open" | "resolved"): "accent" | "positive" {
  return status === "open" ? "accent" : "positive";
}

export function FileThreadsPanel({
  commitId,
  file,
  hunks,
  threads,
  publishPackage,
  onCreateThread,
  onAskAgent,
  onPublishReview,
}: FileThreadsPanelProps) {
  const [selectedHunkId, setSelectedHunkId] = useState("");
  const [lineNumber, setLineNumber] = useState(1);
  const [side, setSide] = useState<CommentSide>("new");
  const [authorId, setAuthorId] = useState("reviewer-1");
  const [body, setBody] = useState("");
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [agentPromptByThreadId, setAgentPromptByThreadId] = useState<Record<string, string>>({});

  useEffect(() => {
    const firstHunk = hunks[0];

    if (!firstHunk) {
      setSelectedHunkId("");
      setLineNumber(1);
      return;
    }

    setSelectedHunkId((current) => {
      if (current.length > 0 && hunks.some((hunk) => hunk.id === current)) {
        return current;
      }

      return firstHunk.id;
    });

    setLineNumber(Math.max(1, firstHunk.newStart));
  }, [hunks]);

  const activeFilePublishPayload = useMemo(() => {
    if (!publishPackage || !file) {
      return null;
    }

    return publishPackage.files.find((entry) => entry.id === file.id) ?? null;
  }, [file, publishPackage]);

  const payloadPreview = useMemo(() => {
    const source = activeFilePublishPayload ?? publishPackage;

    if (!source) {
      return null;
    }

    return JSON.stringify(source, null, 2);
  }, [activeFilePublishPayload, publishPackage]);

  const canCreateThread = Boolean(commitId && file && selectedHunkId.length > 0);
  const bodyMentionSuggestion = useMemo(() => getCheckmateMentionSuggestion(body), [body]);
  const bodyHasMention = useMemo(() => hasCheckmateMention(body), [body]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Comment Threads</CardTitle>
            <CardDescription>
              {file ? `Discussion for ${file.path}` : "Select a file to add threaded comments."}
            </CardDescription>
          </div>
          <Button size="sm" variant="secondary" onClick={onPublishReview} disabled={!commitId}>
            Publish Review
          </Button>
        </div>
      </CardHeader>

      <CardBody className="space-y-4">
        <div className="space-y-2 rounded-md border border-border bg-elevated/40 p-3">
          <h4 className="font-display text-sm font-semibold">New Thread</h4>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted">
              Hunk
              <select
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text"
                value={selectedHunkId}
                onChange={(event) => {
                  const nextHunkId = event.target.value;
                  setSelectedHunkId(nextHunkId);

                  const hunk = hunks.find((item) => item.id === nextHunkId);
                  if (hunk) {
                    setLineNumber(Math.max(1, side === "old" ? hunk.oldStart : hunk.newStart));
                  }
                }}
                disabled={hunks.length === 0}
              >
                {hunks.map((hunk) => (
                  <option key={hunk.id} value={hunk.id}>
                    {hunk.id} {hunk.header}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-xs text-muted">
              Side
              <select
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text"
                value={side}
                onChange={(event) => {
                  const value = event.target.value;

                  if (value === "old" || value === "new") {
                    setSide(value);
                  }
                }}
              >
                <option value="new">new</option>
                <option value="old">old</option>
              </select>
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted">
              Line
              <Input
                type="number"
                min={1}
                value={lineNumber}
                onChange={(event) => setLineNumber(Number.parseInt(event.target.value, 10) || 1)}
              />
            </label>

            <label className="space-y-1 text-xs text-muted">
              Author
              <Input value={authorId} onChange={(event) => setAuthorId(event.target.value)} />
            </label>
          </div>

          <label className="space-y-1 text-xs text-muted">
            Comment
            <Textarea
              rows={4}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if ((event.key === "Tab" || event.key === "ArrowDown") && bodyMentionSuggestion) {
                  event.preventDefault();
                  setBody(applyCheckmateMentionSuggestion(body, bodyMentionSuggestion));
                }
              }}
              placeholder="Describe risk, expected behavior, or requested change..."
            />
            {bodyMentionSuggestion && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-border/70 bg-surface-subtle/60 px-2 py-1 text-[10px] text-text transition-colors hover:border-accent/45 hover:text-accent"
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  setBody(applyCheckmateMentionSuggestion(body, bodyMentionSuggestion));
                }}
              >
                <span className="rounded border border-accent/35 bg-accent/12 px-1 py-0.5 font-mono text-[9px] text-accent">
                  @checkmate
                </span>
                <span>Use mention</span>
              </button>
            )}
            {bodyHasMention && (
              <p className="text-[10px] text-muted">
                Agent mention detected:{" "}
                <span className="rounded border border-accent/35 bg-accent/12 px-1 py-0.5 font-mono text-[9px] text-accent">
                  @checkmate
                </span>
              </p>
            )}
          </label>

          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              onClick={() => {
                if (!canCreateThread) {
                  setFormMessage("Select a commit file and hunk before creating a thread.");
                  return;
                }

                const result = onCreateThread({
                  hunkId: selectedHunkId,
                  side,
                  lineNumber,
                  body,
                  authorId,
                });

                setFormMessage(result.message);

                if (result.ok) {
                  setBody("");
                }
              }}
              disabled={!canCreateThread}
            >
              Add Thread
            </Button>

            {formMessage && <p className="text-xs text-muted">{formMessage}</p>}
          </div>
        </div>

        <div className="space-y-3">
          {threads.map((thread) => (
            <div key={thread.thread.id} className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="space-y-1">
                  <p className="font-mono text-xs text-muted">
                    {thread.thread.anchor.side} line {thread.thread.anchor.lineNumber}
                  </p>
                  <Badge tone={toneForThread(thread.thread.status)}>{thread.thread.status}</Badge>
                </div>
                <Badge tone="neutral">{thread.comments.length} comments</Badge>
              </div>

	          <div className="space-y-2">
	            {thread.comments.map((comment) => (
	                  <div key={comment.id} className="rounded-md bg-elevated/50 px-2 py-2">
	                    <p className="mb-1 text-xs text-muted">
	                      {comment.authorType} · {comment.authorId} · {new Date(comment.createdAtIso).toLocaleString()}
	                    </p>
	                    <MarkdownComment body={comment.body} className="text-sm leading-6 text-text" />
	                  </div>
	                ))}
	              </div>

	              <div className="mt-3 space-y-2">
	                {(() => {
	                  const promptValue = agentPromptByThreadId[thread.thread.id] ?? "";
	                  const mentionSuggestion = getCheckmateMentionSuggestion(promptValue);
	                  const hasMention = hasCheckmateMention(promptValue);

	                  return (
	                    <>
	                      <Input
	                        value={promptValue}
	                  onChange={(event) => {
	                    const nextPrompt = event.target.value;

	                    setAgentPromptByThreadId((current) => ({
	                      ...current,
	                      [thread.thread.id]: nextPrompt,
	                    }));
	                  }}
	                  onKeyDown={(event) => {
	                    if ((event.key === "Tab" || event.key === "ArrowDown") && mentionSuggestion) {
	                      event.preventDefault();
	                      setAgentPromptByThreadId((current) => ({
	                        ...current,
	                        [thread.thread.id]: applyCheckmateMentionSuggestion(promptValue, mentionSuggestion),
	                      }));
	                      return;
	                    }

	                    if (event.key !== "Enter") {
	                      return;
	                    }

	                    if (mentionSuggestion) {
	                      event.preventDefault();
	                      setAgentPromptByThreadId((current) => ({
	                        ...current,
	                        [thread.thread.id]: applyCheckmateMentionSuggestion(promptValue, mentionSuggestion),
	                      }));
	                      return;
	                    }

	                    if (!hasMention) {
	                      return;
	                    }

	                    event.preventDefault();
	                    const prompt = stripCheckmateMentions(promptValue);
	                    onAskAgent(thread.thread.id, prompt);
	                    setAgentPromptByThreadId((current) => ({
	                      ...current,
	                      [thread.thread.id]: "",
	                    }));
	                  }}
	                  placeholder="Reply... Use @checkmate <question> and press Enter"
	                      />
	                      {mentionSuggestion && (
	                        <button
	                          type="button"
	                          className="inline-flex items-center gap-1 rounded border border-border/70 bg-surface-subtle/60 px-2 py-1 text-[10px] text-text transition-colors hover:border-accent/45 hover:text-accent"
	                          onMouseDown={(event) => {
	                            event.preventDefault();
	                          }}
	                          onClick={() => {
	                            setAgentPromptByThreadId((current) => ({
	                              ...current,
	                              [thread.thread.id]: applyCheckmateMentionSuggestion(promptValue, mentionSuggestion),
	                            }));
	                          }}
	                        >
	                          <span className="rounded border border-accent/35 bg-accent/12 px-1 py-0.5 font-mono text-[9px] text-accent">
	                            @checkmate
	                          </span>
	                          <span>Use mention</span>
	                        </button>
	                      )}
	                      {hasMention && (
	                        <p className="text-[10px] text-muted">
	                          Agent mention detected:{" "}
	                          <span className="rounded border border-accent/35 bg-accent/12 px-1 py-0.5 font-mono text-[9px] text-accent">
	                            @checkmate
	                          </span>
	                        </p>
	                      )}
	                    </>
	                  );
	                })()}

	                {thread.askAgentDraft.startsWith("Checkmate is reviewing") && (
	                  <p className="text-xs text-muted">{thread.askAgentDraft}</p>
	                )}
              </div>
            </div>
          ))}

          {threads.length === 0 && (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
              No threads on this file yet.
            </div>
          )}
        </div>

        {payloadPreview && (
          <div className="space-y-2 rounded-md border border-border bg-elevated/40 p-3">
            <h4 className="font-display text-sm font-semibold">Publish Payload Preview</h4>
            <pre className="max-h-56 overflow-auto rounded-md bg-surface p-2 font-mono text-xs text-text">{payloadPreview}</pre>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
