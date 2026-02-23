import type {
  AiFileSummary,
  AiFlowComparison,
  AiOverviewCard,
  AiSequenceStep,
  StandardsResult,
  StandardsRule,
} from "../../domain/review/index.ts";

const STORAGE_KEY = "codelens-ai-analysis-cache.v1";
const MAX_CACHE_ENTRIES = 80;

export interface CachedAiAnalysisData {
  readonly overviewCards: readonly AiOverviewCard[];
  readonly flowComparisons: readonly AiFlowComparison[];
  readonly sequenceSteps: readonly AiSequenceStep[];
  readonly fileSummaries: readonly AiFileSummary[];
  readonly standardsRules: readonly StandardsRule[];
  readonly standardsResults: readonly StandardsResult[];
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
  const technicalDetails = normalizeText(pair.technicalDetails);
  const filePaths = Array.isArray(pair.filePaths)
    ? pair.filePaths
        .map((path) => normalizeText(path))
        .filter((path) => path.length > 0)
    : [];
  const hunkHeadersByFile = Array.isArray(pair.hunkHeadersByFile)
    ? pair.hunkHeadersByFile
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }

          const input = entry as Record<string, unknown>;
          const filePath = normalizeText(input.filePath);
          const hunkHeaders = Array.isArray(input.hunkHeaders)
            ? input.hunkHeaders
                .map((header) => normalizeText(header))
                .filter((header) => header.length > 0)
            : [];

          if (filePath.length === 0 || hunkHeaders.length === 0) {
            return null;
          }

          return {
            filePath,
            hunkHeaders,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
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
    ...(technicalDetails.length > 0
      ? {
          technicalDetails,
        }
      : {}),
    ...(hunkHeadersByFile.length > 0
      ? {
          hunkHeadersByFile,
        }
      : {}),
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
  const technicalDetails = normalizeText(summary.technicalDetails);

  if (filePath.length === 0 || text.length === 0 || riskNote.length === 0) {
    return null;
  }

  return {
    filePath,
    summary: text,
    riskNote,
    ...(technicalDetails.length > 0
      ? {
          technicalDetails,
        }
      : {}),
  };
}

function normalizeStandardsRule(value: unknown): StandardsRule | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rule = value as Partial<StandardsRule>;
  const id = normalizeText(rule.id);
  const title = normalizeText(rule.title);
  const description = normalizeText(rule.description);
  const severity = normalizeText(rule.severity);

  if (id.length === 0 || title.length === 0 || description.length === 0) {
    return null;
  }

  if (!["low", "medium", "high"].includes(severity)) {
    return null;
  }

  return {
    id,
    title,
    description,
    severity: severity as StandardsRule["severity"],
  };
}

function normalizeStandardsResult(value: unknown): StandardsResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const result = value as Partial<StandardsResult>;
  const id = normalizeText(result.id);
  const commitId = normalizeText(result.commitId);
  const ruleId = normalizeText(result.ruleId);
  const status = normalizeText(result.status);
  const summary = normalizeText(result.summary);

  if (
    id.length === 0 ||
    commitId.length === 0 ||
    ruleId.length === 0 ||
    summary.length === 0 ||
    !["pass", "warn", "fail"].includes(status)
  ) {
    return null;
  }

  const evidence = Array.isArray(result.evidence)
    ? result.evidence
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }

          const input = entry as Record<string, unknown>;
          const note = normalizeText(input.note);
          if (note.length === 0) {
            return null;
          }

          const fileId = normalizeText(input.fileId);
          const filePath = normalizeText(input.filePath);
          const hunkId = normalizeText(input.hunkId);
          const lineNumber =
            typeof input.lineNumber === "number" &&
            Number.isFinite(input.lineNumber) &&
            input.lineNumber > 0
              ? Math.floor(input.lineNumber)
              : undefined;

          return {
            ...(fileId.length > 0 ? { fileId } : {}),
            ...(filePath.length > 0 ? { filePath } : {}),
            ...(hunkId.length > 0 ? { hunkId } : {}),
            ...(lineNumber !== undefined ? { lineNumber } : {}),
            note,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : [];

  return {
    id,
    commitId,
    ruleId,
    status: status as StandardsResult["status"],
    summary,
    evidence,
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
  const standardsRules = Array.isArray(input.standardsRules)
    ? input.standardsRules
        .map((rule) => normalizeStandardsRule(rule))
        .filter((rule): rule is StandardsRule => rule !== null)
    : [];
  const standardsResults = Array.isArray(input.standardsResults)
    ? input.standardsResults
        .map((result) => normalizeStandardsResult(result))
        .filter((result): result is StandardsResult => result !== null)
    : [];

  if (
    overviewCards.length === 0 &&
    flowComparisons.length === 0 &&
    fileSummaries.length === 0 &&
    standardsRules.length === 0 &&
    standardsResults.length === 0
  ) {
    return null;
  }

  return {
    overviewCards,
    flowComparisons,
    sequenceSteps,
    fileSummaries,
    standardsRules,
    standardsResults,
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
      ...(pair.technicalDetails
        ? {
            technicalDetails: pair.technicalDetails,
          }
        : {}),
      ...(pair.hunkHeadersByFile && pair.hunkHeadersByFile.length > 0
        ? {
            hunkHeadersByFile: pair.hunkHeadersByFile.map((entry) => ({
              filePath: entry.filePath,
              hunkHeaders: [...entry.hunkHeaders],
            })),
          }
        : {}),
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
      ...(summary.technicalDetails
        ? {
            technicalDetails: summary.technicalDetails,
          }
        : {}),
    })),
    standardsRules: data.standardsRules.map((rule) => ({
      id: rule.id,
      title: rule.title,
      description: rule.description,
      severity: rule.severity,
    })),
    standardsResults: data.standardsResults.map((result) => ({
      id: result.id,
      commitId: result.commitId,
      ruleId: result.ruleId,
      status: result.status,
      summary: result.summary,
      evidence: result.evidence.map((item) => ({
        ...(item.fileId ? { fileId: item.fileId } : {}),
        ...(item.filePath ? { filePath: item.filePath } : {}),
        ...(item.hunkId ? { hunkId: item.hunkId } : {}),
        ...(item.lineNumber ? { lineNumber: item.lineNumber } : {}),
        note: item.note,
      })),
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
