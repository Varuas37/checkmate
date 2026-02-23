const COMMENT_IMAGE_URL_PREFIX = "checkmate-image://";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isManagedCommentImageUrl(value: string): boolean {
  return value.trim().toLowerCase().startsWith(COMMENT_IMAGE_URL_PREFIX);
}

export function toManagedCommentImageUrl(imageRef: string): string {
  return `${COMMENT_IMAGE_URL_PREFIX}${imageRef.trim()}`;
}

export function normalizeManagedCommentImageRef(value: string): string | null {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }

  const withoutPrefix = isManagedCommentImageUrl(normalized)
    ? normalized.slice(COMMENT_IMAGE_URL_PREFIX.length)
    : normalized;
  if (withoutPrefix.length === 0) {
    return null;
  }

  if (!/^[A-Za-z0-9._-]+$/.test(withoutPrefix)) {
    return null;
  }

  return withoutPrefix;
}

export function buildManagedCommentImageMarkdown(imageRef: string, alt = "pasted image"): string {
  const normalized = normalizeManagedCommentImageRef(imageRef);
  if (!normalized) {
    return "";
  }

  return `![${alt}](${toManagedCommentImageUrl(normalized)})`;
}

export function extractManagedCommentImageRefs(markdown: string): readonly string[] {
  const refs = new Set<string>();
  const imagePattern = /!\[[^\]\n]*\]\(([^)\s]+)\)/g;

  let match: RegExpExecArray | null = imagePattern.exec(markdown);
  while (match) {
    const candidate = normalizeManagedCommentImageRef(match[1] ?? "");
    if (candidate) {
      refs.add(candidate);
    }
    match = imagePattern.exec(markdown);
  }

  return [...refs];
}

export function removeManagedCommentImageFromMarkdown(markdown: string, imageRef: string): string {
  const normalized = normalizeManagedCommentImageRef(imageRef);
  if (!normalized) {
    return markdown;
  }

  const imageUrl = toManagedCommentImageUrl(normalized);
  const imagePattern = new RegExp(`!\\[[^\\]\\n]*\\]\\(${escapeRegExp(imageUrl)}\\)`, "g");

  return markdown
    .replace(imagePattern, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trimEnd();
}
