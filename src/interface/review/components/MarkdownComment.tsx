import { Fragment, useEffect, useState, type ReactNode } from "react";

import {
  cn,
  isManagedCommentImageUrl,
  normalizeManagedCommentImageRef,
  resolveCommentImageDataUrl,
  splitTextByCheckmateMention,
} from "../../../shared/index.ts";

export interface MarkdownCommentProps {
  readonly body: string;
  readonly className?: string;
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

interface CodeFenceBlockProps {
  readonly code: string;
  readonly language: string;
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

function normalizeFenceLanguage(value: string): SyntaxLanguage {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return "text";
  }

  if (
    normalized === "typescript" ||
    normalized === "ts" ||
    normalized === "tsx" ||
    normalized === "mts" ||
    normalized === "cts"
  ) {
    return "typescript";
  }

  if (
    normalized === "javascript" ||
    normalized === "js" ||
    normalized === "jsx" ||
    normalized === "mjs" ||
    normalized === "cjs"
  ) {
    return "javascript";
  }

  if (normalized === "json" || normalized === "jsonc") {
    return "json";
  }

  if (normalized === "rust" || normalized === "rs") {
    return "rust";
  }

  if (
    normalized === "shell" ||
    normalized === "sh" ||
    normalized === "bash" ||
    normalized === "zsh" ||
    normalized === "fish"
  ) {
    return "shell";
  }

  if (normalized === "markdown" || normalized === "md" || normalized === "mdx") {
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

function pushSyntaxToken(tokens: SyntaxToken[], kind: SyntaxTokenKind, text: string): void {
  if (text.length === 0) {
    return;
  }

  const previous = tokens[tokens.length - 1];
  if (previous && previous.kind === kind) {
    tokens[tokens.length - 1] = {
      kind,
      text: `${previous.text}${text}`,
    };
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

function tokenizeSyntaxLine(text: string, language: SyntaxLanguage): readonly SyntaxToken[] {
  if (text.length === 0) {
    return [{ kind: "plain", text: "" }];
  }

  const tokens: SyntaxToken[] = [];
  const keywords = keywordSetForLanguage(language);
  let index = 0;

  while (index < text.length) {
    const current = text[index] ?? "";
    const next = text[index + 1] ?? "";

    if (current === "/" && next === "/") {
      pushSyntaxToken(tokens, "comment", text.slice(index));
      break;
    }

    if (current === "/" && next === "*") {
      const close = text.indexOf("*/", index + 2);
      const end = close >= 0 ? close + 2 : text.length;
      pushSyntaxToken(tokens, "comment", text.slice(index, end));
      index = end;
      continue;
    }

    if ((language === "shell" || language === "markdown") && current === "#") {
      pushSyntaxToken(tokens, "comment", text.slice(index));
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

      pushSyntaxToken(tokens, "string", text.slice(index, cursor));
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

      pushSyntaxToken(tokens, "number", text.slice(index, cursor));
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
        pushSyntaxToken(tokens, "keyword", word);
      } else if (/^[A-Z][A-Za-z0-9_]*$/.test(word)) {
        pushSyntaxToken(tokens, "type", word);
      } else {
        pushSyntaxToken(tokens, "plain", word);
      }

      index = cursor;
      continue;
    }

    pushSyntaxToken(tokens, "plain", current);
    index += 1;
  }

  return tokens;
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

  return "text-text";
}

function renderHighlightedCode(code: string, language: SyntaxLanguage): ReactNode[] {
  const lines = code.split("\n");

  return lines.map((line, lineIndex) => {
    const tokens = tokenizeSyntaxLine(line, language);

    return (
      <Fragment key={`code-line-${lineIndex}`}>
        {tokens.map((token, tokenIndex) => (
          <span
            key={`code-line-${lineIndex}-${token.kind}-${tokenIndex}`}
            className={syntaxTokenClass(token.kind)}
          >
            {token.text}
          </span>
        ))}
        {lineIndex < lines.length - 1 ? "\n" : null}
      </Fragment>
    );
  });
}

async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the legacy copy command for non-secure clipboard contexts.
    }
  }

  if (typeof document === "undefined") {
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.opacity = "0";
  textArea.style.pointerEvents = "none";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textArea);
  }
}

function CopyCodeIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <rect x="2" y="2" width="13" height="13" rx="2" />
    </svg>
  );
}

