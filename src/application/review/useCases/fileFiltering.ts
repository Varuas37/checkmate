import type { ChangedFile, CommentThread, FileChangeStatus } from "../../../domain/review/index.ts";
import type { FileFilter } from "../models.ts";

export interface ApplyFileFilterInput {
  readonly files: readonly ChangedFile[];
  readonly filter: FileFilter;
  readonly threadIdsByFileId: Readonly<Record<string, readonly string[]>>;
  readonly threadsById: Readonly<Record<string, CommentThread>>;
  readonly failingFileIds: ReadonlySet<string>;
}

function matchesStatus(fileStatus: FileChangeStatus, selectedStatuses: readonly FileChangeStatus[]): boolean {
  if (selectedStatuses.length === 0) {
    return true;
  }

  return selectedStatuses.includes(fileStatus);
}

function matchesQuery(file: ChangedFile, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery.length === 0) {
    return true;
  }

  const pathMatch = file.path.toLowerCase().includes(normalizedQuery);
  const previousPathMatch = file.previousPath?.toLowerCase().includes(normalizedQuery) ?? false;

  return pathMatch || previousPathMatch;
}

function matchesCommentRequirement(
  fileId: string,
  onlyCommented: boolean,
  threadIdsByFileId: Readonly<Record<string, readonly string[]>>,
): boolean {
  if (!onlyCommented) {
    return true;
  }

  const threadIds = threadIdsByFileId[fileId];
  return (threadIds?.length ?? 0) > 0;
}

function matchesThreadStatus(
  fileId: string,
  threadStatus: FileFilter["threadStatus"],
  threadIdsByFileId: Readonly<Record<string, readonly string[]>>,
  threadsById: Readonly<Record<string, CommentThread>>,
): boolean {
  if (threadStatus === "all") {
    return true;
  }

  const threadIds = threadIdsByFileId[fileId] ?? [];
  return threadIds.some((threadId) => threadsById[threadId]?.status === threadStatus);
}

function matchesFailingOnly(
  fileId: string,
  onlyFailingStandards: boolean,
  failingFileIds: ReadonlySet<string>,
): boolean {
  if (!onlyFailingStandards) {
    return true;
  }

  return failingFileIds.has(fileId);
}

export function applyFileFilter(input: ApplyFileFilterInput): readonly ChangedFile[] {
  return input.files.filter((file) => {
    return (
      matchesStatus(file.status, input.filter.statuses) &&
      matchesQuery(file, input.filter.query) &&
      matchesCommentRequirement(file.id, input.filter.onlyCommented, input.threadIdsByFileId) &&
      matchesThreadStatus(file.id, input.filter.threadStatus, input.threadIdsByFileId, input.threadsById) &&
      matchesFailingOnly(file.id, input.filter.onlyFailingStandards, input.failingFileIds)
    );
  });
}
