export interface RepositoryCommitSummary {
  readonly hash: string;
  readonly shortHash: string;
  readonly summary: string;
  readonly author: string;
  readonly authorEmail: string;
  readonly authoredAtIso: string;
}

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

function normalizePath(value: string): string {
  return value.trim();
}

function normalizeCommit(commit: RepositoryCommitSummary): RepositoryCommitSummary {
  return {
    hash: commit.hash.trim(),
    shortHash: commit.shortHash.trim(),
    summary: commit.summary.trim(),
    author: commit.author.trim(),
    authorEmail: commit.authorEmail.trim(),
    authoredAtIso: commit.authoredAtIso.trim(),
  };
}

export async function readRepositoryCommits(
  repositoryPath: string,
  limit = 120,
): Promise<readonly RepositoryCommitSummary[]> {
  const normalizedPath = normalizePath(repositoryPath);
  if (normalizedPath.length === 0 || !isTauriRuntime()) {
    return [];
  }

  const parsedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 120;

  const { invoke } = await import("@tauri-apps/api/core");
  const commits = await invoke<RepositoryCommitSummary[]>("list_commits", {
    repoPath: normalizedPath,
    limit: parsedLimit,
  });

  return commits
    .map(normalizeCommit)
    .filter((commit) => commit.hash.length > 0);
}
