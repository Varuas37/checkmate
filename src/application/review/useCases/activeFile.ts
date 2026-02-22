export function resolveActiveFileId(
  visibleFileIds: readonly string[],
  currentActiveFileId: string | null,
): string | null {
  if (visibleFileIds.length === 0) {
    return null;
  }

  if (currentActiveFileId !== null && visibleFileIds.includes(currentActiveFileId)) {
    return currentActiveFileId;
  }

  const firstFileId = visibleFileIds[0];
  return firstFileId ?? null;
}
