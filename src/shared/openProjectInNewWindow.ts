import { projectLabelFromPath } from "./projectLabelFromPath.ts";

function normalizePath(value: string): string {
  return value.trim();
}

function buildProjectUrl(repositoryPath: string, commitSha: string): string {
  const params = new URLSearchParams({
    repo: repositoryPath,
    commit: commitSha,
  });

  const pathName = typeof window !== "undefined" ? window.location.pathname : "/";
  return `${pathName}?${params.toString()}`;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function normalizeErrorMessage(error: unknown): string {
  if (!error) {
    return "Unknown error";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export interface OpenProjectInNewWindowInput {
  readonly repositoryPath: string;
  readonly commitSha?: string;
}

export async function openProjectInNewWindow(input: OpenProjectInNewWindowInput): Promise<void> {
  const repositoryPath = normalizePath(input.repositoryPath);
  if (repositoryPath.length === 0) {
    throw new Error("Repository path is required.");
  }

  const commitSha = input.commitSha?.trim().length ? input.commitSha.trim() : "HEAD";
  const projectUrl = buildProjectUrl(repositoryPath, commitSha);
  const windowTitle = projectLabelFromPath(repositoryPath) || "CodeLens";

  if (isTauriRuntime()) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const label = `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      // Creating a dedicated webview window keeps project workspaces isolated by default.
      new WebviewWindow(label, {
        title: windowTitle,
        url: projectUrl,
        width: 1280,
        height: 820,
        resizable: true,
        focus: true,
      });
      return;
    } catch (error) {
      throw new Error(`Failed to open new project window: ${normalizeErrorMessage(error)}`);
    }
  }

  if (typeof window !== "undefined") {
    window.open(projectUrl, "_blank", "noopener,noreferrer");
  }
}
