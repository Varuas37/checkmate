function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function readTextFile(filePath: string): Promise<string | null> {
  const normalizedPath = filePath.trim();
  if (normalizedPath.length === 0 || !isTauriRuntime()) {
    return null;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const content = await invoke<string>("read_text_file", {
      filePath: normalizedPath,
    });
    return content;
  } catch {
    return null;
  }
}
