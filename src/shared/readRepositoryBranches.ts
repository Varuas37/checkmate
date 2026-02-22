function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function normalizePath(value: string): string {
  return value.trim();
}

export async function readRepositoryBranches(repositoryPath: string): Promise<readonly string[]> {
  const normalizedPath = normalizePath(repositoryPath);
  if (normalizedPath.length === 0 || !isTauriRuntime()) {
    return [];
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const branches = await invoke<string[]>("list_local_branches", {
    repoPath: normalizedPath,
  });

  return branches
    .map((branch) => branch.trim())
    .filter((branch) => branch.length > 0);
}
