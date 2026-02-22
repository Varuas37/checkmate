import { Fragment, type ReactNode } from "react";

import { cn, splitTextByCheckmateMention } from "../../../shared/index.ts";

export interface MarkdownCommentProps {
  readonly body: string;
  readonly className?: string;
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
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^)]+\))/g;

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
        <pre
          key={nextKey()}
          className="overflow-x-auto rounded border border-border/60 bg-canvas/70 p-3 text-xs"
        >
          <code className={cn(language.length > 0 && `language-${language}`)}>
            {codeLines.join("\n")}
          </code>
        </pre>,
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
