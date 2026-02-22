import type {
  AiFileSummary,
  AiFlowComparison,
  AiOverviewCard,
  AiSequenceStep,
} from "../../domain/review/index.ts";

const STORAGE_KEY = "codelens-ai-analysis-cache.v1";
const MAX_CACHE_ENTRIES = 80;

export interface CachedAiAnalysisData {
  readonly overviewCards: readonly AiOverviewCard[];
  readonly flowComparisons: readonly AiFlowComparison[];
  readonly sequenceSteps: readonly AiSequenceStep[];
  readonly fileSummaries: readonly AiFileSummary[];
}

interface AiAnalysisCacheEntry extends CachedAiAnalysisData {
  readonly key: string;
  readonly repositoryPath: string;
  readonly commitSha: string;
  readonly updatedAtIso: string;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildCacheKey(repositoryPath: string, commitSha: string): string {
  return `${repositoryPath}::${commitSha}`;
}

function normalizeOverviewCard(value: unknown): AiOverviewCard | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const card = value as Partial<AiOverviewCard>;
  const kind = normalizeText(card.kind);
  const title = normalizeText(card.title);
  const body = normalizeText(card.body);

  if (!["summary", "impact", "risk", "question"].includes(kind)) {
    return null;
  }

  if (title.length === 0 || body.length === 0) {
    return null;
  }

  return {
    kind,
    title,
    body,
  } as AiOverviewCard;
}

function normalizeFlowComparison(value: unknown): AiFlowComparison | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const pair = value as Partial<AiFlowComparison>;
  const beforeTitle = normalizeText(pair.beforeTitle);
  const beforeBody = normalizeText(pair.beforeBody);
  const afterTitle = normalizeText(pair.afterTitle);
  const afterBody = normalizeText(pair.afterBody);
  const filePaths = Array.isArray(pair.filePaths)
    ? pair.filePaths
        .map((path) => normalizeText(path))
        .filter((path) => path.length > 0)
    : [];

  if (
    beforeTitle.length === 0 ||
    beforeBody.length === 0 ||
    afterTitle.length === 0 ||
    afterBody.length === 0
  ) {
    return null;
  }

  return {
    beforeTitle,
    beforeBody,
    afterTitle,
    afterBody,
    filePaths,
  };
}

function normalizeSequenceStep(value: unknown): AiSequenceStep | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const step = value as Partial<AiSequenceStep>;
  const token = normalizeText(step.token);
  const sourceId = normalizeText(step.sourceId);
  const sourceLabel = normalizeText(step.sourceLabel);
  const targetId = normalizeText(step.targetId);
  const targetLabel = normalizeText(step.targetLabel);
  const message = normalizeText(step.message);
  const filePath = normalizeText(step.filePath);

  if (
    sourceLabel.length === 0 ||
    targetLabel.length === 0 ||
    message.length === 0 ||
    filePath.length === 0
  ) {
    return null;
  }

  return {
    ...(token.length > 0 ? { token } : {}),
    ...(sourceId.length > 0 ? { sourceId } : {}),
    sourceLabel,
    ...(targetId.length > 0 ? { targetId } : {}),
    targetLabel,
    message,
    filePath,
  };
}

function normalizeFileSummary(value: unknown): AiFileSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const summary = value as Partial<AiFileSummary>;
  const filePath = normalizeText(summary.filePath);
  const text = normalizeText(summary.summary);
  const riskNote = normalizeText(summary.riskNote);

  if (filePath.length === 0 || text.length === 0 || riskNote.length === 0) {
    return null;
  }

  return {
    filePath,
    summary: text,
    riskNote,
  };
}

function normalizeCachedData(value: unknown): CachedAiAnalysisData | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Partial<CachedAiAnalysisData>;
  const overviewCards = Array.isArray(input.overviewCards)
    ? input.overviewCards
        .map((card) => normalizeOverviewCard(card))
        .filter((card): card is AiOverviewCard => card !== null)
    : [];
  const flowComparisons = Array.isArray(input.flowComparisons)
    ? input.flowComparisons
        .map((pair) => normalizeFlowComparison(pair))
        .filter((pair): pair is AiFlowComparison => pair !== null)
    : [];
  const sequenceSteps = Array.isArray(input.sequenceSteps)
    ? input.sequenceSteps
        .map((step) => normalizeSequenceStep(step))
        .filter((step): step is AiSequenceStep => step !== null)
    : [];
  const fileSummaries = Array.isArray(input.fileSummaries)
    ? input.fileSummaries
        .map((summary) => normalizeFileSummary(summary))
        .filter((summary): summary is AiFileSummary => summary !== null)
    : [];

  if (overviewCards.length === 0 && flowComparisons.length === 0 && fileSummaries.length === 0) {
    return null;
  }

  return {
    overviewCards,
    flowComparisons,
    sequenceSteps,
    fileSummaries,
  };
}

