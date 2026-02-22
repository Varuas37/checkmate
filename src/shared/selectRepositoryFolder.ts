type TauriDialogSelection = string | string[] | null;

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { readonly mode?: "read" | "readwrite" }) => Promise<{ readonly name: string }>;
}

function normalizeSelectedPath(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const name = (error as { readonly name?: unknown }).name;
  return typeof name === "string" && name === "AbortError";
}

async function selectFolderWithTauriDialog(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const selected = await invoke<TauriDialogSelection>("plugin:dialog|open", {
    options: {
      directory: true,
      multiple: false,
      title: "Select Repository Folder",
    },
  });

  if (Array.isArray(selected)) {
    return normalizeSelectedPath(selected[0]);
  }

  return normalizeSelectedPath(selected);
}

async function selectFolderWithWebFallback(): Promise<string | null> {
  if (typeof window === "undefined") {
    return null;
  }

  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  let suggestedPath = ".";

  if (typeof picker === "function") {
    try {
      const handle = await picker.call(window, { mode: "read" });
      const handleName = normalizeSelectedPath(handle.name);
      suggestedPath = handleName ? `./${handleName}` : ".";
    } catch (error) {
      if (isAbortError(error)) {
        return null;
      }
    }
  }

  const enteredPath = window.prompt("Enter repository folder path", suggestedPath);
  if (enteredPath === null) {
    return null;
  }

  return normalizeSelectedPath(enteredPath);
}

export interface SelectRepositoryFolderDependencies {
  readonly isTauriRuntime: () => boolean;
  readonly selectWithTauriDialog: () => Promise<string | null>;
  readonly selectWithWebFallback: () => Promise<string | null>;
}

export async function selectRepositoryFolder(
  dependencies: Partial<SelectRepositoryFolderDependencies> = {},
): Promise<string | null> {
  const tauriRuntime = dependencies.isTauriRuntime ?? isTauriRuntime;
  const selectWithTauriDialog =
    dependencies.selectWithTauriDialog ?? selectFolderWithTauriDialog;
  const selectWithWebFallback =
    dependencies.selectWithWebFallback ?? selectFolderWithWebFallback;

  if (tauriRuntime()) {
    try {
      return await selectWithTauriDialog();
    } catch {
      // If Tauri dialog fails, avoid browser prompt in desktop runtime.
      return null;
    }
  }

  return selectWithWebFallback();
}
