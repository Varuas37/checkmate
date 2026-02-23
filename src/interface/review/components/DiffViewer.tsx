import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import Skeleton from "react-loading-skeleton";

import type { DiffViewMode, FileVersionsLoadStatus } from "../../../application/review/index.ts";
import type {
  ChangedFile,
  CommitFileVersions,
  CommentSide,
  DiffHunk,
  DiffLine,
  DiffLineKind,
  DiffOrientation,
} from "../../../domain/review/index.ts";
import { Button, Textarea } from "../../../design-system/index.ts";
import {
  applyCheckmateMentionSuggestion,
  buildManagedCommentImageMarkdown,
  cn,
  deleteCommentImages,
  extractManagedCommentImageRefs,
  getCheckmateMentionSuggestion,
  hasCheckmateMention,
  removeManagedCommentImageFromMarkdown,
  storeCommentImage,
  stripCheckmateMentions,
} from "../../../shared/index.ts";
import type { CreateThreadInput, ThreadViewModel } from "../types.ts";
import { MarkdownComment } from "./MarkdownComment.tsx";

const EXPANSION_STEP = 15;
const DIFF_COMMENT_DRAFT_STORAGE_KEY_PREFIX = "checkmate:diff-comment-draft:";

interface DiffCommentDraft {
  readonly reviewBody: string;
  readonly promptByThreadId: Readonly<Record<string, string>>;
}

function encodeArrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let output = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    output += String.fromCharCode(...chunk);
  }

  return btoa(output);
}

const SUPPORTED_STORED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/tiff",
  "image/tif",
]);

function normalizeImageMimeType(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "image/tif") {
    return "image/tiff";
  }
  if (normalized === "image/jpg") {
    return "image/jpeg";
  }
  return normalized;
}

function inferImageMimeTypeFromName(fileName: string): string | null {
  const lowered = fileName.trim().toLowerCase();
  if (lowered.endsWith(".png")) return "image/png";
  if (lowered.endsWith(".jpg") || lowered.endsWith(".jpeg")) return "image/jpeg";
  if (lowered.endsWith(".webp")) return "image/webp";
  if (lowered.endsWith(".gif")) return "image/gif";
  if (lowered.endsWith(".tif") || lowered.endsWith(".tiff")) return "image/tiff";
  return null;
}

async function transcodeImageFileToPng(file: File): Promise<File | null> {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) {
        return null;
      }

      context.drawImage(bitmap, 0, 0);
      const pngBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/png");
      });
      if (!pngBlob) {
        return null;
      }

      return new File([pngBlob], "pasted-image.png", {
        type: "image/png",
        lastModified: Date.now(),
      });
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

async function normalizeImageFileForStorage(
  file: File,
): Promise<{ readonly file: File; readonly mimeType: string } | null> {
  let mimeType = normalizeImageMimeType(file.type);
  if (mimeType.length === 0) {
    mimeType = inferImageMimeTypeFromName(file.name) ?? "";
  }

  if (SUPPORTED_STORED_IMAGE_MIME_TYPES.has(mimeType)) {
    return {
      file,
      mimeType,
    };
  }

  const pngFile = await transcodeImageFileToPng(file);
  if (!pngFile) {
    return null;
  }

  return {
    file: pngFile,
    mimeType: "image/png",
  };
}

function lineFeatureTooltip(featureTitle: string | undefined): string {
  const normalized = featureTitle?.trim() ?? "";
  if (normalized.length > 0) {
    return normalized;
  }

  return "No feature found";
}

function uniqueImageFiles(files: readonly File[]): readonly File[] {
  const deduped = new Map<string, File>();
  files.forEach((file) => {
    const key = `${file.name}|${file.type}|${file.size}|${file.lastModified}`;
    if (!deduped.has(key)) {
      deduped.set(key, file);
    }
  });
  return [...deduped.values()];
}

function isLikelyImageFile(file: File, explicitMimeType?: string): boolean {
  const normalizedExplicitType = normalizeImageMimeType(explicitMimeType ?? "");
  if (normalizedExplicitType.startsWith("image/")) {
    return true;
  }

  const normalizedFileType = normalizeImageMimeType(file.type);
  if (normalizedFileType.startsWith("image/")) {
    return true;
  }

  if (inferImageMimeTypeFromName(file.name) !== null) {
    return true;
  }

  return normalizedExplicitType.length === 0 && normalizedFileType.length === 0 && file.size > 0;
}

function collectClipboardImageFiles(clipboardData: DataTransfer | null): readonly File[] {
  if (!clipboardData) {
    return [];
  }

  const files: File[] = [];

  const itemList = clipboardData.items;
  if (itemList && itemList.length > 0) {
    [...itemList].forEach((item) => {
      if (item.kind !== "file") {
        return;
      }

      const file = item.getAsFile();
      if (file && isLikelyImageFile(file, item.type)) {
        files.push(file);
      }
    });
  }

  const fileList = clipboardData.files;
  if (fileList && fileList.length > 0) {
    [...fileList].forEach((file) => {
      if (isLikelyImageFile(file)) {
        files.push(file);
      }
    });
  }

  return uniqueImageFiles(files);
}

async function readClipboardImageFilesFallback(): Promise<readonly File[]> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) {
    return [];
  }

  try {
    const clipboardItems = await navigator.clipboard.read();
    const files: File[] = [];
    let index = 0;

    for (const item of clipboardItems) {
      for (const type of item.types) {
        const normalizedType = type.toLowerCase();
        if (!normalizedType.startsWith("image/")) {
          continue;
        }

        const blob = await item.getType(type);
        const extension = normalizedType.slice("image/".length) || "png";
        const now = Date.now();
        files.push(new File([blob], `clipboard-image-${now}-${index}.${extension}`, {
          type: normalizedType,
          lastModified: now,
        }));
        index += 1;
      }
    }

    return uniqueImageFiles(files);
  } catch {
    return [];
  }
}

async function buildMarkdownSnippetsFromImageFiles(
  imageFiles: readonly File[],
): Promise<{ readonly snippets: readonly string[]; readonly attempted: number }> {
  if (imageFiles.length === 0) {
    return {
      snippets: [],
      attempted: 0,
    };
  }

  const snippets: string[] = [];
  for (const imageFile of imageFiles) {
    const normalized = await normalizeImageFileForStorage(imageFile);
    if (!normalized) {
      continue;
    }

    try {
      const bytes = await normalized.file.arrayBuffer();
      const encodedData = encodeArrayBufferToBase64(bytes);
      const stored = await storeCommentImage({
        base64Data: encodedData,
        mimeType: normalized.mimeType,
      });
      const markdown = buildManagedCommentImageMarkdown(stored.imageRef, "pasted image");
      if (markdown.length > 0) {
        snippets.push(markdown);
      }
    } catch {
      // Keep editing flow stable if one image fails to persist.
    }
  }

  return {
    snippets,
    attempted: imageFiles.length,
  };
}

function readCommentDraftFromStorage(storageKey: string | null): DiffCommentDraft | null {
  if (!storageKey || typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as {
      readonly reviewBody?: unknown;
      readonly promptByThreadId?: unknown;
    };

    const reviewBody = typeof parsed.reviewBody === "string" ? parsed.reviewBody : "";
    const promptByThreadId: Record<string, string> = {};

    if (parsed.promptByThreadId && typeof parsed.promptByThreadId === "object") {
      Object.entries(parsed.promptByThreadId as Record<string, unknown>).forEach(([threadId, value]) => {
        if (typeof value !== "string") {
          return;
        }
        if (threadId.trim().length === 0) {
          return;
        }
        promptByThreadId[threadId] = value;
      });
    }

    return {
      reviewBody,
      promptByThreadId,
    };
  } catch {
    return null;
  }
}

interface ChangeGapRow {
  readonly kind: "gap";
  readonly id: string;
  readonly oldStart: number;
  readonly oldEnd: number;
  readonly newStart: number;
  readonly newEnd: number;
}

interface ChangeLineRow {
  readonly kind: "line";
  readonly id: string;
  readonly hunkId: string;
  readonly line: DiffLine;
}

type ChangeRow = ChangeGapRow | ChangeLineRow;

interface HunkLineRange {
  readonly start: number;
  readonly end: number;
  readonly hunkId: string;
}

interface HunkLineLookup {
  readonly oldByLine: ReadonlyMap<number, string>;
  readonly newByLine: ReadonlyMap<number, string>;
  readonly oldRanges: readonly HunkLineRange[];
  readonly newRanges: readonly HunkLineRange[];
  readonly firstHunkId: string | null;
}

interface SelectableLineAnchor {
  readonly key: string;
  readonly side: CommentSide;
  readonly lineNumber: number;
  readonly hunkId: string;
}

type SyntaxLanguage =
  | "typescript"
  | "javascript"
  | "json"
  | "rust"
  | "shell"
  | "markdown"
  | "text";

type SyntaxTokenKind = "plain" | "keyword" | "string" | "comment" | "number" | "type";

interface SyntaxToken {
  readonly kind: SyntaxTokenKind;
  readonly text: string;
}

export interface DiffViewerProps {
  readonly file: ChangedFile | null;
  readonly hunks: readonly DiffHunk[];
  readonly featureHunkNotice?: string | null;
  readonly hunkFeatureLabelsById?: Readonly<Record<string, readonly string[]>>;
  readonly orientation: DiffOrientation;
  readonly viewMode: DiffViewMode;
  readonly threads?: readonly ThreadViewModel[];
  readonly showInlineThreads?: boolean;
  readonly fileVersions: CommitFileVersions | null;
  readonly fileVersionsStatus: FileVersionsLoadStatus;
  readonly fileVersionsError: string | null;
  readonly onOrientationChange: (orientation: DiffOrientation) => void;
  readonly onViewModeChange: (mode: DiffViewMode) => void;
  readonly onAskAgent?: (threadId: string, prompt: string) => void;
  readonly onDeleteComment?: (commentId: string) => void;
  readonly onSetThreadStatus?: (threadId: string, status: "open" | "resolved") => void;
  readonly onCreateThread?: (input: CreateThreadInput) => { readonly ok: boolean; readonly message: string };
  readonly defaultAuthorId?: string;
  readonly toolbarActions?: ReactNode;
  readonly bodyOverride?: ReactNode;
}

