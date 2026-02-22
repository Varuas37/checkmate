interface RuntimeLaunchRequest {
  readonly repositoryPath: string;
  readonly commitSha: string;
}

export interface CmCliStatus {
  readonly installed: boolean;
  readonly installPath: string | null;
  readonly onPath: boolean;
}

export interface CmCliInstallResult {
  readonly installPath: string;
  readonly onPath: boolean;
  readonly message: string;
}

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if ("__TAURI_INTERNALS__" in window || "__TAURI__" in window) {
    return true;
  }

  if (typeof navigator === "undefined") {
    return false;
  }

  return /tauri/i.test(navigator.userAgent);
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function normalizeLaunchRequest(raw: RuntimeLaunchRequest | null | undefined): RuntimeLaunchRequest | null {
  if (!raw) {
    return null;
  }

  const repositoryPath = raw.repositoryPath.trim();
  const commitSha = raw.commitSha.trim();
  if (repositoryPath.length === 0) {
    return null;
  }

  return {
    repositoryPath,
    commitSha: commitSha.length > 0 ? commitSha : "HEAD",
  };
}

export async function readLaunchRequestFromRuntime(): Promise<RuntimeLaunchRequest | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  try {
    const response = await invokeTauri<RuntimeLaunchRequest | null>("read_launch_request");
    return normalizeLaunchRequest(response);
  } catch {
    return null;
  }
}

export async function readCmCliStatus(): Promise<CmCliStatus | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const response = await invokeTauri<CmCliStatus>("read_cm_cli_status");
  return {
    installed: Boolean(response.installed),
    installPath:
      typeof response.installPath === "string" && response.installPath.trim().length > 0
        ? response.installPath.trim()
        : null,
    onPath: Boolean(response.onPath),
  };
}

export async function installCmCliInPath(): Promise<CmCliInstallResult> {
  if (!isTauriRuntime()) {
    throw new Error("cm installation is available only in the desktop app.");
  }

  const response = await invokeTauri<CmCliInstallResult>("install_cm_cli_in_path");
  return {
    installPath: response.installPath.trim(),
    onPath: Boolean(response.onPath),
    message: response.message.trim(),
  };
}
