import type {
  ChangedFile,
  CommitFileVersions,
  CommitReviewAggregate,
  CommitReviewDataSource,
  DiffHunk,
  DiffLine,
  FileChangeStatus,
  ListRepositoryCommitsInput,
  LoadCommitReviewInput,
  OverviewCard,
  ReadCommitFileVersionsInput,
  RepositoryCommitSummary,
} from "../../domain/review/index.ts";

interface TauriCommitDetails {
  readonly hash: string;
  readonly shortHash: string;
  readonly title: string;
  readonly description: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authoredAtIso: string;
  readonly parentCommitShas: readonly string[];
}

interface TauriCommitFileVersions {
  readonly oldContent?: string | null;
  readonly newContent?: string | null;
}

interface ParsedHunk {
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
}

interface ParsedFileSection {
  readonly oldPath: string;
  readonly newPath: string;
  readonly status: FileChangeStatus;
  readonly previousPath?: string;
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: readonly ParsedHunk[];
}

interface MutableParsedHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
  oldCursor: number;
  newCursor: number;
}

interface MutableParsedFileSection {
  oldPath: string;
  newPath: string;
  status: FileChangeStatus;
  previousPath?: string;
  additions: number;
  deletions: number;
  hunks: ParsedHunk[];
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeTauri<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function messageForError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}

function normalizePath(rawPath: string): string {
  const withoutQuotes =
    rawPath.startsWith('"') && rawPath.endsWith('"') ? rawPath.slice(1, rawPath.length - 1) : rawPath;
  return withoutQuotes.trim();
}

function parseDiffHeader(line: string): { oldPath: string; newPath: string } | null {
  const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);

  if (!match) {
    return null;
  }

  return {
    oldPath: normalizePath(match[1] ?? ""),
    newPath: normalizePath(match[2] ?? ""),
  };
}

function parseHunkHeader(line: string): MutableParsedHunk | null {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);

  if (!match) {
    return null;
  }

  const oldStart = Number.parseInt(match[1] ?? "0", 10);
  const oldLines = Number.parseInt(match[2] ?? "1", 10);
  const newStart = Number.parseInt(match[3] ?? "0", 10);
  const newLines = Number.parseInt(match[4] ?? "1", 10);
  const headingSuffix = match[5]?.trim();
  const header = `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@${headingSuffix ? ` ${headingSuffix}` : ""}`;

  return {
    header,
    oldStart,
    oldLines,
    newStart,
    newLines,
    lines: [],
    oldCursor: oldStart,
    newCursor: newStart,
  };
}