function unifiedRowClass(kind: DiffLineKind): string {
  if (kind === "add") {
    return "bg-positive/10";
  }

  if (kind === "remove") {
    return "bg-danger/10";
  }

  return "bg-canvas";
}

function markerClass(kind: DiffLineKind): string {
  if (kind === "add") {
    return "text-positive";
  }

  if (kind === "remove") {
    return "text-danger";
  }

  return "text-muted/70";
}

function paneRowClass(kind: DiffLineKind, side: "left" | "right"): string {
  if (kind === "remove" && side === "left") {
    return "bg-danger/10";
  }

  if (kind === "add" && side === "right") {
    return "bg-positive/10";
  }

  if (kind === "context") {
    return "bg-canvas";
  }

  return "bg-canvas/70";
}

function textClass(): string {
  return "text-text/80";
}

function splitContentLines(content: string | null): readonly string[] {
  if (content === null) {
    return [];
  }

  const normalized = content.replace(/\r\n/g, "\n");
  if (normalized.length === 0) {
    return [];
  }

  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) {
    lines.pop();
  }

  return lines;
}

function lineTextAt(lines: readonly string[], lineNumber: number): string {
  if (lineNumber <= 0) {
    return "";
  }

  return lines[lineNumber - 1] ?? "";
}

function collectChangedLineNumbers(hunks: readonly DiffHunk[]): {
  readonly old: Set<number>;
  readonly next: Set<number>;
} {
  const old = new Set<number>();
  const next = new Set<number>();

  hunks.forEach((hunk) => {
    hunk.lines.forEach((line) => {
      if (line.kind === "remove" && line.oldLineNumber !== undefined) {
        old.add(line.oldLineNumber);
      }

      if (line.kind === "add" && line.newLineNumber !== undefined) {
        next.add(line.newLineNumber);
      }
    });
  });

  return {
    old,
    next,
  };
}

function buildChangeRows(
  hunks: readonly DiffHunk[],
  oldLineCount: number,
  newLineCount: number,
): readonly ChangeRow[] {
  if (hunks.length === 0) {
    return [];
  }

  const sortedHunks = [...hunks].sort((left, right) => {
    if (left.oldStart !== right.oldStart) {
      return left.oldStart - right.oldStart;
    }

    if (left.newStart !== right.newStart) {
      return left.newStart - right.newStart;
    }

    return left.id.localeCompare(right.id);
  });

  const rows: ChangeRow[] = [];
  let previousOldEnd = 0;
  let previousNewEnd = 0;

  sortedHunks.forEach((hunk, hunkIndex) => {
    const oldStart = hunk.oldLines > 0 ? Math.max(1, hunk.oldStart) : previousOldEnd + 1;
    const newStart = hunk.newLines > 0 ? Math.max(1, hunk.newStart) : previousNewEnd + 1;
    const oldGapStart = previousOldEnd + 1;
    const oldGapEnd = oldStart - 1;
    const newGapStart = previousNewEnd + 1;
    const newGapEnd = newStart - 1;

    if (oldGapEnd >= oldGapStart || newGapEnd >= newGapStart) {
      rows.push({
        kind: "gap",
        id: `gap-${hunkIndex}-${oldGapStart}-${oldGapEnd}-${newGapStart}-${newGapEnd}`,
        oldStart: oldGapStart,
        oldEnd: oldGapEnd,
        newStart: newGapStart,
        newEnd: newGapEnd,
      });
    }

    hunk.lines.forEach((line, lineIndex) => {
      rows.push({
        kind: "line",
        id: `${hunk.id}-line-${lineIndex}`,
        hunkId: hunk.id,
        line,
      });
    });

    if (hunk.oldLines > 0) {
      previousOldEnd = Math.max(previousOldEnd, hunk.oldStart + hunk.oldLines - 1);
    }

    if (hunk.newLines > 0) {
      previousNewEnd = Math.max(previousNewEnd, hunk.newStart + hunk.newLines - 1);
    }
  });

  const tailOldCount = oldLineCount > 0 ? oldLineCount : previousOldEnd;
  const tailNewCount = newLineCount > 0 ? newLineCount : previousNewEnd;
  const tailOldStart = previousOldEnd + 1;
  const tailNewStart = previousNewEnd + 1;

  if (tailOldCount >= tailOldStart || tailNewCount >= tailNewStart) {
    rows.push({
      kind: "gap",
      id: `tail-${tailOldStart}-${tailOldCount}-${tailNewStart}-${tailNewCount}`,
      oldStart: tailOldStart,
      oldEnd: tailOldCount,
      newStart: tailNewStart,
      newEnd: tailNewCount,
    });
  }

  return rows;
}

const TS_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const RUST_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "const",
  "continue",
  "crate",
  "else",
  "enum",
  "extern",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "self",
  "Self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
]);

const SHELL_KEYWORDS = new Set([
  "case",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "then",
  "until",
  "while",
]);

function languageForPath(path: string | undefined): SyntaxLanguage {
  if (!path) {
    return "text";
  }

  const normalizedPath = path.toLowerCase();
  const extension = normalizedPath.split(".").pop() ?? "";

  if (extension === "ts" || extension === "tsx" || extension === "mts" || extension === "cts") {
    return "typescript";
  }

  if (extension === "js" || extension === "jsx" || extension === "mjs" || extension === "cjs") {
    return "javascript";
  }

  if (extension === "json") {
    return "json";
  }

  if (extension === "rs") {
    return "rust";
  }

  if (
    extension === "sh" ||
    extension === "bash" ||
    extension === "zsh" ||
    extension === "fish" ||
    normalizedPath.endsWith("/dockerfile") ||
    normalizedPath.endsWith("dockerfile")
  ) {
    return "shell";
  }

  if (extension === "md" || extension === "mdx") {
    return "markdown";
  }

  return "text";
}

function keywordSetForLanguage(language: SyntaxLanguage): ReadonlySet<string> {
  if (language === "typescript" || language === "javascript") {
    return TS_KEYWORDS;
  }

  if (language === "rust") {
    return RUST_KEYWORDS;
  }

  if (language === "shell") {
    return SHELL_KEYWORDS;
  }

  return new Set<string>();
}

function pushToken(tokens: SyntaxToken[], kind: SyntaxTokenKind, text: string): void {
  if (text.length === 0) {
    return;
  }

  const previous = tokens[tokens.length - 1];
  if (previous && previous.kind === kind) {
    const merged: SyntaxToken = {
      kind,
      text: `${previous.text}${text}`,
    };
    tokens[tokens.length - 1] = merged;
    return;
  }

  tokens.push({
    kind,
    text,
  });
}

function isWordStart(value: string): boolean {
  return /[A-Za-z_$]/.test(value);
}

function isWordPart(value: string): boolean {
  return /[A-Za-z0-9_$]/.test(value);
}

function isHexDigit(value: string): boolean {
  return /[0-9a-fA-F]/.test(value);
}

function tokenizeLine(text: string, language: SyntaxLanguage): readonly SyntaxToken[] {
  if (text.length === 0) {
    return [{ kind: "plain", text: " " }];
  }

  const tokens: SyntaxToken[] = [];
  const keywords = keywordSetForLanguage(language);
  let index = 0;

  while (index < text.length) {
    const current = text[index] ?? "";
    const next = text[index + 1] ?? "";

    if (current === "/" && next === "/") {
      pushToken(tokens, "comment", text.slice(index));
      break;
    }

    if ((language === "shell" || language === "markdown") && current === "#") {
      pushToken(tokens, "comment", text.slice(index));
      break;
    }

    if (current === '"' || current === "'" || current === "`") {
      const quote = current;
      let cursor = index + 1;
      let escaped = false;

      while (cursor < text.length) {
        const value = text[cursor] ?? "";
        if (escaped) {
          escaped = false;
          cursor += 1;
          continue;
        }

        if (value === "\\") {
          escaped = true;
          cursor += 1;
          continue;
        }

        if (value === quote) {
          cursor += 1;
          break;
        }

        cursor += 1;
      }

      pushToken(tokens, "string", text.slice(index, cursor));
      index = cursor;
      continue;
    }

    if (/[0-9]/.test(current)) {
      let cursor = index + 1;

      if (current === "0" && (next === "x" || next === "X")) {
        cursor = index + 2;
        while (cursor < text.length && isHexDigit(text[cursor] ?? "")) {
          cursor += 1;
        }
      } else {
        while (cursor < text.length && /[0-9._]/.test(text[cursor] ?? "")) {
          cursor += 1;
        }
      }

      pushToken(tokens, "number", text.slice(index, cursor));
      index = cursor;
      continue;
    }

    if (isWordStart(current)) {
      let cursor = index + 1;
      while (cursor < text.length && isWordPart(text[cursor] ?? "")) {
        cursor += 1;
      }

      const word = text.slice(index, cursor);
      if (keywords.has(word)) {
        pushToken(tokens, "keyword", word);
      } else if (/^[A-Z][A-Za-z0-9_]*$/.test(word)) {
        pushToken(tokens, "type", word);
      } else {
        pushToken(tokens, "plain", word);
      }

      index = cursor;
      continue;
    }

    pushToken(tokens, "plain", current);
    index += 1;
  }

  return tokens.length > 0 ? tokens : [{ kind: "plain", text: " " }];
}

function syntaxTokenClass(kind: SyntaxTokenKind): string {
  if (kind === "keyword") {
    return "text-accent font-semibold";
  }

  if (kind === "string") {
    return "text-caution";
  }

  if (kind === "comment") {
    return "text-muted/75 italic";
  }

  if (kind === "number") {
    return "text-positive";
  }

  if (kind === "type") {
    return "text-accent/90";
  }

  return "text-text/80";
}

function renderHighlightedCode(text: string, language: SyntaxLanguage): ReactNode {
  const tokens = tokenizeLine(text, language);

  return tokens.map((token, index) => (
    <span key={`${token.kind}-${index}`} className={syntaxTokenClass(token.kind)}>
      {token.text}
    </span>
  ));
}

function expandCount(
  expandedById: Record<string, number>,
  rangeId: string,
  total: number,
): number {
  const expanded = expandedById[rangeId] ?? 0;
  return Math.min(Math.max(0, expanded), total);
}

