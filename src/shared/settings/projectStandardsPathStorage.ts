const STORAGE_KEY = "checkmate-project-standards-paths.v1";

interface ProjectStandardsPathMap {
  readonly [repositoryPath: string]: string;
}

function normalizePath(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function readMap(): ProjectStandardsPathMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const map = parsed as Record<string, unknown>;
    const normalizedEntries = Object.entries(map)
      .map(([repositoryPath, standardsPath]) => {
        if (typeof standardsPath !== "string") {
          return null;
        }

        const normalizedRepositoryPath = normalizePath(repositoryPath);
        const normalizedStandardsPath = normalizePath(standardsPath);
        if (normalizedRepositoryPath.length === 0 || normalizedStandardsPath.length === 0) {
          return null;
        }

        return [normalizedRepositoryPath, normalizedStandardsPath] as const;
      })
      .filter((entry): entry is readonly [string, string] => entry !== null);

    return Object.fromEntries(normalizedEntries);
  } catch {
    return {};
  }
}

function writeMap(map: ProjectStandardsPathMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore write failures.
  }
}

export function readProjectStandardsPathFromStorage(repositoryPath: string): string | null {
  const normalizedRepositoryPath = normalizePath(repositoryPath);
  if (normalizedRepositoryPath.length === 0) {
    return null;
  }

  const map = readMap();
  const configuredPath = normalizePath(map[normalizedRepositoryPath]);
  return configuredPath.length > 0 ? configuredPath : null;
}

export function writeProjectStandardsPathToStorage(
  repositoryPath: string,
  standardsPath: string | null | undefined,
): void {
  const normalizedRepositoryPath = normalizePath(repositoryPath);
  if (normalizedRepositoryPath.length === 0) {
    return;
  }

  const normalizedStandardsPath = normalizePath(standardsPath);
  const nextMap: Record<string, string> = { ...readMap() };

  if (normalizedStandardsPath.length === 0) {
    delete nextMap[normalizedRepositoryPath];
  } else {
    nextMap[normalizedRepositoryPath] = normalizedStandardsPath;
  }

  writeMap(nextMap);
}
