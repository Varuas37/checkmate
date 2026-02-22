import type {
  DiffHunk,
  StandardsEvaluationInput,
  StandardsEvaluationOutput,
  StandardsEvaluator,
  StandardsResult,
  StandardsRule,
} from "../../domain/review/index.ts";

interface AddedLine {
  readonly fileId: string;
  readonly filePath: string;
  readonly hunkId: string;
  readonly lineNumber: number;
  readonly text: string;
}

function deriveSeverity(description: string): StandardsRule["severity"] {
  if (/(must|required|forbidden|never|do not)/i.test(description)) {
    return "high";
  }

  if (/(should|prefer|avoid)/i.test(description)) {
    return "medium";
  }

  return "low";
}

function deriveTitle(description: string): string {
  const sentence = description.split(/[.;]/, 1)[0]?.trim() ?? "Rule";

  if (sentence.length <= 72) {
    return sentence;
  }

  return `${sentence.slice(0, 69).trimEnd()}...`;
}

export function parseStandardsRulesFromText(ruleText: string): readonly StandardsRule[] {
  const lines = ruleText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const rules: StandardsRule[] = [];

  lines.forEach((line) => {
    const match = line.match(/^(?:[-*]|\d+[.)])\s+(.+)$/u);
    if (!match) {
      return;
    }

    const description = match[1]?.trim();
    if (!description || description.length === 0) {
      return;
    }

    const ruleId = `rule-${rules.length + 1}`;
    rules.push({
      id: ruleId,
      title: deriveTitle(description),
      description,
      severity: deriveSeverity(description),
    });
  });

  return rules;
}

function collectAddedLines(input: StandardsEvaluationInput): readonly AddedLine[] {
  const filesById = new Map(input.files.map((file) => [file.id, file]));
  const addedLines: AddedLine[] = [];

  input.hunks.forEach((hunk: DiffHunk) => {
    const file = filesById.get(hunk.fileId);

    if (!file) {
      return;
    }

    hunk.lines.forEach((line) => {
      if (line.kind !== "add") {
        return;
      }

      addedLines.push({
        fileId: file.id,
        filePath: file.path,
        hunkId: hunk.id,
        lineNumber: line.newLineNumber ?? hunk.newStart,
        text: line.text,
      });
    });
  });

  return addedLines;
}

function evaluateNoAnyRule(
  rule: StandardsRule,
  commitId: string,
  addedLines: readonly AddedLine[],
): StandardsResult {
  const violations = addedLines.filter((line) => /\bany\b/u.test(line.text));

  if (violations.length === 0) {
    return {
      id: `result-${commitId}-${rule.id}`,
      commitId,
      ruleId: rule.id,
      status: "pass",
      summary: `${rule.title}: no violations found.`,
      evidence: [],
    };
  }

  return {
    id: `result-${commitId}-${rule.id}`,
    commitId,
    ruleId: rule.id,
    status: "fail",
    summary: `${rule.title}: detected ${violations.length} 'any' usage(s) in added lines.`,
    evidence: violations.slice(0, 5).map((line) => ({
      fileId: line.fileId,
      filePath: line.filePath,
      hunkId: line.hunkId,
      lineNumber: line.lineNumber,
      note: `Added line includes 'any': ${line.text}`,
    })),
  };
}

function evaluateNoConsoleLogRule(
  rule: StandardsRule,
  commitId: string,
  addedLines: readonly AddedLine[],
): StandardsResult {
  const violations = addedLines.filter((line) => /console\.log\s*\(/u.test(line.text));

  if (violations.length === 0) {
    return {
      id: `result-${commitId}-${rule.id}`,
      commitId,
      ruleId: rule.id,
      status: "pass",
      summary: `${rule.title}: no console.log usage detected.`,
      evidence: [],
    };
  }

  return {
    id: `result-${commitId}-${rule.id}`,
    commitId,
    ruleId: rule.id,
    status: "fail",
    summary: `${rule.title}: detected console.log in ${violations.length} added line(s).`,
    evidence: violations.slice(0, 5).map((line) => ({
      fileId: line.fileId,
      filePath: line.filePath,
      hunkId: line.hunkId,
      lineNumber: line.lineNumber,
      note: "Added line calls console.log.",
    })),
  };
}

function evaluateTestsRule(
  rule: StandardsRule,
  commitId: string,
  filePaths: readonly string[],
): StandardsResult {
  const hasTestFile = filePaths.some((path) => /(?:\.test\.|\.spec\.|__tests__)/u.test(path));

  if (hasTestFile) {
    return {
      id: `result-${commitId}-${rule.id}`,
      commitId,
      ruleId: rule.id,
      status: "pass",
      summary: `${rule.title}: test changes detected.`,
      evidence: [],
    };
  }

  return {
    id: `result-${commitId}-${rule.id}`,
    commitId,
    ruleId: rule.id,
    status: "warn",
    summary: `${rule.title}: no test file changes detected for this commit.`,
    evidence: [
      {
        note: "No changed files matched common test file patterns (.test, .spec, __tests__).",
      },
    ],
  };
}

function evaluateFallbackRule(rule: StandardsRule, commitId: string): StandardsResult {
  return {
    id: `result-${commitId}-${rule.id}`,
    commitId,
    ruleId: rule.id,
    status: "pass",
    summary: `${rule.title}: no automated heuristic configured; marked pass by default.`,
    evidence: [],
  };
}

export function evaluateStandardsFromRuleText(
  input: StandardsEvaluationInput,
): StandardsEvaluationOutput {
  const rules = parseStandardsRulesFromText(input.ruleText);
  const addedLines = collectAddedLines(input);
  const filePaths = input.files.map((file) => file.path);

  const results = rules.map((rule) => {
    const description = rule.description.toLowerCase();

    if (description.includes("no any")) {
      return evaluateNoAnyRule(rule, input.commitId, addedLines);
    }

    if (description.includes("console.log")) {
      return evaluateNoConsoleLogRule(rule, input.commitId, addedLines);
    }

    if (description.includes("test")) {
      return evaluateTestsRule(rule, input.commitId, filePaths);
    }

    return evaluateFallbackRule(rule, input.commitId);
  });

  return {
    rules,
    results,
  };
}

export class RuleTextStandardsEvaluator implements StandardsEvaluator {
  evaluate(input: StandardsEvaluationInput): StandardsEvaluationOutput {
    return evaluateStandardsFromRuleText(input);
  }
}

export function createRuleTextStandardsEvaluator(): StandardsEvaluator {
  return new RuleTextStandardsEvaluator();
}
