import type {
  PublishReviewCommentPayload,
  PublishReviewPackage,
  PublishReviewThreadPayload,
} from "../models.ts";

interface PlanThreadEntry {
  readonly filePath: string;
  readonly thread: PublishReviewThreadPayload;
}

function normalizeInlineText(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function comparePlanThreads(left: PlanThreadEntry, right: PlanThreadEntry): number {
  const leftStatusRank = left.thread.status === "open" ? 0 : 1;
  const rightStatusRank = right.thread.status === "open" ? 0 : 1;

  if (leftStatusRank !== rightStatusRank) {
    return leftStatusRank - rightStatusRank;
  }

  const pathCompare = left.filePath.localeCompare(right.filePath);
  if (pathCompare !== 0) {
    return pathCompare;
  }

  if (left.thread.lineNumber !== right.thread.lineNumber) {
    return left.thread.lineNumber - right.thread.lineNumber;
  }

  return left.thread.id.localeCompare(right.thread.id);
}

function describeRequestedChange(comments: readonly PublishReviewCommentPayload[]): string {
  const nonDraftComments = comments.filter((comment) => !comment.isDraft);
  const preferredComment = [...nonDraftComments].reverse().find((comment) => comment.authorType === "human")
    ?? nonDraftComments[nonDraftComments.length - 1]
    ?? comments[comments.length - 1]
    ?? null;

  if (!preferredComment) {
    return "Review the thread and apply the requested change.";
  }

  const normalized = normalizeInlineText(preferredComment.body);
  if (normalized.length === 0) {
    return "Review the thread and apply the requested change.";
  }

  return truncateText(normalized, 220);
}

function formatCommentContext(comment: PublishReviewCommentPayload): string {
  const actor = comment.authorType === "human" ? "Reviewer" : "Agent";
  const body = normalizeInlineText(comment.body);
  const summarizedBody = body.length > 0
    ? truncateText(body, 240)
    : "[empty comment]";
  return `${actor} ${comment.authorId} (${comment.createdAtIso}): ${summarizedBody}`;
}

function flattenThreads(pkg: PublishReviewPackage): readonly PlanThreadEntry[] {
  return pkg.files
    .flatMap((file) => {
      return file.threads.map((thread) => ({
        filePath: file.path,
        thread,
      }));
    })
    .sort(comparePlanThreads);
}

export function createCommentThreadPlanMarkdown(pkg: PublishReviewPackage): string {
  const entries = flattenThreads(pkg);
  const openCount = entries.filter((entry) => entry.thread.status === "open").length;
  const resolvedCount = entries.length - openCount;

  const lines: string[] = [
    "# Comment Thread Plan",
    "",
    `Commit: \`${pkg.commitSha}\``,
    `Generated: ${pkg.generatedAtIso}`,
    `Threads: ${entries.length} total (${openCount} open, ${resolvedCount} resolved)`,
    "",
    "## Agent Instructions",
    "1. Resolve open threads first.",
    "2. Keep changes scoped to each requested fix.",
    "3. Add or update tests whenever behavior changes.",
    "",
    "## Action Items",
  ];

  if (entries.length === 0) {
    lines.push("No comment threads were found for this commit.");
    return lines.join("\n");
  }

  entries.forEach((entry, index) => {
    const nonDraftComments = entry.thread.comments.filter((comment) => !comment.isDraft);
    const contextComments = (nonDraftComments.length > 0 ? nonDraftComments : entry.thread.comments).slice(-3);

    lines.push("");
    lines.push(`### ${index + 1}. ${entry.filePath}:${entry.thread.lineNumber} (${entry.thread.side})`);
    lines.push(`- Thread ID: \`${entry.thread.id}\``);
    lines.push(`- Status: ${entry.thread.status}`);
    lines.push(`- Requested change: ${describeRequestedChange(entry.thread.comments)}`);

    if (contextComments.length > 0) {
      lines.push("- Context:");
      contextComments.forEach((comment) => {
        lines.push(`  - ${formatCommentContext(comment)}`);
      });
    }

    lines.push("- Done when:");
    lines.push("  - The code addresses the requested change.");
    lines.push("  - Related tests are added or updated when behavior changes.");
  });

  return lines.join("\n");
}