function buildGapLine(
  oldLineNumber: number | undefined,
  newLineNumber: number | undefined,
  oldText: string,
  newText: string,
): DiffLine {
  if (oldLineNumber !== undefined && newLineNumber !== undefined) {
    return {
      kind: "context",
      oldLineNumber,
      newLineNumber,
      text: newText.length > 0 ? newText : oldText,
    };
  }

  if (oldLineNumber !== undefined) {
    return {
      kind: "remove",
      oldLineNumber,
      text: oldText,
    };
  }

  if (newLineNumber !== undefined) {
    return {
      kind: "add",
      newLineNumber,
      text: newText,
    };
  }

  return {
    kind: "context",
    text: "",
  };
}

function buildHunkLineLookup(hunks: readonly DiffHunk[]): HunkLineLookup {
  const oldByLine = new Map<number, string>();
  const newByLine = new Map<number, string>();
  const oldRanges: HunkLineRange[] = [];
  const newRanges: HunkLineRange[] = [];
  const firstHunkId = hunks[0]?.id ?? null;

  hunks.forEach((hunk) => {
    if (hunk.oldLines > 0) {
      const start = Math.max(1, hunk.oldStart);
      const end = start + hunk.oldLines - 1;
      oldRanges.push({
        start,
        end,
        hunkId: hunk.id,
      });

      for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
        if (!oldByLine.has(lineNumber)) {
          oldByLine.set(lineNumber, hunk.id);
        }
      }
    }

    if (hunk.newLines > 0) {
      const start = Math.max(1, hunk.newStart);
      const end = start + hunk.newLines - 1;
      newRanges.push({
        start,
        end,
        hunkId: hunk.id,
      });

      for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
        if (!newByLine.has(lineNumber)) {
          newByLine.set(lineNumber, hunk.id);
        }
      }
    }
  });

  return {
    oldByLine,
    newByLine,
    oldRanges,
    newRanges,
    firstHunkId,
  };
}

function resolveHunkIdForLine(
  lookup: HunkLineLookup,
  side: CommentSide,
  lineNumber: number,
): string | null {
  if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
    return null;
  }

  const directMatch = side === "old" ? lookup.oldByLine.get(lineNumber) : lookup.newByLine.get(lineNumber);
  if (directMatch) {
    return directMatch;
  }

  const ranges = side === "old" ? lookup.oldRanges : lookup.newRanges;

  let nearestHunkId: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  ranges.forEach((range) => {
    let distance = 0;
    if (lineNumber < range.start) {
      distance = range.start - lineNumber;
    } else if (lineNumber > range.end) {
      distance = lineNumber - range.end;
    }

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestHunkId = range.hunkId;
    }
  });

  return nearestHunkId ?? lookup.firstHunkId;
}

function selectableAnchorKey(side: CommentSide, lineNumber: number): string {
  return `${side}:${lineNumber}`;
}

function diffLineMatchesAnchor(line: DiffLine, anchor: SelectableLineAnchor | null): boolean {
  if (!anchor) {
    return false;
  }

  if (anchor.side === "old") {
    return line.oldLineNumber === anchor.lineNumber;
  }

  return line.newLineNumber === anchor.lineNumber;
}

function sortSelectableAnchors(anchors: readonly SelectableLineAnchor[]): SelectableLineAnchor[] {
  return [...anchors].sort((left, right) => {
    if (left.side !== right.side) {
      return left.side === "old" ? -1 : 1;
    }

    if (left.lineNumber !== right.lineNumber) {
      return left.lineNumber - right.lineNumber;
    }

    return left.hunkId.localeCompare(right.hunkId);
  });
}

interface ThreadLookup {
  readonly old: ReadonlyMap<number, readonly ThreadViewModel[]>;
  readonly next: ReadonlyMap<number, readonly ThreadViewModel[]>;
}

function buildThreadLookup(threads: readonly ThreadViewModel[]): ThreadLookup {
  const old = new Map<number, ThreadViewModel[]>();
  const next = new Map<number, ThreadViewModel[]>();

  threads.forEach((threadModel) => {
    const side = threadModel.thread.anchor.side;
    const lineNumber = threadModel.thread.anchor.lineNumber;

    if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
      return;
    }

    if (side === "old") {
      const current = old.get(lineNumber) ?? [];
      old.set(lineNumber, [...current, threadModel]);
      return;
    }

    const current = next.get(lineNumber) ?? [];
    next.set(lineNumber, [...current, threadModel]);
  });

  return {
    old,
    next,
  };
}

function collectThreadsForDiffLine(
  lookup: ThreadLookup,
  oldLineNumber: number | undefined,
  newLineNumber: number | undefined,
): readonly ThreadViewModel[] {
  const matches = new Map<string, ThreadViewModel>();

  if (oldLineNumber !== undefined) {
    (lookup.old.get(oldLineNumber) ?? []).forEach((threadModel) => {
      matches.set(threadModel.thread.id, threadModel);
    });
  }

  if (newLineNumber !== undefined) {
    (lookup.next.get(newLineNumber) ?? []).forEach((threadModel) => {
      matches.set(threadModel.thread.id, threadModel);
    });
  }

  return [...matches.values()].sort((left, right) => {
    if (left.thread.anchor.lineNumber !== right.thread.anchor.lineNumber) {
      return left.thread.anchor.lineNumber - right.thread.anchor.lineNumber;
    }

    return left.thread.id.localeCompare(right.thread.id);
  });
}

function threadStatusClass(status: "open" | "resolved"): string {
  return status === "open"
    ? "border-accent/45 bg-accent/10 text-accent"
    : "border-positive/45 bg-positive/10 text-positive";
}

