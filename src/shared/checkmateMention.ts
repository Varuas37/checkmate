export interface MentionSuggestion {
  readonly query: string;
  readonly start: number;
  readonly end: number;
}

export interface MentionSegment {
  readonly kind: "text" | "mention";
  readonly value: string;
}

const CHECKMATE_MENTION_PATTERN = /(^|\s)@\s*checkmate\b/i;
const CHECKMATE_MENTION_GLOBAL_PATTERN = /(^|\s)@\s*checkmate\b/gi;
const TRAILING_MENTION_PATTERN = /(^|\s)@\s*([a-z0-9_-]*)$/i;
const CHECKMATE_HANDLE = "checkmate";

export function hasCheckmateMention(value: string): boolean {
  return CHECKMATE_MENTION_PATTERN.test(value);
}

export function stripCheckmateMentions(value: string): string {
  return value
    .replace(CHECKMATE_MENTION_GLOBAL_PATTERN, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function getCheckmateMentionSuggestion(value: string): MentionSuggestion | null {
  const match = value.match(TRAILING_MENTION_PATTERN);
  if (!match) {
    return null;
  }

  const leadingGap = match[1] ?? "";
  const query = (match[2] ?? "").toLowerCase();
  if (!CHECKMATE_HANDLE.startsWith(query)) {
    return null;
  }

  if (query === CHECKMATE_HANDLE) {
    return null;
  }

  const fullMatch = match[0];
  const mentionStart = value.length - fullMatch.length + leadingGap.length;

  return {
    query,
    start: mentionStart,
    end: value.length,
  };
}

export function applyCheckmateMentionSuggestion(
  value: string,
  suggestion: MentionSuggestion,
): string {
  const prefix = value.slice(0, suggestion.start);
  const suffix = value.slice(suggestion.end);
  return `${prefix}@checkmate ${suffix}`;
}

export function splitTextByCheckmateMention(value: string): readonly MentionSegment[] {
  const segments = value.split(/(@\s*checkmate\b)/gi);
  const result: MentionSegment[] = [];

  segments.forEach((segment) => {
    if (segment.length === 0) {
      return;
    }

    if (/^@\s*checkmate$/i.test(segment)) {
      result.push({
        kind: "mention",
        value: segment,
      });
      return;
    }

    result.push({
      kind: "text",
      value: segment,
    });
  });

  return result;
}