function normalizeEntry(value: unknown): AiAnalysisCacheEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Partial<AiAnalysisCacheEntry>;
  const repositoryPath = normalizeText(input.repositoryPath);
  const commitSha = normalizeText(input.commitSha);
  const updatedAtIso = normalizeText(input.updatedAtIso) || new Date(0).toISOString();
  const normalizedData = normalizeCachedData(input);

  if (repositoryPath.length === 0 || commitSha.length === 0 || !normalizedData) {
    return null;
  }

  return {
    key: buildCacheKey(repositoryPath, commitSha),
    repositoryPath,
    commitSha,
    updatedAtIso,
    ...normalizedData,
  };
}

function readEntriesFromStorage(): AiAnalysisCacheEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    const candidates = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { readonly entries?: unknown[] }).entries)
      ? (parsed as { readonly entries: unknown[] }).entries
      : [];

    return candidates
      .map((entry) => normalizeEntry(entry))
      .filter((entry): entry is AiAnalysisCacheEntry => entry !== null)
      .sort((left, right) => right.updatedAtIso.localeCompare(left.updatedAtIso))
      .slice(0, MAX_CACHE_ENTRIES);
  } catch {
    return [];
  }
}

function cloneCachedData(data: CachedAiAnalysisData): CachedAiAnalysisData {
  return {
    overviewCards: data.overviewCards.map((card) => ({ ...card })),
    flowComparisons: data.flowComparisons.map((pair) => ({
      beforeTitle: pair.beforeTitle,
      beforeBody: pair.beforeBody,
      afterTitle: pair.afterTitle,
      afterBody: pair.afterBody,
      filePaths: [...pair.filePaths],
    })),
    sequenceSteps: data.sequenceSteps.map((step) => ({
      ...(step.token ? { token: step.token } : {}),
      ...(step.sourceId ? { sourceId: step.sourceId } : {}),
      sourceLabel: step.sourceLabel,
      ...(step.targetId ? { targetId: step.targetId } : {}),
      targetLabel: step.targetLabel,
      message: step.message,
      filePath: step.filePath,
    })),
    fileSummaries: data.fileSummaries.map((summary) => ({
      filePath: summary.filePath,
      summary: summary.summary,
      riskNote: summary.riskNote,
    })),
  };
}

export function readAiAnalysisFromStorage(input: {
  readonly repositoryPath: string;
  readonly commitSha: string;
}): CachedAiAnalysisData | null {
  const repositoryPath = normalizeText(input.repositoryPath);
  const commitSha = normalizeText(input.commitSha);
  if (repositoryPath.length === 0 || commitSha.length === 0) {
    return null;
  }

  const key = buildCacheKey(repositoryPath, commitSha);
  const entry = readEntriesFromStorage().find((item) => item.key === key);
  if (!entry) {
    return null;
  }

  return cloneCachedData(entry);
}

export function writeAiAnalysisToStorage(input: {
  readonly repositoryPath: string;
  readonly commitSha: string;
  readonly analysis: CachedAiAnalysisData;
}): void {
  const repositoryPath = normalizeText(input.repositoryPath);
  const commitSha = normalizeText(input.commitSha);
  if (repositoryPath.length === 0 || commitSha.length === 0) {
    return;
  }

  const normalizedData = normalizeCachedData(input.analysis);
  if (!normalizedData) {
    return;
  }

  const nextEntry: AiAnalysisCacheEntry = {
    key: buildCacheKey(repositoryPath, commitSha),
    repositoryPath,
    commitSha,
    updatedAtIso: new Date().toISOString(),
    ...normalizedData,
  };

  const nextEntries = [
    nextEntry,
    ...readEntriesFromStorage().filter((entry) => entry.key !== nextEntry.key),
  ]
    .sort((left, right) => right.updatedAtIso.localeCompare(left.updatedAtIso))
    .slice(0, MAX_CACHE_ENTRIES);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextEntries));
  } catch {
    // Ignore write failures (private mode/storage quota).
  }
}