function renderInlineThreads(
  rowKey: string,
  threads: readonly ThreadViewModel[],
  promptsByThreadId: Readonly<Record<string, string>>,
  onPromptChange: (threadId: string, prompt: string) => void,
  onAskAgent: ((threadId: string, prompt: string) => void) | undefined,
  onDeleteComment: ((commentId: string) => void) | undefined,
  onSetThreadStatus: ((threadId: string, status: "open" | "resolved") => void) | undefined,
  expandedReplyThreadId: string | null,
  onToggleReplyComposer: (threadId: string) => void,
  onCloseReplyComposer: (threadId: string) => void,
  replyImageRefsByThreadId: Readonly<Record<string, readonly string[]>>,
  onReplyPaste: (threadId: string, event: ReactClipboardEvent<HTMLTextAreaElement>) => void,
  onRemoveReplyDraftImage: (threadId: string, imageRef: string) => void,
  onMarkReplyDraftImagesPersisted: (prompt: string) => void,
): ReactNode {
  if (threads.length === 0) {
    return null;
  }

  return (
    <div key={rowKey} className="border-b border-border/35 bg-surface-subtle/50 px-3 py-2">
      <div className="space-y-2">
        {threads.map((threadModel) => {
          const promptValue = promptsByThreadId[threadModel.thread.id] ?? "";
          const promptImageRefs = replyImageRefsByThreadId[threadModel.thread.id] ?? [];
          const mentionSuggestion = getCheckmateMentionSuggestion(promptValue);
          const hasMention = hasCheckmateMention(promptValue);
          const isReplyComposerOpen = expandedReplyThreadId === threadModel.thread.id;

          const sendReply = () => {
            if (!onAskAgent || !hasMention) {
              return;
            }

            onMarkReplyDraftImagesPersisted(promptValue);
            onAskAgent(threadModel.thread.id, stripCheckmateMentions(promptValue));
            onPromptChange(threadModel.thread.id, "");
            onCloseReplyComposer(threadModel.thread.id);
          };

          return (
            <article
              key={threadModel.thread.id}
              className="rounded-md border border-border/70 bg-canvas/70 px-2 py-2"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
                    {threadModel.thread.anchor.side} line {threadModel.thread.anchor.lineNumber}
                  </span>
                  <span
                    className={cn(
                      "rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]",
                      threadStatusClass(threadModel.thread.status),
                    )}
                  >
                    {threadModel.thread.status}
                  </span>
                </div>
                {onSetThreadStatus && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px]"
                    onClick={() =>
                      onSetThreadStatus(
                        threadModel.thread.id,
                        threadModel.thread.status === "open" ? "resolved" : "open",
                      )
                    }
                  >
                    {threadModel.thread.status === "open" ? "Resolve" : "Reopen"}
                  </Button>
                )}
              </div>

              <div className="space-y-1.5">
                {threadModel.comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="group rounded border border-border/50 bg-surface-subtle/25 px-2 py-1.5"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-[10px] text-muted">
                        {comment.authorType} · {comment.authorId}
                      </p>
                      {onDeleteComment && (
                        <button
                          type="button"
                          className={cn(
                            "rounded border border-transparent px-1 py-0.5 text-[10px] text-muted transition-colors",
                            "opacity-0 hover:border-danger/40 hover:bg-danger/10 hover:text-danger",
                            "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger/60",
                            "group-hover:opacity-100",
                          )}
                          onClick={() => {
                            onDeleteComment(comment.id);
                          }}
                          aria-label="Delete comment"
                          title="Delete comment"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                    <MarkdownComment body={comment.body} className="text-xs leading-5 text-text" />
                  </div>
                ))}
              </div>

              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="h-7 px-3"
                    onClick={() => onToggleReplyComposer(threadModel.thread.id)}
                    disabled={!onAskAgent}
                  >
                    Reply
                  </Button>
                  {threadModel.askAgentDraft.startsWith("Checkmate is reviewing") && (
                    <p className="text-[11px] text-muted">{threadModel.askAgentDraft}</p>
                  )}
                </div>

                {isReplyComposerOpen && (
                  <div className="space-y-1">
                    <Textarea
                      rows={3}
                      value={promptValue}
                      onChange={(event) => {
                        onPromptChange(threadModel.thread.id, event.target.value);
                      }}
                      onPaste={(event) => {
                        void onReplyPaste(threadModel.thread.id, event);
                      }}
                      onKeyDown={(event) => {
                        if (
                          (event.metaKey || event.ctrlKey)
                          && !event.shiftKey
                          && !event.altKey
                          && event.key.toLowerCase() === "a"
                        ) {
                          event.preventDefault();
                          event.currentTarget.select();
                          return;
                        }

                        if ((event.key === "Tab" || event.key === "ArrowDown") && mentionSuggestion) {
                          event.preventDefault();
                          onPromptChange(
                            threadModel.thread.id,
                            applyCheckmateMentionSuggestion(promptValue, mentionSuggestion),
                          );
                          return;
                        }

                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                          event.preventDefault();
                          sendReply();
                        }
                      }}
                      placeholder="Write reply... Mention @checkmate, then press Cmd/Ctrl+Enter to send"
                      className="min-h-[4.25rem] w-full font-mono text-[11px]"
                      aria-label="Thread reply input"
                      disabled={!onAskAgent}
                    />

                    {mentionSuggestion && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded border border-border/70 bg-surface-subtle/60 px-2 py-1 text-[10px] text-text transition-colors hover:border-accent/45 hover:text-accent"
                        onMouseDown={(event) => {
                          event.preventDefault();
                        }}
                        onClick={() => {
                          onPromptChange(
                            threadModel.thread.id,
                            applyCheckmateMentionSuggestion(promptValue, mentionSuggestion),
                          );
                        }}
                      >
                        <span className="rounded border border-accent/35 bg-accent/12 px-1 py-0.5 font-mono text-[9px] text-accent">
                          @checkmate
                        </span>
                        <span>Use mention</span>
                      </button>
                    )}

                    {hasMention && (
                      <p className="text-[10px] text-muted">
                        Agent mention detected:{" "}
                        <span className="rounded border border-accent/35 bg-accent/12 px-1 py-0.5 font-mono text-[9px] text-accent">
                          @checkmate
                        </span>
                      </p>
                    )}

                    <p className="text-[10px] text-muted">
                      Mention `@checkmate` to trigger an agent response for this thread.
                    </p>
                    {promptImageRefs.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase tracking-[0.08em] text-muted">Attached Images</p>
                        <div className="flex flex-wrap gap-1.5">
                          {promptImageRefs.map((imageRef, index) => (
                            <button
                              key={`${threadModel.thread.id}-${imageRef}-${index}`}
                              type="button"
                              className="inline-flex items-center gap-1 rounded border border-border/70 bg-surface-subtle/60 px-2 py-1 text-[10px] text-text transition-colors hover:border-danger/55 hover:text-danger"
                              onClick={() => onRemoveReplyDraftImage(threadModel.thread.id, imageRef)}
                              title="Remove image"
                            >
                              <span className="font-mono">{imageRef}</span>
                              <span aria-hidden="true">✕</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => {
                          onPromptChange(threadModel.thread.id, "");
                          onCloseReplyComposer(threadModel.thread.id);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 px-2"
                        onClick={sendReply}
                        disabled={!onAskAgent || !hasMention || promptValue.trim().length === 0}
                      >
                        Send
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

interface LineSelectionContext {
  readonly isLineSelected: (side: CommentSide, lineNumber: number | undefined) => boolean;
  readonly isLineSelectable: (side: CommentSide, lineNumber: number | undefined) => boolean;
  readonly onSelectLine: (
    event: ReactMouseEvent<HTMLButtonElement>,
    side: CommentSide,
    lineNumber: number | undefined,
  ) => void;
  readonly renderThreadIndicator: (side: CommentSide, lineNumber: number | undefined) => ReactNode;
}

function lineNumberButtonClass(selected: boolean): string {
  return cn(
    "min-w-[2.1rem] select-none rounded-sm px-1.5 text-right transition-colors",
    selected ? "bg-accent/18 font-semibold text-accent" : "text-muted/75 hover:bg-accent/10",
  );
}

function renderSplitLine(
  rowKey: string,
  line: DiffLine,
  language: SyntaxLanguage,
  selection: LineSelectionContext,
  featureTitle?: string,
) {
  const isAdded = line.kind === "add";
  const isRemoved = line.kind === "remove";
  const oldSelected = selection.isLineSelected("old", line.oldLineNumber);
  const newSelected = selection.isLineSelected("new", line.newLineNumber);
  const oldSelectable = selection.isLineSelectable("old", line.oldLineNumber);
  const newSelectable = selection.isLineSelectable("new", line.newLineNumber);

  const tooltip = lineFeatureTooltip(featureTitle);

  return (
    <div key={rowKey} className="grid grid-cols-2 font-mono text-[11px] leading-6">
      <div
        className={cn(
          "grid min-w-0 grid-cols-[3.25rem_1.25rem_minmax(0,1fr)] overflow-x-auto border-r border-border/30 pr-2",
          paneRowClass(line.kind, "left"),
          oldSelected && "ring-inset ring-1 ring-accent/40",
        )}
      >
        {!isAdded && line.oldLineNumber !== undefined ? (
          <div className="flex items-center justify-end gap-1 pr-1">
            {selection.renderThreadIndicator("old", line.oldLineNumber)}
            {oldSelectable ? (
              <button
                type="button"
                className={lineNumberButtonClass(oldSelected)}
                onClick={(event) => {
                  selection.onSelectLine(event, "old", line.oldLineNumber);
                }}
                aria-label={`Select old line ${line.oldLineNumber}`}
                title={tooltip}
              >
                {line.oldLineNumber}
              </button>
            ) : (
              <span className="select-none px-1.5 text-right text-muted/75" title={tooltip}>
                {line.oldLineNumber}
              </span>
            )}
          </div>
        ) : (
          <span className="select-none px-2 text-right text-muted/75" />
        )}
        <span
          className={cn(
            "select-none text-center text-muted/70",
            isRemoved && "text-danger",
          )}
        >
          {isRemoved ? "-" : ""}
        </span>
        <pre
          className={cn(
            "min-w-max whitespace-pre",
            textClass(),
            isAdded && "text-transparent",
          )}
        >
          {isAdded ? " " : renderHighlightedCode(line.text || " ", language)}
        </pre>
      </div>

      <div
        className={cn(
          "grid min-w-0 grid-cols-[3.25rem_1.25rem_minmax(0,1fr)] overflow-x-auto pl-2",
          paneRowClass(line.kind, "right"),
          newSelected && "ring-inset ring-1 ring-accent/40",
        )}
      >
        {!isRemoved && line.newLineNumber !== undefined ? (
          <div className="flex items-center justify-end gap-1 pr-1">
            {selection.renderThreadIndicator("new", line.newLineNumber)}
            {newSelectable ? (
              <button
                type="button"
                className={lineNumberButtonClass(newSelected)}
                onClick={(event) => {
                  selection.onSelectLine(event, "new", line.newLineNumber);
                }}
                aria-label={`Select new line ${line.newLineNumber}`}
                title={tooltip}
              >
                {line.newLineNumber}
              </button>
            ) : (
              <span className="select-none px-1.5 text-right text-muted/75" title={tooltip}>
                {line.newLineNumber}
              </span>
            )}
          </div>
        ) : (
          <span className="select-none px-2 text-right text-muted/75" />
        )}
        <span
          className={cn(
            "select-none text-center text-muted/70",
            isAdded && "text-positive",
          )}
        >
          {isAdded ? "+" : ""}
        </span>
        <pre
          className={cn(
            "min-w-max whitespace-pre pr-2",
            textClass(),
            isRemoved && "text-transparent",
          )}
        >
          {isRemoved ? " " : renderHighlightedCode(line.text || " ", language)}
        </pre>
      </div>
    </div>
  );
}

function renderUnifiedLine(
  rowKey: string,
  line: DiffLine,
  language: SyntaxLanguage,
  selection: LineSelectionContext,
  featureTitle?: string,
) {
  const marker = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
  const oldSelected = selection.isLineSelected("old", line.oldLineNumber);
  const newSelected = selection.isLineSelected("new", line.newLineNumber);
  const oldSelectable = selection.isLineSelectable("old", line.oldLineNumber);
  const newSelectable = selection.isLineSelectable("new", line.newLineNumber);

  const tooltip = lineFeatureTooltip(featureTitle);

  return (
    <div
      key={rowKey}
      className={cn(
        "grid grid-cols-[3.25rem_3.25rem_1.25rem_minmax(0,1fr)] font-mono text-[11px] leading-6",
        unifiedRowClass(line.kind),
        (oldSelected || newSelected) && "ring-inset ring-1 ring-accent/40",
      )}
    >
      {line.oldLineNumber !== undefined ? (
        <div className="flex items-center justify-end gap-1 pr-1">
          {selection.renderThreadIndicator("old", line.oldLineNumber)}
          {oldSelectable ? (
            <button
              type="button"
              className={lineNumberButtonClass(oldSelected)}
              onClick={(event) => {
                selection.onSelectLine(event, "old", line.oldLineNumber);
              }}
              aria-label={`Select old line ${line.oldLineNumber}`}
              title={tooltip}
            >
              {line.oldLineNumber}
            </button>
          ) : (
            <div className="select-none px-1.5 text-right text-muted/75" title={tooltip}>
              {line.oldLineNumber}
            </div>
          )}
        </div>
      ) : (
        <div className="select-none px-2 text-right text-muted/75" />
      )}
      {line.newLineNumber !== undefined ? (
        <div className="flex items-center justify-end gap-1 pr-1">
          {selection.renderThreadIndicator("new", line.newLineNumber)}
          {newSelectable ? (
            <button
              type="button"
              className={lineNumberButtonClass(newSelected)}
              onClick={(event) => {
                selection.onSelectLine(event, "new", line.newLineNumber);
              }}
              aria-label={`Select new line ${line.newLineNumber}`}
              title={tooltip}
            >
              {line.newLineNumber}
            </button>
          ) : (
            <div className="select-none px-1.5 text-right text-muted/75" title={tooltip}>
              {line.newLineNumber}
            </div>
          )}
        </div>
      ) : (
        <div className="select-none px-2 text-right text-muted/75" />
      )}
      <div className={cn("select-none text-center", markerClass(line.kind))}>{marker}</div>
      <pre className={cn("min-w-max whitespace-pre pr-2", textClass())}>
        {renderHighlightedCode(line.text || " ", language)}
      </pre>
    </div>
  );
}

function renderFullFileLine(
  mode: "old" | "new",
  rowKey: string,
  lineNumber: number,
  text: string,
  changed: boolean,
  language: SyntaxLanguage,
  selection: LineSelectionContext,
  featureTitle?: string,
) {
  const marker = changed ? (mode === "old" ? "-" : "+") : " ";
  const lineKind: DiffLineKind = changed ? (mode === "old" ? "remove" : "add") : "context";
  const side: CommentSide = mode;
  const selected = selection.isLineSelected(side, lineNumber);
  const selectable = selection.isLineSelectable(side, lineNumber);

  const tooltip = lineFeatureTooltip(featureTitle);

  return (
    <div
      key={rowKey}
      className={cn(
        "grid grid-cols-[3.75rem_1.25rem_minmax(0,1fr)] font-mono text-[11px] leading-6",
        changed && mode === "old" && "bg-danger/10",
        changed && mode === "new" && "bg-positive/10",
        selected && "ring-inset ring-1 ring-accent/40",
      )}
    >
      {selectable ? (
        <div className="flex items-center justify-end gap-1 pr-1">
          {selection.renderThreadIndicator(side, lineNumber)}
          <button
            type="button"
            className={lineNumberButtonClass(selected)}
            onClick={(event) => {
              selection.onSelectLine(event, side, lineNumber);
            }}
            aria-label={`Select ${mode} line ${lineNumber}`}
            title={tooltip}
          >
            {lineNumber}
          </button>
        </div>
      ) : (
        <div className="select-none px-2 text-right text-muted/75" title={tooltip}>
          {lineNumber}
        </div>
      )}
      <div
        className={cn(
          "select-none text-center text-muted/70",
          changed && mode === "old" && "text-danger",
          changed && mode === "new" && "text-positive",
        )}
      >
        {marker}
      </div>
      <pre
        className={cn(
          "min-w-max whitespace-pre pr-2",
          textClass(),
        )}
      >
        {renderHighlightedCode(text || " ", language)}
      </pre>
    </div>
  );
}

function emptyStateMessage(
  file: ChangedFile,
  viewMode: DiffViewMode,
): string {
  if (viewMode === "old") {
    if (file.status === "added") {
      return "This file does not exist in the parent commit.";
    }

    return "No old-file content is available for this path.";
  }

  if (file.status === "deleted") {
    return "This file is deleted in this commit.";
  }

  return "No new-file content is available for this path.";
}

function SplitIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </svg>
  );
}

function UnifiedIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 14h18" />
    </svg>
  );
}

export function DiffViewer({
  file,
  hunks,
  featureHunkNotice = null,
  hunkFeatureLabelsById = {},
  orientation,
  viewMode,
  threads = [],
  showInlineThreads = true,
  fileVersions,
  fileVersionsStatus,
  fileVersionsError,
  onOrientationChange,
  onViewModeChange,
  onAskAgent,
  onDeleteComment,
  onSetThreadStatus,
  onCreateThread,
  defaultAuthorId,
  toolbarActions,
  bodyOverride,
}: DiffViewerProps) {
  const reviewTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const draftImageRefsPreviousRef = useRef<ReadonlySet<string>>(new Set<string>());
  const skipDraftImageCleanupRefsRef = useRef(new Set<string>());
  const [expandedById, setExpandedById] = useState<Record<string, number>>({});
  const [promptByThreadId, setPromptByThreadId] = useState<Record<string, string>>({});
  const [selectedAnchors, setSelectedAnchors] = useState<readonly SelectableLineAnchor[]>([]);
  const [selectionPivot, setSelectionPivot] = useState<SelectableLineAnchor | null>(null);
  const [composerAnchor, setComposerAnchor] = useState<SelectableLineAnchor | null>(null);
  const [reviewBody, setReviewBody] = useState("");
  const isSummaryOverlay = bodyOverride !== undefined && bodyOverride !== null;
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const [revealedThreadId, setRevealedThreadId] = useState<string | null>(null);
  const [activeReplyThreadId, setActiveReplyThreadId] = useState<string | null>(null);
  const reviewBodyMentionSuggestion = useMemo(() => getCheckmateMentionSuggestion(reviewBody), [reviewBody]);
  const reviewBodyHasMention = useMemo(() => hasCheckmateMention(reviewBody), [reviewBody]);
  const reviewBodyImageRefs = useMemo(() => extractManagedCommentImageRefs(reviewBody), [reviewBody]);
  const promptImageRefsByThreadId = useMemo(() => {
    const next: Record<string, readonly string[]> = {};
    Object.entries(promptByThreadId).forEach(([threadId, prompt]) => {
      const refs = extractManagedCommentImageRefs(prompt);
      if (refs.length > 0) {
        next[threadId] = refs;
      }
    });
    return next;
  }, [promptByThreadId]);
  const allDraftImageRefs = useMemo(() => {
    const refs = new Set<string>(reviewBodyImageRefs);
    Object.values(promptImageRefsByThreadId).forEach((imageRefs) => {
      imageRefs.forEach((imageRef) => refs.add(imageRef));
    });
    return [...refs];
  }, [promptImageRefsByThreadId, reviewBodyImageRefs]);
  const draftStorageKey = useMemo(
    () => (file ? `${DIFF_COMMENT_DRAFT_STORAGE_KEY_PREFIX}${file.id}` : null),
    [file?.id],
  );
  const featureLabelsByHunkId = useMemo(() => {
    const normalized: Record<string, string> = {};
    Object.entries(hunkFeatureLabelsById).forEach(([hunkId, labels]) => {
      const filteredLabels = [...new Set(labels.map((label) => label.trim()).filter((label) => label.length > 0))];
      if (filteredLabels.length > 0) {
        normalized[hunkId] = filteredLabels.join(", ");
      }
    });
    return normalized;
  }, [hunkFeatureLabelsById]);
  const resolvedAuthorId = useMemo(() => {
    const normalized = defaultAuthorId?.trim() ?? "";
    return normalized.length > 0 ? normalized : "reviewer";
  }, [defaultAuthorId]);

  useEffect(() => {
    const savedDraft = readCommentDraftFromStorage(draftStorageKey);
    const savedDraftRefs = new Set<string>();
    if (savedDraft?.reviewBody) {
      extractManagedCommentImageRefs(savedDraft.reviewBody).forEach((imageRef) => {
        savedDraftRefs.add(imageRef);
      });
    }
    Object.values(savedDraft?.promptByThreadId ?? {}).forEach((promptValue) => {
      extractManagedCommentImageRefs(promptValue).forEach((imageRef) => {
        savedDraftRefs.add(imageRef);
      });
    });
    draftImageRefsPreviousRef.current = savedDraftRefs;
    skipDraftImageCleanupRefsRef.current.clear();
    setExpandedById({});
    setSelectedAnchors([]);
    setSelectionPivot(null);
    setComposerAnchor(null);
    setRevealedThreadId(null);
    setActiveReplyThreadId(null);
    setReviewBody(savedDraft?.reviewBody ?? "");
    setPromptByThreadId(savedDraft?.promptByThreadId ? { ...savedDraft.promptByThreadId } : {});
    setSelectionMessage(null);
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftStorageKey || typeof window === "undefined") {
      return;
    }

    const normalizedPromptByThreadId = Object.fromEntries(
      Object.entries(promptByThreadId).filter(([, prompt]) => prompt.trim().length > 0),
    );
    if (reviewBody.trim().length === 0 && Object.keys(normalizedPromptByThreadId).length === 0) {
      window.localStorage.removeItem(draftStorageKey);
      return;
    }

    const payload: DiffCommentDraft = {
      reviewBody,
      promptByThreadId: normalizedPromptByThreadId,
    };

    try {
      window.localStorage.setItem(draftStorageKey, JSON.stringify(payload));
    } catch {
      // Ignore localStorage quota/privacy errors.
    }
  }, [draftStorageKey, promptByThreadId, reviewBody]);

  useEffect(() => {
    const currentRefs = new Set(allDraftImageRefs);
    const previousRefs = draftImageRefsPreviousRef.current;

    const removedRefs = [...previousRefs].filter((imageRef) => !currentRefs.has(imageRef));
    const refsToDelete = removedRefs.filter((imageRef) => {
      if (skipDraftImageCleanupRefsRef.current.has(imageRef)) {
        skipDraftImageCleanupRefsRef.current.delete(imageRef);
        return false;
      }

      return true;
    });
    if (refsToDelete.length > 0) {
      void deleteCommentImages(refsToDelete).catch(() => {
        // Ignore image cleanup failures for draft edits.
      });
    }

    draftImageRefsPreviousRef.current = currentRefs;
  }, [allDraftImageRefs]);

  useEffect(() => {
    if (!activeReplyThreadId) {
      return;
    }

    const stillExists = threads.some((threadModel) => threadModel.thread.id === activeReplyThreadId);
    if (!stillExists) {
      setActiveReplyThreadId(null);
    }
  }, [activeReplyThreadId, threads]);

  const oldLines = useMemo(() => {
    return splitContentLines(fileVersions?.oldContent ?? null);
  }, [fileVersions?.oldContent]);

  const newLines = useMemo(() => {
    return splitContentLines(fileVersions?.newContent ?? null);
  }, [fileVersions?.newContent]);

  const changedLines = useMemo(() => {
    return collectChangedLineNumbers(hunks);
  }, [hunks]);

  const changeRows = useMemo(() => {
    return buildChangeRows(hunks, oldLines.length, newLines.length);
  }, [hunks, oldLines.length, newLines.length]);

  const hunkLineLookup = useMemo(() => {
    return buildHunkLineLookup(hunks);
  }, [hunks]);

  const syntaxLanguage = useMemo(() => languageForPath(file?.path), [file?.path]);

  const threadLookup = useMemo(() => {
    return buildThreadLookup(threads);
  }, [threads]);

  const selectableAnchors = useMemo(() => {
    if (!file) {
      return [];
    }

    const anchorsByKey = new Map<string, SelectableLineAnchor>();

    const upsertAnchor = (
      side: CommentSide,
      lineNumber: number | undefined,
      explicitHunkId?: string,
    ) => {
      if (lineNumber === undefined || lineNumber <= 0) {
        return;
      }

      const hunkId = explicitHunkId ?? resolveHunkIdForLine(hunkLineLookup, side, lineNumber);
      if (!hunkId) {
        return;
      }

      const key = selectableAnchorKey(side, lineNumber);
      if (anchorsByKey.has(key)) {
        return;
      }

      anchorsByKey.set(key, {
        key,
        side,
        lineNumber,
        hunkId,
      });
    };

    if (viewMode === "changes") {
      changeRows.forEach((row) => {
        if (row.kind === "line") {
          upsertAnchor("old", row.line.oldLineNumber, row.hunkId);
          upsertAnchor("new", row.line.newLineNumber, row.hunkId);
          return;
        }

        const oldTotal = row.oldEnd >= row.oldStart ? row.oldEnd - row.oldStart + 1 : 0;
        const newTotal = row.newEnd >= row.newStart ? row.newEnd - row.newStart + 1 : 0;
        const total = Math.max(oldTotal, newTotal);
        const expanded = expandCount(expandedById, row.id, total);

        for (let index = 0; index < expanded; index += 1) {
          const oldLineNumber = index < oldTotal ? row.oldStart + index : undefined;
          const newLineNumber = index < newTotal ? row.newStart + index : undefined;

          upsertAnchor("old", oldLineNumber);
          upsertAnchor("new", newLineNumber);
        }
      });
    } else {
      const side: CommentSide = viewMode;
      const lines = side === "old" ? oldLines : newLines;

      for (let lineNumber = 1; lineNumber <= lines.length; lineNumber += 1) {
        upsertAnchor(side, lineNumber);
      }
    }

    return sortSelectableAnchors([...anchorsByKey.values()]);
  }, [changeRows, expandedById, file, hunkLineLookup, newLines, oldLines, viewMode]);

  const selectableBySide = useMemo(() => {
    const old = new Map<number, SelectableLineAnchor>();
    const next = new Map<number, SelectableLineAnchor>();

    selectableAnchors.forEach((anchor) => {
      if (anchor.side === "old") {
        old.set(anchor.lineNumber, anchor);
        return;
      }

      next.set(anchor.lineNumber, anchor);
    });

    return {
      old,
      next,
      oldLineNumbers: [...old.keys()].sort((left, right) => left - right),
      newLineNumbers: [...next.keys()].sort((left, right) => left - right),
    };
  }, [selectableAnchors]);

  useEffect(() => {
    const selectableKeys = new Set(selectableAnchors.map((anchor) => anchor.key));

    setSelectedAnchors((current) => {
      const next = current.filter((anchor) => selectableKeys.has(anchor.key));
      return next.length === current.length ? current : next;
    });

    setSelectionPivot((current) => {
      if (!current) {
        return current;
      }

      return selectableKeys.has(current.key) ? current : null;
    });

    setComposerAnchor((current) => {
      if (!current) {
        return current;
      }

      return selectableKeys.has(current.key) ? current : null;
    });
  }, [selectableAnchors]);

  useEffect(() => {
    if (selectedAnchors.length > 0) {
      return;
    }

    setComposerAnchor(null);
    setSelectionMessage(null);
  }, [selectedAnchors.length]);

  useEffect(() => {
    if (!composerAnchor) {
      return;
    }

    const stillSelected = selectedAnchors.some((anchor) => anchor.key === composerAnchor.key);
    if (stillSelected) {
      return;
    }

    setComposerAnchor(selectedAnchors[selectedAnchors.length - 1] ?? null);
  }, [composerAnchor, selectedAnchors]);

  useEffect(() => {
    if (showInlineThreads) {
      setRevealedThreadId(null);
    }
  }, [showInlineThreads]);

  useEffect(() => {
    if (!revealedThreadId) {
      return;
    }

    const stillExists = threads.some((thread) => thread.thread.id === revealedThreadId);
    if (!stillExists) {
      setRevealedThreadId(null);
    }
  }, [revealedThreadId, threads]);

  const selectedLineNumbersBySide = useMemo(() => {
    const old = new Set<number>();
    const next = new Set<number>();

    selectedAnchors.forEach((anchor) => {
      if (anchor.side === "old") {
        old.add(anchor.lineNumber);
        return;
      }

      next.add(anchor.lineNumber);
    });

    return {
      old,
      next,
    };
  }, [selectedAnchors]);

  const isLineSelectable = (side: CommentSide, lineNumber: number | undefined): boolean => {
    if (lineNumber === undefined || lineNumber <= 0) {
      return false;
    }

    if (side === "old") {
      return selectableBySide.old.has(lineNumber);
    }

    return selectableBySide.next.has(lineNumber);
  };

  const isLineSelected = (side: CommentSide, lineNumber: number | undefined): boolean => {
    if (lineNumber === undefined || lineNumber <= 0) {
      return false;
    }

    if (side === "old") {
      return selectedLineNumbersBySide.old.has(lineNumber);
    }

    return selectedLineNumbersBySide.next.has(lineNumber);
  };

  const featureTitleForHunk = (hunkId: string | undefined | null): string | undefined => {
    if (!hunkId) {
      return undefined;
    }

    const labels = featureLabelsByHunkId[hunkId];
    if (!labels) {
      return undefined;
    }

    return `Feature focus: ${labels}`;
  };

  const insertReviewBodyAtCursor = (snippet: string) => {
    const textarea = reviewTextareaRef.current;
    if (!textarea) {
      setReviewBody((current) => (current.length > 0 ? `${current}\n${snippet}` : snippet));
      return;
    }

    const selectionStart = textarea.selectionStart ?? reviewBody.length;
    const selectionEnd = textarea.selectionEnd ?? reviewBody.length;
    const nextBody = `${reviewBody.slice(0, selectionStart)}${snippet}${reviewBody.slice(selectionEnd)}`;
    setReviewBody(nextBody);

    const nextCursor = selectionStart + snippet.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const removeDraftImage = (imageRef: string) => {
    setReviewBody((current) => removeManagedCommentImageFromMarkdown(current, imageRef));
  };

  const setThreadPrompt = (threadId: string, prompt: string) => {
    const normalizedThreadId = threadId.trim();
    if (normalizedThreadId.length === 0) {
      return;
    }

    setPromptByThreadId((current) => {
      if (prompt.length === 0) {
        if (!(normalizedThreadId in current)) {
          return current;
        }
        const { [normalizedThreadId]: _removed, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [normalizedThreadId]: prompt,
      };
    });
  };

  const markDraftImagesPersisted = (markdown: string) => {
    extractManagedCommentImageRefs(markdown).forEach((imageRef) => {
      skipDraftImageCleanupRefsRef.current.add(imageRef);
    });
  };

  const removeReplyDraftImage = (threadId: string, imageRef: string) => {
    const normalizedThreadId = threadId.trim();
    if (normalizedThreadId.length === 0) {
      return;
    }

    setPromptByThreadId((current) => {
      const currentPrompt = current[normalizedThreadId] ?? "";
      const nextPrompt = removeManagedCommentImageFromMarkdown(currentPrompt, imageRef);

      if (nextPrompt.length === 0) {
        if (!(normalizedThreadId in current)) {
          return current;
        }
        const { [normalizedThreadId]: _removed, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [normalizedThreadId]: nextPrompt,
      };
    });
  };

  const handleReviewBodyPaste = async (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    setSelectionMessage(null);

    let imageFiles = collectClipboardImageFiles(event.clipboardData);
    if (imageFiles.length === 0) {
      imageFiles = await readClipboardImageFilesFallback();
    }

    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();

    const { snippets, attempted } = await buildMarkdownSnippetsFromImageFiles(imageFiles);
    if (attempted > 0 && snippets.length < attempted) {
      setSelectionMessage("Some pasted images could not be attached.");
    }

    if (snippets.length === 0) {
      setSelectionMessage("Unable to attach pasted image from clipboard.");
      return;
    }

    const snippet = snippets.join("\n");
    insertReviewBodyAtCursor(
      reviewBody.length > 0 && !reviewBody.endsWith("\n") ? `\n${snippet}\n` : `${snippet}\n`,
    );
  };

  const handleReplyBodyPaste = async (
    threadId: string,
    event: ReactClipboardEvent<HTMLTextAreaElement>,
  ) => {
    const normalizedThreadId = threadId.trim();
    if (normalizedThreadId.length === 0) {
      return;
    }

    let imageFiles = collectClipboardImageFiles(event.clipboardData);
    if (imageFiles.length === 0) {
      imageFiles = await readClipboardImageFilesFallback();
    }
    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();

    const target = event.currentTarget;
    const selectionStart = target.selectionStart ?? 0;
    const selectionEnd = target.selectionEnd ?? selectionStart;

    const { snippets } = await buildMarkdownSnippetsFromImageFiles(imageFiles);
    if (snippets.length === 0) {
      return;
    }

    const snippet = snippets.join("\n");
    let nextCursor = selectionStart + snippet.length;
    setPromptByThreadId((current) => {
      const currentPrompt = current[normalizedThreadId] ?? "";
      const safeStart = Math.min(selectionStart, currentPrompt.length);
      const safeEnd = Math.min(Math.max(selectionEnd, safeStart), currentPrompt.length);
      const insertion = currentPrompt.length > 0 && !currentPrompt.endsWith("\n")
        ? `\n${snippet}\n`
        : `${snippet}\n`;
      const nextPrompt = `${currentPrompt.slice(0, safeStart)}${insertion}${currentPrompt.slice(safeEnd)}`;
      nextCursor = safeStart + insertion.length;
      return {
        ...current,
        [normalizedThreadId]: nextPrompt,
      };
    });

    requestAnimationFrame(() => {
      target.focus();
      target.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const onSelectLine = (
    event: ReactMouseEvent<HTMLButtonElement>,
    side: CommentSide,
    lineNumber: number | undefined,
  ) => {
    if (lineNumber === undefined) {
      return;
    }

    const targetAnchor =
      side === "old"
        ? selectableBySide.old.get(lineNumber)
        : selectableBySide.next.get(lineNumber);

    if (!targetAnchor) {
      return;
    }

    const additiveSelection = event.metaKey || event.ctrlKey;
    const canRangeSelect = Boolean(event.shiftKey && selectionPivot && selectionPivot.side === side);
    const orderedLineNumbers = side === "old" ? selectableBySide.oldLineNumbers : selectableBySide.newLineNumbers;
    const sideLookup = side === "old" ? selectableBySide.old : selectableBySide.next;

    setSelectedAnchors((current) => {
      if (canRangeSelect && selectionPivot) {
        const rangeStart = Math.min(selectionPivot.lineNumber, targetAnchor.lineNumber);
        const rangeEnd = Math.max(selectionPivot.lineNumber, targetAnchor.lineNumber);

        const rangeAnchors = orderedLineNumbers
          .filter((value) => value >= rangeStart && value <= rangeEnd)
          .map((value) => sideLookup.get(value))
          .filter((anchor): anchor is SelectableLineAnchor => anchor !== undefined);

        if (additiveSelection) {
          const merged = new Map(current.map((anchor) => [anchor.key, anchor] as const));
          rangeAnchors.forEach((anchor) => {
            merged.set(anchor.key, anchor);
          });
          return sortSelectableAnchors([...merged.values()]);
        }

        return sortSelectableAnchors(rangeAnchors);
      }

      if (additiveSelection) {
        const currentKeys = new Set(current.map((anchor) => anchor.key));

        if (currentKeys.has(targetAnchor.key)) {
          return current.filter((anchor) => anchor.key !== targetAnchor.key);
        }

        return sortSelectableAnchors([...current, targetAnchor]);
      }

      return [targetAnchor];
    });

    setSelectionPivot(targetAnchor);
    setComposerAnchor(targetAnchor);
    setSelectionMessage(null);
  };

  const submitSelectedThreads = () => {
    if (!onCreateThread) {
      setSelectionMessage("Thread creation is not available in this workspace.");
      return;
    }

    const normalizedBody = reviewBody.trim();
    if (normalizedBody.length === 0) {
      setSelectionMessage("Write a review comment before publishing selected lines.");
      return;
    }

    if (selectedAnchors.length === 0) {
      setSelectionMessage("Select at least one line.");
      return;
    }

    let successCount = 0;
    let firstFailure: string | null = null;

    selectedAnchors.forEach((anchor) => {
      const result = onCreateThread({
        hunkId: anchor.hunkId,
        side: anchor.side,
        lineNumber: anchor.lineNumber,
        body: normalizedBody,
        authorId: resolvedAuthorId,
      });

      if (result.ok) {
        successCount += 1;
        return;
      }

      if (!firstFailure) {
        firstFailure = `${anchor.side} line ${anchor.lineNumber}: ${result.message}`;
      }
    });

    if (firstFailure) {
      setSelectionMessage(
        successCount > 0
          ? `Added ${successCount} thread(s). First error: ${firstFailure}`
          : firstFailure,
      );
      return;
    }

    if (successCount > 0) {
      markDraftImagesPersisted(reviewBody);
      setReviewBody("");
      setSelectedAnchors([]);
      setSelectionPivot(null);
      setComposerAnchor(null);
      setSelectionMessage(null);
      return;
    }

    setSelectionMessage("No comments were created.");
  };

  const threadsForLine = (side: CommentSide, lineNumber: number | undefined): readonly ThreadViewModel[] => {
    if (lineNumber === undefined || lineNumber <= 0) {
      return [];
    }

    if (side === "old") {
      return threadLookup.old.get(lineNumber) ?? [];
    }

    return threadLookup.next.get(lineNumber) ?? [];
  };

  const renderThreadIndicator = (side: CommentSide, lineNumber: number | undefined): ReactNode => {
    if (showInlineThreads) {
      return null;
    }

    const rowThreads = threadsForLine(side, lineNumber);
    if (rowThreads.length === 0) {
      return null;
    }

    const primaryThreadId = rowThreads[0]?.thread.id;
    if (!primaryThreadId) {
      return null;
    }

    const isRevealed = revealedThreadId === primaryThreadId;
    const countLabel = rowThreads.length > 1 ? `${rowThreads.length}` : "•";

    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setRevealedThreadId((current) => (current === primaryThreadId ? null : primaryThreadId));
          setSelectionMessage(null);
        }}
        className={cn(
          "inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full border px-1 font-mono text-[9px] leading-none transition-colors",
          "border-caution/70 bg-caution/30 text-caution hover:bg-caution/45",
          isRevealed && "bg-caution/70 text-accent-contrast",
        )}
        aria-label={`Show comment on ${side} line ${lineNumber ?? 0}`}
        title={`${rowThreads.length} comment thread${rowThreads.length === 1 ? "" : "s"} on ${side} line ${lineNumber ?? 0}`}
      >
        {countLabel}
      </button>
    );
  };

  const renderRevealedThreadForLine = (
    rowKey: string,
    rowThreads: readonly ThreadViewModel[],
  ): ReactNode => {
    if (showInlineThreads || !revealedThreadId) {
      return null;
    }

    const focusedThread = rowThreads.find((threadModel) => threadModel.thread.id === revealedThreadId);
    if (!focusedThread) {
      return null;
    }

    return renderInlineThreads(
      rowKey,
      [focusedThread],
      promptByThreadId,
      setThreadPrompt,
      onAskAgent,
      onDeleteComment,
      onSetThreadStatus,
      activeReplyThreadId,
      (threadId) => {
        setActiveReplyThreadId((current) => (current === threadId ? null : threadId));
      },
      (threadId) => {
        setActiveReplyThreadId((current) => (current === threadId ? null : current));
      },
      promptImageRefsByThreadId,
      handleReplyBodyPaste,
      removeReplyDraftImage,
      markDraftImagesPersisted,
    );
  };

  const lineSelectionContext: LineSelectionContext = {
    isLineSelected,
    isLineSelectable,
    onSelectLine,
    renderThreadIndicator,
  };

  const renderInlineCommentComposer = (rowKey: string) => {
    if (!composerAnchor || selectedAnchors.length === 0) {
      return null;
    }

    return (
      <div key={rowKey} className="border-b border-border/35 bg-surface-subtle/45 px-3 py-2">
        <div
          className={cn(
            "max-w-[44rem] rounded-md border border-border/70 bg-canvas/80 p-2",
            composerAnchor.side === "new" && "ml-auto",
          )}
        >
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
            {selectedAnchors.length} selected · {composerAnchor.side}:{composerAnchor.lineNumber}
          </p>
          <label className="space-y-1 text-xs text-muted">
            Comment
            <Textarea
              ref={reviewTextareaRef}
              rows={3}
              value={reviewBody}
              onChange={(event) => setReviewBody(event.target.value)}
              onPaste={(event) => {
                void handleReviewBodyPaste(event);
              }}
              onKeyDown={(event) => {
                if (
                  (event.metaKey || event.ctrlKey)
                  && !event.shiftKey
                  && !event.altKey
                  && event.key.toLowerCase() === "a"
                ) {
                  event.preventDefault();
                  event.currentTarget.select();
                  return;
                }

                if ((event.key === "Tab" || event.key === "ArrowDown") && reviewBodyMentionSuggestion) {
                  event.preventDefault();
                  setReviewBody(applyCheckmateMentionSuggestion(reviewBody, reviewBodyMentionSuggestion));
                  return;
                }

                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  submitSelectedThreads();
                }
              }}
              placeholder="Write a review comment... Press Cmd/Ctrl+Enter to submit."
              className="text-sm"
            />
            {reviewBodyMentionSuggestion && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-border/70 bg-surface-subtle/60 px-2 py-1 text-[10px] text-text transition-colors hover:border-accent/45 hover:text-accent"
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  setReviewBody(applyCheckmateMentionSuggestion(reviewBody, reviewBodyMentionSuggestion));
                }}
              >
                <span className="rounded border border-accent/35 bg-accent/12 px-1 py-0.5 font-mono text-[9px] text-accent">
                  @checkmate
                </span>
                <span>Use mention</span>
              </button>
            )}
            {reviewBodyHasMention && (
              <p className="text-[10px] text-muted">
                Agent mention detected:{" "}
                <span className="rounded border border-accent/35 bg-accent/12 px-1 py-0.5 font-mono text-[9px] text-accent">
                  @checkmate
                </span>
              </p>
            )}
            {reviewBodyImageRefs.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-[0.08em] text-muted">Attached Images</p>
                <div className="flex flex-wrap gap-1.5">
                  {reviewBodyImageRefs.map((imageRef, index) => (
                    <button
                      key={`${imageRef}-${index}`}
                      type="button"
                      className="inline-flex items-center gap-1 rounded border border-border/70 bg-surface-subtle/60 px-2 py-1 text-[10px] text-text transition-colors hover:border-danger/55 hover:text-danger"
                      onClick={() => removeDraftImage(imageRef)}
                      title="Remove image"
                    >
                      <span className="font-mono">{imageRef}</span>
                      <span aria-hidden="true">✕</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </label>
          {selectionMessage && (
            <p className="mt-1 text-xs text-muted">{selectionMessage}</p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" onClick={submitSelectedThreads} disabled={!onCreateThread}>
              Comment
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelectedAnchors([]);
                setSelectionPivot(null);
                setComposerAnchor(null);
                setReviewBody("");
                setSelectionMessage(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const expandRange = (rangeId: string, total: number) => {
    if (total <= 0) {
      return;
    }

    setExpandedById((current) => {
      const nextExpanded = Math.min(total, (current[rangeId] ?? 0) + EXPANSION_STEP);
      return {
        ...current,
        [rangeId]: nextExpanded,
      };
    });
  };

  const renderCollapsedRangeControls = (
    key: string,
    oldHidden: number,
    newHidden: number,
    onExpand: () => void,
    disabled: boolean,
  ) => {
    const details =
      oldHidden === newHidden
        ? `${oldHidden} unchanged lines hidden`
        : `${oldHidden} old / ${newHidden} new lines hidden`;

    return (
      <div
        key={key}
        className="flex items-center justify-between gap-2 border-y border-border/50 bg-surface-subtle/30 px-3 py-1.5"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">{details}</p>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10px]"
          onClick={onExpand}
          disabled={disabled}
        >
          +{EXPANSION_STEP} lines
        </Button>
      </div>
    );
  };

  const renderChangesBody = () => {
    if (hunks.length === 0) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-sm text-muted">
          No parsed hunks available for this file.
        </div>
      );
    }

    const rows: ReactNode[] = [];

    if (orientation === "split") {
      rows.push(
        <div
          key="split-heading"
          className="sticky top-0 z-10 grid grid-cols-2 border-b border-border/50 bg-surface-subtle/85 text-[10px] uppercase tracking-[0.08em] text-muted backdrop-blur"
        >
          <p className="border-r border-border/30 px-3 py-1">Original</p>
          <p className="px-3 py-1">Updated</p>
        </div>,
      );
    }

    changeRows.forEach((row) => {
      if (row.kind === "line") {
        const rowThreads = collectThreadsForDiffLine(
          threadLookup,
          row.line.oldLineNumber,
          row.line.newLineNumber,
        );
        const inlineThreads = renderInlineThreads(
          `${row.id}-threads`,
          rowThreads,
          promptByThreadId,
          setThreadPrompt,
          onAskAgent,
          onDeleteComment,
          onSetThreadStatus,
          activeReplyThreadId,
          (threadId) => {
            setActiveReplyThreadId((current) => (current === threadId ? null : threadId));
          },
          (threadId) => {
            setActiveReplyThreadId((current) => (current === threadId ? null : current));
          },
          promptImageRefsByThreadId,
          handleReplyBodyPaste,
          removeReplyDraftImage,
          markDraftImagesPersisted,
        );

        if (showInlineThreads && inlineThreads) {
          rows.push(inlineThreads);
        }

        const node =
          (() => {
            const featureTitle = featureTitleForHunk(row.hunkId);
            return orientation === "split"
              ? renderSplitLine(row.id, row.line, syntaxLanguage, lineSelectionContext, featureTitle)
              : renderUnifiedLine(row.id, row.line, syntaxLanguage, lineSelectionContext, featureTitle);
          })();
        rows.push(node);

        if (diffLineMatchesAnchor(row.line, composerAnchor)) {
          const composerNode = renderInlineCommentComposer(`${row.id}-comment-composer`);
          if (composerNode) {
            rows.push(composerNode);
          }
        }

        const revealedThreadNode = renderRevealedThreadForLine(`${row.id}-revealed-thread`, rowThreads);
        if (revealedThreadNode) {
          rows.push(revealedThreadNode);
        }

        return;
      }

      const oldTotal = row.oldEnd >= row.oldStart ? row.oldEnd - row.oldStart + 1 : 0;
      const newTotal = row.newEnd >= row.newStart ? row.newEnd - row.newStart + 1 : 0;
      const total = Math.max(oldTotal, newTotal);
      if (total <= 0) {
        return;
      }

      const expanded = expandCount(expandedById, row.id, total);

      for (let index = 0; index < expanded; index += 1) {
        const oldLineNumber = index < oldTotal ? row.oldStart + index : undefined;
        const newLineNumber = index < newTotal ? row.newStart + index : undefined;
        const oldText = oldLineNumber ? lineTextAt(oldLines, oldLineNumber) : "";
        const newText = newLineNumber ? lineTextAt(newLines, newLineNumber) : "";
        const line = buildGapLine(oldLineNumber, newLineNumber, oldText, newText);
        const rowId = `${row.id}-expanded-${index}`;
        const rowThreads = collectThreadsForDiffLine(threadLookup, oldLineNumber, newLineNumber);
        const inlineThreads = renderInlineThreads(
          `${rowId}-threads`,
          rowThreads,
          promptByThreadId,
          setThreadPrompt,
          onAskAgent,
          onDeleteComment,
          onSetThreadStatus,
          activeReplyThreadId,
          (threadId) => {
            setActiveReplyThreadId((current) => (current === threadId ? null : threadId));
          },
          (threadId) => {
            setActiveReplyThreadId((current) => (current === threadId ? null : current));
          },
          promptImageRefsByThreadId,
          handleReplyBodyPaste,
          removeReplyDraftImage,
          markDraftImagesPersisted,
        );

        if (showInlineThreads && inlineThreads) {
          rows.push(inlineThreads);
        }

        const fallbackHunkId =
          (oldLineNumber !== undefined ? hunkLineLookup.oldByLine.get(oldLineNumber) : undefined)
          ?? (newLineNumber !== undefined ? hunkLineLookup.newByLine.get(newLineNumber) : undefined);
        const featureTitle = featureTitleForHunk(fallbackHunkId);
        rows.push(
          orientation === "split"
            ? renderSplitLine(rowId, line, syntaxLanguage, lineSelectionContext, featureTitle)
            : renderUnifiedLine(rowId, line, syntaxLanguage, lineSelectionContext, featureTitle),
        );

        if (diffLineMatchesAnchor(line, composerAnchor)) {
          const composerNode = renderInlineCommentComposer(`${rowId}-comment-composer`);
          if (composerNode) {
            rows.push(composerNode);
          }
        }

        const revealedThreadNode = renderRevealedThreadForLine(`${rowId}-revealed-thread`, rowThreads);
        if (revealedThreadNode) {
          rows.push(revealedThreadNode);
        }
      }

      const oldHidden = Math.max(0, oldTotal - expanded);
      const newHidden = Math.max(0, newTotal - expanded);
      const canExpand = total > expanded;

      if (oldHidden > 0 || newHidden > 0) {
        rows.push(
          renderCollapsedRangeControls(
            `${row.id}-collapsed`,
            oldHidden,
            newHidden,
            () => {
              expandRange(row.id, total);
            },
            fileVersionsStatus !== "loaded" || !canExpand,
          ),
        );
      }
    });

    if (rows.length === 0) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-sm text-muted">
          No visible diff rows for this file.
        </div>
      );
    }

    return <div className="min-w-0">{rows}</div>;
  };

  const renderFullModeBody = (mode: "old" | "new") => {
    if (!file) {
      return null;
    }

    const lines = mode === "old" ? oldLines : newLines;
    const changedSet = mode === "old" ? changedLines.old : changedLines.next;

    if (
      (fileVersionsStatus === "loading" || fileVersionsStatus === "idle") &&
      lines.length === 0
    ) {
      return (
        <div className="space-y-2 px-4 py-4">
          <Skeleton height={11} width="32%" />
          <Skeleton height={10} count={12} />
        </div>
      );
    }

    if (fileVersionsStatus === "error" && lines.length === 0) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-sm text-danger">
          {fileVersionsError ?? "Failed to load file content."}
        </div>
      );
    }

    if (lines.length === 0) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-sm text-muted">
          {emptyStateMessage(file, mode)}
        </div>
      );
    }

    const rows: ReactNode[] = [];

    for (let lineNumber = 1; lineNumber <= lines.length; lineNumber += 1) {
      const rowThreads = mode === "old"
        ? threadLookup.old.get(lineNumber) ?? []
        : threadLookup.next.get(lineNumber) ?? [];
      const inlineThreads = renderInlineThreads(
        `${mode}-line-${lineNumber}-threads`,
        rowThreads,
        promptByThreadId,
        setThreadPrompt,
        onAskAgent,
        onDeleteComment,
        onSetThreadStatus,
        activeReplyThreadId,
        (threadId) => {
          setActiveReplyThreadId((current) => (current === threadId ? null : threadId));
        },
        (threadId) => {
          setActiveReplyThreadId((current) => (current === threadId ? null : current));
        },
        promptImageRefsByThreadId,
        handleReplyBodyPaste,
        removeReplyDraftImage,
        markDraftImagesPersisted,
      );

      if (showInlineThreads && inlineThreads) {
        rows.push(inlineThreads);
      }

      rows.push(
        renderFullFileLine(
          mode,
          `${mode}-line-${lineNumber}`,
          lineNumber,
          lineTextAt(lines, lineNumber),
          changedSet.has(lineNumber),
          syntaxLanguage,
          lineSelectionContext,
          featureTitleForHunk(
            mode === "old"
              ? hunkLineLookup.oldByLine.get(lineNumber)
              : hunkLineLookup.newByLine.get(lineNumber),
          ),
        ),
      );

      if (composerAnchor && composerAnchor.side === mode && composerAnchor.lineNumber === lineNumber) {
        const composerNode = renderInlineCommentComposer(`${mode}-line-${lineNumber}-comment-composer`);
        if (composerNode) {
          rows.push(composerNode);
        }
      }

      const revealedThreadNode = renderRevealedThreadForLine(
        `${mode}-line-${lineNumber}-revealed-thread`,
        rowThreads,
      );
      if (revealedThreadNode) {
        rows.push(revealedThreadNode);
      }
    }

    return <div className="min-w-0">{rows}</div>;
  };

  return (
    <section className="flex h-full min-h-[28rem] flex-col overflow-hidden bg-canvas">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-surface-subtle/40 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate font-mono text-xs text-text">
              {file ? file.path : "Select a changed file from the sidebar"}
            </p>
            {featureHunkNotice && (
              <span className="inline-flex shrink-0 items-center rounded border border-caution/45 bg-caution/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.07em] text-caution">
                {featureHunkNotice}
              </span>
            )}
          </div>
          {file && (
            <p className="truncate text-[11px] text-muted">
              {file.status} · +{file.additions} / -{file.deletions}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {toolbarActions}
          <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-canvas/70 p-0.5">
            <Button
              size="sm"
              variant={isSummaryOverlay ? "ghost" : viewMode === "changes" ? "primary" : "ghost"}
              aria-pressed={isSummaryOverlay ? false : viewMode === "changes"}
              onClick={() => onViewModeChange("changes")}
              className="h-7 px-2"
            >
              Changes
            </Button>
            <Button
              size="sm"
              variant={isSummaryOverlay ? "ghost" : viewMode === "old" ? "primary" : "ghost"}
              aria-pressed={isSummaryOverlay ? false : viewMode === "old"}
              onClick={() => onViewModeChange("old")}
              className="h-7 px-2"
            >
              Old
            </Button>
            <Button
              size="sm"
              variant={isSummaryOverlay ? "ghost" : viewMode === "new" ? "primary" : "ghost"}
              aria-pressed={isSummaryOverlay ? false : viewMode === "new"}
              onClick={() => onViewModeChange("new")}
              className="h-7 px-2"
            >
              New
            </Button>
          </div>
          {viewMode === "changes" && (
            <div className="inline-flex items-center gap-1">
              <Button
                size="sm"
                variant={isSummaryOverlay ? "ghost" : orientation === "split" ? "primary" : "ghost"}
                aria-pressed={isSummaryOverlay ? false : orientation === "split"}
                onClick={() => onOrientationChange("split")}
                className="h-9 w-9 px-0"
                aria-label="Split diff view"
                title="Split diff view"
              >
                <SplitIcon />
              </Button>
              <Button
                size="sm"
                variant={isSummaryOverlay ? "ghost" : orientation === "unified" ? "primary" : "ghost"}
                aria-pressed={isSummaryOverlay ? false : orientation === "unified"}
                onClick={() => onOrientationChange("unified")}
                className="h-9 w-9 px-0"
                aria-label="Unified diff view"
                title="Unified diff view"
              >
                <UnifiedIcon />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {bodyOverride}
        {!bodyOverride && !file && (
          <div className="flex h-full items-center justify-center px-6 text-sm text-muted">
            Choose a file to inspect the diff.
          </div>
        )}
        {!bodyOverride && file && viewMode === "changes" && renderChangesBody()}
        {!bodyOverride && file && viewMode === "old" && renderFullModeBody("old")}
        {!bodyOverride && file && viewMode === "new" && renderFullModeBody("new")}
      </div>
    </section>
  );
}
