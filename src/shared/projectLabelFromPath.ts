export function projectLabelFromPath(repositoryPath: string): string {
  const normalized = repositoryPath.trim();
  if (normalized.length === 0 || normalized === "." || normalized === "./") {
    return "";
  }

  const withoutTrailingSeparators = normalized.replace(/[\\/]+$/, "");
  if (withoutTrailingSeparators.length === 0) {
    return "";
  }

  const segments = withoutTrailingSeparators.split(/[\\/]/);
  const lastSegment = segments.at(-1)?.trim() ?? "";
  return lastSegment.length > 0 ? lastSegment : "";
}