function CodeFenceBlock({ code, language }: CodeFenceBlockProps): ReactNode {
  const normalizedLanguage = normalizeFenceLanguage(language);

  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded border border-border/60 bg-canvas/70 p-3 pb-8 pr-11 text-xs">
        <code className={cn("font-mono", language.length > 0 && `language-${language}`)}>
          {renderHighlightedCode(code, normalizedLanguage)}
        </code>
      </pre>
      <button
        type="button"
        className={cn(
          "absolute bottom-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded border border-border/70 bg-surface-subtle/70 text-muted transition-colors",
          "hover:border-accent/45 hover:text-accent",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/65",
        )}
        onClick={() => {
          void copyToClipboard(code);
        }}
        aria-label="Copy code block"
        title="Copy code"
      >
        <CopyCodeIcon />
      </button>
    </div>
  );
}

interface ManagedCommentImageProps {
  readonly imageRef: string;
  readonly alt: string;
}

function ManagedCommentImage({ imageRef, alt }: ManagedCommentImageProps): ReactNode {
  const [src, setSrc] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setLoadError(false);

    void resolveCommentImageDataUrl(imageRef)
      .then((resolved) => {
        if (cancelled) {
          return;
        }
        setSrc(resolved);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setLoadError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [imageRef]);

  if (loadError) {
    return (
      <span className="inline-flex rounded border border-danger/45 bg-danger/10 px-1.5 py-0.5 text-[10px] text-danger">
        Failed to load image
      </span>
    );
  }

  if (!src) {
    return (
      <span className="inline-flex rounded border border-border/60 bg-surface-subtle/50 px-1.5 py-0.5 text-[10px] text-muted">
        Loading image...
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className="max-h-72 max-w-full rounded border border-border/70 bg-canvas/70 object-contain"
      loading="lazy"
    />
  );
}

function renderMention(value: string, key: string): ReactNode {
  return (
    <span
      key={key}
      className="inline-flex items-center rounded border border-accent/35 bg-accent/12 px-1 py-0.5 font-mono text-[10px] leading-4 text-accent"
    >
      {value}
    </span>
  );
}

function pushPlainWithMentions(
  target: ReactNode[],
  text: string,
  keyPrefix: string,
  startIndex: number,
): number {
  let offset = startIndex;
  const segments = splitTextByCheckmateMention(text);
  segments.forEach((segment) => {
    const key = `${keyPrefix}-${offset}`;
    offset += 1;

    if (segment.kind === "mention") {
      target.push(renderMention(segment.value, key));
      return;
    }

    if (segment.value.length > 0) {
      target.push(<Fragment key={key}>{segment.value}</Fragment>);
    }
  });

  return offset;
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern =
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|!\[[^\]\n]*\]\([^)]+\)|\[[^\]\n]+\]\([^)]+\))/g;

  let cursor = 0;
  let keyIndex = 0;

  for (;;) {
    const match = tokenPattern.exec(text);
    if (!match) {
      break;
    }

    const start = match.index;
    const token = match[0] ?? "";

    if (start > cursor) {
      keyIndex = pushPlainWithMentions(
        nodes,
        text.slice(cursor, start),
        `${keyPrefix}-plain`,
        keyIndex,
      );
    }

    const tokenKey = `${keyPrefix}-token-${keyIndex}`;
    keyIndex += 1;

    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={tokenKey}
          className="rounded bg-surface-subtle/75 px-1 py-0.5 font-mono text-[0.95em] text-text"
        >
          {token.slice(1, -1)}
        </code>,
      );
      cursor = start + token.length;
      continue;
    }

    if (
      (token.startsWith("**") && token.endsWith("**")) ||
      (token.startsWith("__") && token.endsWith("__"))
    ) {
      nodes.push(
        <strong key={tokenKey} className="font-semibold text-text">
          {token.slice(2, -2)}
        </strong>,
      );
      cursor = start + token.length;
      continue;
    }

    if (
      (token.startsWith("*") && token.endsWith("*")) ||
      (token.startsWith("_") && token.endsWith("_"))
    ) {
      nodes.push(
        <em key={tokenKey} className="italic text-text">
          {token.slice(1, -1)}
        </em>,
      );
      cursor = start + token.length;
      continue;
    }

    const imageMatch = token.match(/^!\[([^\]\n]*)\]\(([^)\s]+)\)$/);
    if (imageMatch) {
      const alt = (imageMatch[1] ?? "Comment image").trim() || "Comment image";
      const imageUrl = imageMatch[2] ?? "";

      if (isManagedCommentImageUrl(imageUrl)) {
        const imageRef = normalizeManagedCommentImageRef(imageUrl);
        if (imageRef) {
          nodes.push(
            <ManagedCommentImage key={tokenKey} imageRef={imageRef} alt={alt} />,
          );
          cursor = start + token.length;
          continue;
        }
      }

      if (imageUrl.startsWith("https://") || imageUrl.startsWith("http://")) {
        nodes.push(
          <img
            key={tokenKey}
            src={imageUrl}
            alt={alt}
            className="max-h-72 max-w-full rounded border border-border/70 bg-canvas/70 object-contain"
            loading="lazy"
          />,
        );
        cursor = start + token.length;
        continue;
      }
    }

    const linkMatch = token.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)$/);
    if (linkMatch) {
      const label = linkMatch[1] ?? "link";
      const href = linkMatch[2] ?? "#";
      const safeHref =
        href.startsWith("https://") || href.startsWith("http://") ? href : "#";
      nodes.push(
        <a
          key={tokenKey}
          href={safeHref}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-accent/50 underline-offset-2 transition-colors hover:text-accent"
        >
          {label}
        </a>,
      );
      cursor = start + token.length;
      continue;
    }

    keyIndex = pushPlainWithMentions(nodes, token, `${keyPrefix}-fallback`, keyIndex);
    cursor = start + token.length;
  }

  if (cursor < text.length) {
    pushPlainWithMentions(
      nodes,
      text.slice(cursor),
      `${keyPrefix}-tail`,
      keyIndex,
    );
  }

  return nodes;
}

