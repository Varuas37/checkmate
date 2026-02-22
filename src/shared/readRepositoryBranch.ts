function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function normalizePath(value: string): string {
  return value.trim();
}

export async function readRepositoryBranch(repositoryPath: string): Promise<string | null> {
  const normalizedPath = normalizePath(repositoryPath);
  if (normalizedPath.length === 0 || !isTauriRuntime()) {
    return null;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const branch = await invoke<string>("read_current_branch", {
    repoPath: normalizedPath,
  });

  const normalizedBranch = branch.trim();
  return normalizedBranch.length > 0 ? normalizedBranch : null;
}
