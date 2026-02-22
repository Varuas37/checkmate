import type { RepositoryCommitSummary } from "./readRepositoryCommits.ts";

interface RawReviewCommitFeed {
  readonly recentCommits?: readonly RepositoryCommitSummary[];
  readonly branchOnlyCommits?: readonly RepositoryCommitSummary[];
  readonly mainlineReference?: string | null;
}

export interface RepositoryReviewCommitFeed {
  readonly recentCommits: readonly RepositoryCommitSummary[];
  readonly branchOnlyCommits: readonly RepositoryCommitSummary[];
  readonly mainlineReference: string | null;
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

export async function readRepositoryReviewCommits(
  repositoryPath: string,
  recentLimit = 15,
  branchOnlyLimit = 240,
): Promise<RepositoryReviewCommitFeed> {
  const normalizedPath = normalizePath(repositoryPath);
  if (normalizedPath.length === 0 || !isTauriRuntime()) {
    return {
      recentCommits: [],
      branchOnlyCommits: [],
      mainlineReference: null,
    };
  }

  const parsedRecentLimit = Number.isFinite(recentLimit)
    ? Math.max(1, Math.min(200, Math.floor(recentLimit)))
    : 15;
  const parsedBranchOnlyLimit = Number.isFinite(branchOnlyLimit)
    ? Math.max(1, Math.min(500, Math.floor(branchOnlyLimit)))
    : 240;

  const { invoke } = await import("@tauri-apps/api/core");
  const payload = await invoke<RawReviewCommitFeed>("list_review_commits", {
    repoPath: normalizedPath,
    recentLimit: parsedRecentLimit,
    branchOnlyLimit: parsedBranchOnlyLimit,
  });

  const normalizeList = (items: readonly RepositoryCommitSummary[] | undefined): readonly RepositoryCommitSummary[] => {
    return (items ?? [])
      .map(normalizeCommit)
      .filter((commit) => commit.hash.length > 0);
  };

  const mainlineReference = payload.mainlineReference?.trim() ?? "";

  return {
    recentCommits: normalizeList(payload.recentCommits),
    branchOnlyCommits: normalizeList(payload.branchOnlyCommits),
    mainlineReference: mainlineReference.length > 0 ? mainlineReference : null,
  };
}