function renderParagraph(lines: readonly string[], key: string): ReactNode {
  const text = lines.join(" ").trim();
  if (text.length === 0) {
    return null;
  }

  return (
    <p key={key} className="whitespace-pre-wrap break-words">
      {renderInlineMarkdown(text, key)}
    </p>
  );
}

function renderList(
  lines: readonly string[],
  ordered: boolean,
  key: string,
): ReactNode {
  const ListTag = ordered ? "ol" : "ul";
  const markerClass = ordered ? "list-decimal" : "list-disc";

  return (
    <ListTag key={key} className={cn("ml-5 space-y-1", markerClass)}>
      {lines.map((line, index) => {
        const stripped = ordered
          ? line.replace(/^\s*\d+\.\s+/, "")
          : line.replace(/^\s*[-*+]\s+/, "");
        return <li key={`${key}-item-${index}`}>{renderInlineMarkdown(stripped, `${key}-item-${index}`)}</li>;
      })}
    </ListTag>
  );
}

function renderBlocks(markdown: string): ReactNode[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let blockIndex = 0;

  const nextKey = () => {
    blockIndex += 1;
    return `md-block-${blockIndex}`;
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      index += 1;
      continue;
    }

    const fenceMatch = trimmed.match(/^```([a-z0-9_-]+)?$/i);
    if (fenceMatch) {
      const language = fenceMatch[1]?.toLowerCase() ?? "";
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }

      blocks.push(
        <CodeFenceBlock key={nextKey()} code={codeLines.join("\n")} language={language} />,
      );
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1]?.length ?? 1;
      const headingText = headingMatch[2] ?? "";
      const HeadingTag =
        level <= 1
          ? "h1"
          : level === 2
            ? "h2"
            : level === 3
              ? "h3"
              : level === 4
                ? "h4"
                : level === 5
                  ? "h5"
                  : "h6";
      blocks.push(
        <HeadingTag key={nextKey()} className="font-display font-semibold text-text">
          {renderInlineMarkdown(headingText, `md-heading-${blockIndex}`)}
        </HeadingTag>,
      );
      index += 1;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const listLines: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index] ?? "")) {
        listLines.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push(renderList(listLines, false, nextKey()));
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const listLines: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? "")) {
        listLines.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push(renderList(listLines, true, nextKey()));
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index] ?? "")) {
        quoteLines.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote
          key={nextKey()}
          className="border-l-2 border-border/70 pl-3 text-muted"
        >
          {renderParagraph(quoteLines, `${nextKey()}-quote`)}
        </blockquote>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index] ?? "";
      const candidateTrimmed = candidate.trim();
      if (candidateTrimmed.length === 0) {
        break;
      }
      if (
        candidateTrimmed.startsWith("```") ||
        /^#{1,6}\s+/.test(candidateTrimmed) ||
        /^\s*[-*+]\s+/.test(candidate) ||
        /^\s*\d+\.\s+/.test(candidate) ||
        /^\s*>/.test(candidate)
      ) {
        break;
      }

      paragraphLines.push(candidate);
      index += 1;
    }

    blocks.push(renderParagraph(paragraphLines, nextKey()));
  }

  return blocks.filter((block): block is ReactNode => block !== null);
}

export function MarkdownComment({ body, className }: MarkdownCommentProps) {
  const normalized = body.trim();
  if (normalized.length === 0) {
    return null;
  }

  return <div className={cn("space-y-2", className)}>{renderBlocks(normalized)}</div>;
}