function parsePatchSections(patch: string): readonly ParsedFileSection[] {
  const lines = patch.split(/\r?\n/);
  const sections: ParsedFileSection[] = [];

  let currentSection: MutableParsedFileSection | null = null;
  let currentHunk: MutableParsedHunk | null = null;

  const flushHunk = () => {
    if (!currentSection || !currentHunk) {
      return;
    }

    currentSection.hunks.push({
      header: currentHunk.header,
      oldStart: currentHunk.oldStart,
      oldLines: currentHunk.oldLines,
      newStart: currentHunk.newStart,
      newLines: currentHunk.newLines,
      lines: [...currentHunk.lines],
    });
    currentHunk = null;
  };

  const flushSection = () => {
    if (!currentSection) {
      return;
    }

    flushHunk();
    const nextSection: ParsedFileSection = {
      oldPath: currentSection.oldPath,
      newPath: currentSection.newPath,
      status: currentSection.status,
      additions: currentSection.additions,
      deletions: currentSection.deletions,
      hunks: [...currentSection.hunks],
      ...(currentSection.previousPath
        ? {
            previousPath: currentSection.previousPath,
          }
        : {}),
    };
    sections.push(nextSection);
    currentSection = null;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flushSection();

      const header = parseDiffHeader(line);
      if (!header) {
        continue;
      }

      currentSection = {
        oldPath: header.oldPath,
        newPath: header.newPath,
        status: "modified",
        additions: 0,
        deletions: 0,
        hunks: [],
      };
      continue;
    }

    if (!currentSection) {
      continue;
    }

    if (line.startsWith("new file mode ")) {
      currentSection.status = "added";
      continue;
    }

    if (line.startsWith("deleted file mode ")) {
      currentSection.status = "deleted";
      continue;
    }

    if (line.startsWith("rename from ")) {
      currentSection.previousPath = normalizePath(line.slice("rename from ".length));
      currentSection.status = "renamed";
      continue;
    }

    if (line.startsWith("rename to ")) {
      currentSection.newPath = normalizePath(line.slice("rename to ".length));
      currentSection.status = "renamed";
      continue;
    }

    if (line.startsWith("@@ ")) {
      flushHunk();
      currentHunk = parseHunkHeader(line);
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (line.startsWith("\\ No newline at end of file")) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentSection.additions += 1;
      currentHunk.lines.push({
        kind: "add",
        newLineNumber: currentHunk.newCursor,
        text: line.slice(1),
      });
      currentHunk.newCursor += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      currentSection.deletions += 1;
      currentHunk.lines.push({
        kind: "remove",
        oldLineNumber: currentHunk.oldCursor,
        text: line.slice(1),
      });
      currentHunk.oldCursor += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      currentHunk.lines.push({
        kind: "context",
        oldLineNumber: currentHunk.oldCursor,
        newLineNumber: currentHunk.newCursor,
        text: line.slice(1),
      });
      currentHunk.oldCursor += 1;
      currentHunk.newCursor += 1;
    }
  }

  flushSection();
  return sections;
}

function buildOverviewCards(commitId: string, files: readonly ChangedFile[]): readonly OverviewCard[] {
  const totalAdditions = files.reduce((count, file) => count + file.additions, 0);
  const totalDeletions = files.reduce((count, file) => count + file.deletions, 0);
  const largestChange = [...files]
    .sort((left, right) => right.additions + right.deletions - (left.additions + left.deletions))[0];

  const cards: OverviewCard[] = [
    {
      id: `${commitId}-summary`,
      commitId,
      kind: "summary",
      title: "Commit Change Summary",
      body: `${files.length} files changed with +${totalAdditions}/-${totalDeletions}.`,
      rank: 1,
    },
  ];

  if (largestChange) {
    cards.push({
      id: `${commitId}-impact`,
      commitId,
      kind: "impact",
      title: "Highest Churn File",
      body: `${largestChange.path} (+${largestChange.additions}/-${largestChange.deletions}).`,
      rank: 2,
    });
  }

  cards.push({
    id: `${commitId}-risk`,
    commitId,
    kind: "risk",
    title: "Review Focus",
    body: "Validate architectural intent and ensure no unintended side effects around touched files.",
    rank: 3,
  });

  return cards;
}

function buildAggregateFromPatch(
  repositoryPath: string,
  commitDetails: TauriCommitDetails,
  patch: string,
): CommitReviewAggregate {
  const commitId = `commit-${commitDetails.hash}`;
  const parsedSections = parsePatchSections(patch);

  const files: ChangedFile[] = [];
  const hunks: DiffHunk[] = [];

  parsedSections.forEach((section, fileIndex) => {
    const resolvedPath =
      section.status === "deleted"
        ? section.oldPath
        : section.newPath === "/dev/null"
          ? section.oldPath
          : section.newPath;
    const fileId = `${commitId}-file-${fileIndex + 1}`;

    const changedFile: ChangedFile = {
      id: fileId,
      commitId,
      path: resolvedPath,
      status: section.status,
      additions: section.additions,
      deletions: section.deletions,
      ...(section.status === "renamed"
        ? {
            previousPath: section.previousPath ?? section.oldPath,
          }
        : {}),
    };

    files.push(changedFile);

    section.hunks.forEach((hunk, hunkIndex) => {
      hunks.push({
        id: `${fileId}-hunk-${hunkIndex + 1}`,
        fileId,
        header: hunk.header,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines: hunk.lines,
      });
    });
  });

  const commit = {
    id: commitId,
    repositoryPath,
    commitSha: commitDetails.hash,
    shortSha: commitDetails.shortHash,
    title: commitDetails.title,
    description: commitDetails.description,
    authorName: commitDetails.authorName,
    authorEmail: commitDetails.authorEmail,
    authoredAtIso: commitDetails.authoredAtIso,
    parentCommitShas: [...commitDetails.parentCommitShas],
  };

  return {
    commit,
    files,
    hunks,
    threads: [],
    comments: [],
    overviewCards: buildOverviewCards(commitId, files),
    standardsRules: [],
    standardsResults: [],
  };
}

