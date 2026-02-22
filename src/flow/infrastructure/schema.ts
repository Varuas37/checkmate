import { z } from "zod";

import type { FlowDocument, FlowValidationIssueCode } from "../domain";
import { validateFlowDocumentInvariants } from "../domain";

const nonEmptyString = z.string().trim().min(1);

const codeReferenceSchema = z
  .object({
    path: nonEmptyString,
    line: z.number().int().positive(),
  })
  .strict();

const diagramNodeSchema = z
  .object({
    id: nonEmptyString,
    label: nonEmptyString,
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

const diagramEdgeSchema = z
  .object({
    id: nonEmptyString,
    from: nonEmptyString,
    to: nonEmptyString,
    label: nonEmptyString.optional(),
  })
  .strict();

const traceStepSchema = z
  .object({
    id: nonEmptyString,
    title: nonEmptyString,
    description: nonEmptyString.optional(),
    focusNodeIds: z.array(nonEmptyString),
    focusEdgeIds: z.array(nonEmptyString),
    codeRef: codeReferenceSchema,
  })
  .strict();

export const flowDocumentSchema = z
  .object({
    version: nonEmptyString,
    diagram: z
      .object({
        nodes: z.array(diagramNodeSchema),
        edges: z.array(diagramEdgeSchema),
      })
      .strict(),
    trace: z.array(traceStepSchema),
  })
  .strict();

export type FlowParseIssueCode = "invalid-json" | "schema-validation" | FlowValidationIssueCode;

export interface FlowParseIssue {
  readonly code: FlowParseIssueCode;
  readonly path: string;
  readonly message: string;
}

export type FlowParseResult =
  | { readonly success: true; readonly data: FlowDocument }
  | { readonly success: false; readonly issues: readonly FlowParseIssue[] };

export class FlowParseError extends Error {
  readonly issues: readonly FlowParseIssue[];

  constructor(message: string, issues: readonly FlowParseIssue[]) {
    super(message);
    this.name = "FlowParseError";
    this.issues = issues;
  }
}

function toPath(path: readonly (string | number)[]): string {
  if (path.length === 0) {
    return "$";
  }

  return path.reduce<string>((result, part) => {
    if (typeof part === "number") {
      return `${result}[${part}]`;
    }

    return `${result}.${part}`;
  }, "$");
}

export function safeParseFlowDocument(raw: unknown): FlowParseResult {
  const schemaResult = flowDocumentSchema.safeParse(raw);

  if (!schemaResult.success) {
    return {
      success: false,
      issues: schemaResult.error.issues.map((issue) => ({
        code: "schema-validation",
        path: toPath(issue.path),
        message: issue.message,
      })),
    };
  }

  const domainIssues = validateFlowDocumentInvariants(schemaResult.data);

  if (domainIssues.length > 0) {
    return {
      success: false,
      issues: domainIssues,
    };
  }

  return {
    success: true,
    data: schemaResult.data,
  };
}

export function parseFlowDocument(raw: unknown): FlowDocument {
  const result = safeParseFlowDocument(raw);

  if (result.success) {
    return result.data;
  }

  throw new FlowParseError("Unable to parse flow document.", result.issues);
}

export function parseFlowDocumentJson(rawJson: string): FlowDocument {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch {
    throw new FlowParseError("Unable to parse flow document JSON.", [
      {
        code: "invalid-json",
        path: "$",
        message: "Input is not valid JSON.",
      },
    ]);
  }

  return parseFlowDocument(parsed);
}
