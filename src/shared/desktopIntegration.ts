import { normalizeManagedCommentImageRef } from "./commentImageStorage.ts";

interface RuntimeLaunchRequest {
  readonly repositoryPath: string;
  readonly commitSha: string;
}

interface ProcessLike {
  readonly env?: Record<string, string | undefined>;
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

export interface AgentTrackingInitializationResult {
  readonly agentFileCreated: boolean;
  readonly agentFileUpdated: boolean;
  readonly agentReferenceFileCreated: boolean;
  readonly agentReferenceFileUpdated: boolean;
  readonly schemaFileCreated: boolean;
  readonly schemaFileUpdated: boolean;
  readonly message: string;
}

export interface AgentTrackingStatus {
  readonly enabled: boolean;
  readonly hasTrackingBlock: boolean;
  readonly hasAgentReference: boolean;
  readonly hasCommitContextSchema: boolean;
}

export interface AgentTrackingRemovalResult {
  readonly removed: boolean;
  readonly message: string;
}

export interface CommentImageStorageResult {
  readonly imageRef: string;
  readonly markdownUrl: string;
}

export interface ApplicationLogInput {
  readonly source: string;
  readonly event: string;
  readonly message: string;
  readonly fieldsJson?: string;
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

function readSystemUserNameFromEnvironment(): string | null {
  const processLike = (globalThis as { readonly process?: ProcessLike }).process;
  const env = processLike?.env;
  if (!env) {
    return null;
  }

  const candidates = [env.USER, env.USERNAME, env.LOGNAME];
  for (const candidate of candidates) {
    const normalized = candidate?.trim() ?? "";
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return null;
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

export async function readSystemUserName(): Promise<string | null> {
  const envFallback = readSystemUserNameFromEnvironment();
  if (!isTauriRuntime()) {
    return envFallback;
  }

  try {
    const runtimeValue = await invokeTauri<string | null>("read_system_username");
    const normalized = typeof runtimeValue === "string" ? runtimeValue.trim() : "";
    if (normalized.length > 0) {
      return normalized;
    }
  } catch {
    // Ignore runtime failures and return process env fallback.
  }

  return envFallback;
}

export async function readClipboardTextFromDesktop(): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error("Clipboard read is available only in the desktop app.");
  }

  const value = await invokeTauri<string>("read_clipboard_text");
  return value;
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

export async function initializeAgentTracking(
  repositoryPath: string,
): Promise<AgentTrackingInitializationResult> {
  if (!isTauriRuntime()) {
    throw new Error("Tracking initialization is available only in the desktop app.");
  }

  const response = await invokeTauri<AgentTrackingInitializationResult>("initialize_agent_tracking", {
    repoPath: repositoryPath,
  });

  return {
    agentFileCreated: Boolean(response.agentFileCreated),
    agentFileUpdated: Boolean(response.agentFileUpdated),
    agentReferenceFileCreated: Boolean(response.agentReferenceFileCreated),
    agentReferenceFileUpdated: Boolean(response.agentReferenceFileUpdated),
    schemaFileCreated: Boolean(response.schemaFileCreated),
    schemaFileUpdated: Boolean(response.schemaFileUpdated),
    message: response.message.trim(),
  };
}

export async function readAgentTrackingStatus(repositoryPath: string): Promise<AgentTrackingStatus> {
  if (!isTauriRuntime()) {
    return {
      enabled: false,
      hasTrackingBlock: false,
      hasAgentReference: false,
      hasCommitContextSchema: false,
    };
  }

  const response = await invokeTauri<AgentTrackingStatus>("read_agent_tracking_status", {
    repoPath: repositoryPath,
  });

  return {
    enabled: Boolean(response.enabled),
    hasTrackingBlock: Boolean(response.hasTrackingBlock),
    hasAgentReference: Boolean(response.hasAgentReference),
    hasCommitContextSchema: Boolean(response.hasCommitContextSchema),
  };
}

export async function removeAgentTracking(repositoryPath: string): Promise<AgentTrackingRemovalResult> {
  if (!isTauriRuntime()) {
    throw new Error("Tracking removal is available only in the desktop app.");
  }

  const response = await invokeTauri<AgentTrackingRemovalResult>("remove_agent_tracking", {
    repoPath: repositoryPath,
  });

  return {
    removed: Boolean(response.removed),
    message: response.message.trim(),
  };
}

export async function storeCommentImage(input: {
  readonly base64Data: string;
  readonly mimeType: string;
}): Promise<CommentImageStorageResult> {
  if (!isTauriRuntime()) {
    throw new Error("Image paste storage is available only in the desktop app.");
  }

  const response = await invokeTauri<CommentImageStorageResult>("store_comment_image", {
    base64Data: input.base64Data,
    mimeType: input.mimeType,
  });

  return {
    imageRef: response.imageRef.trim(),
    markdownUrl: response.markdownUrl.trim(),
  };
}

export async function resolveCommentImageDataUrl(imageRefOrUrl: string): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error("Comment images are available only in the desktop app.");
  }

  const normalized = normalizeManagedCommentImageRef(imageRefOrUrl);
  if (!normalized) {
    throw new Error("Invalid comment image reference.");
  }

  const dataUrl = await invokeTauri<string>("resolve_comment_image_data_url", {
    imageRef: normalized,
  });
  return dataUrl.trim();
}

export async function deleteCommentImages(imageRefs: readonly string[]): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  const normalizedImageRefs = [...new Set(
    imageRefs
      .map((imageRef) => normalizeManagedCommentImageRef(imageRef))
      .filter((imageRef): imageRef is string => imageRef !== null),
  )];
  if (normalizedImageRefs.length === 0) {
    return;
  }

  await invokeTauri<number>("delete_comment_images", {
    imageRefs: normalizedImageRefs,
  });
}

export async function appendApplicationLog(input: ApplicationLogInput): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  const source = input.source.trim();
  const event = input.event.trim();
  const message = input.message.trim();
  if (source.length === 0 || event.length === 0 || message.length === 0) {
    return;
  }

  try {
    await invokeTauri<void>("append_application_log", {
      source,
      event,
      message,
      ...(typeof input.fieldsJson === "string" && input.fieldsJson.trim().length > 0
        ? {
            fieldsJson: input.fieldsJson,
          }
        : {}),
    });
  } catch {
    // Best-effort logging path should never block user interactions.
  }
}
