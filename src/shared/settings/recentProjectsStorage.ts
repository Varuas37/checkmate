const STORAGE_KEY = "codelens-recent-projects.v1";
const MAX_RECENT_PROJECTS = 10;

export interface RecentProjectEntry {
  readonly repositoryPath: string;
  readonly lastOpenedAtIso: string;
}

function normalizePath(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeEntry(input: Partial<RecentProjectEntry> | null | undefined): RecentProjectEntry | null {
  if (!input) {
    return null;
  }

  const repositoryPath = normalizePath(input.repositoryPath);
  const lastOpenedAtIso = input.lastOpenedAtIso?.trim() ?? "";

  if (repositoryPath.length === 0 || lastOpenedAtIso.length === 0) {
    return null;
  }

  return {
    repositoryPath,
    lastOpenedAtIso,
  };
}

function sortRecentProjects(entries: readonly RecentProjectEntry[]): RecentProjectEntry[] {
  return [...entries].sort((left, right) => right.lastOpenedAtIso.localeCompare(left.lastOpenedAtIso));
}

export function readRecentProjectsFromStorage(): readonly RecentProjectEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as readonly Partial<RecentProjectEntry>[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    const normalized = parsed
      .map((entry) => normalizeEntry(entry))
      .filter((entry): entry is RecentProjectEntry => entry !== null);

    return sortRecentProjects(normalized).slice(0, MAX_RECENT_PROJECTS);
  } catch {
    return [];
  }
}

export function writeRecentProjectsToStorage(entries: readonly RecentProjectEntry[]): void {
  const normalized = entries
    .map((entry) => normalizeEntry(entry))
    .filter((entry): entry is RecentProjectEntry => entry !== null);

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(sortRecentProjects(normalized).slice(0, MAX_RECENT_PROJECTS)),
    );
  } catch {
    // Ignore write failures.
  }
}

export function recordRecentProjectInStorage(
  repositoryPath: string,
  openedAtIso: string = new Date().toISOString(),
): readonly RecentProjectEntry[] {
  const normalizedPath = normalizePath(repositoryPath);
  if (normalizedPath.length === 0) {
    return readRecentProjectsFromStorage();
  }

  const existing = readRecentProjectsFromStorage().filter(
    (entry) => normalizePath(entry.repositoryPath) !== normalizedPath,
  );

  const nextEntries = sortRecentProjects([
    {
      repositoryPath: normalizedPath,
      lastOpenedAtIso: openedAtIso,
    },
    ...existing,
  ]).slice(0, MAX_RECENT_PROJECTS);

  writeRecentProjectsToStorage(nextEntries);
  return nextEntries;
}