function normalizeCommitList(items: readonly RepositoryCommitSummary[]): readonly RepositoryCommitSummary[] {
  return items.map((item) => ({
    hash: item.hash,
    shortHash: item.shortHash,
    summary: item.summary,
    author: item.author,
    authorEmail: item.authorEmail,
    authoredAtIso: item.authoredAtIso,
  }));
}

export interface TauriGitCommitReviewDataSourceOptions {
  readonly fallbackDataSource?: CommitReviewDataSource;
}

export class TauriGitCommitReviewDataSource implements CommitReviewDataSource {
  readonly #fallbackDataSource: CommitReviewDataSource | null;

  constructor(options: TauriGitCommitReviewDataSourceOptions = {}) {
    this.#fallbackDataSource = options.fallbackDataSource ?? null;
  }

  async loadCommitReview(input: LoadCommitReviewInput): Promise<CommitReviewAggregate> {
    if (!isTauriRuntime()) {
      if (!this.#fallbackDataSource) {
        throw new Error("Real git commit loading requires Tauri runtime.");
      }
      return this.#fallbackDataSource.loadCommitReview(input);
    }

    try {
      const [commitDetails, patch] = await Promise.all([
        invokeTauri<TauriCommitDetails>("read_commit_details", {
          repoPath: input.repositoryPath,
          commitHash: input.commitSha,
        }),
        invokeTauri<string>("read_commit_patch", {
          repoPath: input.repositoryPath,
          commitHash: input.commitSha,
        }),
      ]);

      return buildAggregateFromPatch(input.repositoryPath, commitDetails, patch);
    } catch (error) {
      throw new Error(messageForError(error));
    }
  }

  async listRepositoryCommits(
    input: ListRepositoryCommitsInput,
  ): Promise<readonly RepositoryCommitSummary[]> {
    if (!isTauriRuntime()) {
      if (!this.#fallbackDataSource) {
        throw new Error("Repository commit listing requires Tauri runtime.");
      }

      return this.#fallbackDataSource.listRepositoryCommits(input);
    }

    try {
      const items = await invokeTauri<readonly RepositoryCommitSummary[]>("list_commits", {
        repoPath: input.repositoryPath,
        limit: input.limit ?? 120,
      });

      return normalizeCommitList(items);
    } catch (error) {
      throw new Error(messageForError(error));
    }
  }

  async readCommitFileVersions(input: ReadCommitFileVersionsInput): Promise<CommitFileVersions> {
    if (!isTauriRuntime()) {
      if (!this.#fallbackDataSource) {
        throw new Error("Commit file version loading requires Tauri runtime.");
      }

      return this.#fallbackDataSource.readCommitFileVersions(input);
    }

    try {
      const versions = await invokeTauri<TauriCommitFileVersions>("read_commit_file_versions", {
        repoPath: input.repositoryPath,
        commitHash: input.commitSha,
        oldPath: input.oldPath,
        newPath: input.newPath,
      });

      return {
        oldContent: versions.oldContent ?? null,
        newContent: versions.newContent ?? null,
      };
    } catch (error) {
      throw new Error(messageForError(error));
    }
  }
}

export function createTauriGitCommitReviewDataSource(
  options: TauriGitCommitReviewDataSourceOptions = {},
): CommitReviewDataSource {
  return new TauriGitCommitReviewDataSource(options);
}
