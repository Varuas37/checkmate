import { Badge, Card, CardBody, CardDescription, CardHeader, CardTitle } from "../../../design-system/index.ts";

import type { StandardsCheck } from "../types.ts";

export interface StandardsPanelProps {
  readonly checks: readonly StandardsCheck[];
  readonly counts: {
    readonly pass: number;
    readonly warn: number;
    readonly fail: number;
  };
}

function toneForResult(status: "pass" | "warn" | "fail"): "positive" | "caution" | "danger" {
  if (status === "pass") {
    return "positive";
  }

  if (status === "warn") {
    return "caution";
  }

  return "danger";
}

export function StandardsPanel({ checks, counts }: StandardsPanelProps) {
  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-3">
      <Card>
        <CardHeader className="border-b-0 pb-0">
          <CardTitle>Standards Outcome</CardTitle>
          <CardDescription>Pass/warn/fail summary from parsed standards rules.</CardDescription>
        </CardHeader>
        <CardBody className="flex flex-wrap gap-2 pt-2">
          <Badge tone="positive">pass {counts.pass}</Badge>
          <Badge tone="caution">warn {counts.warn}</Badge>
          <Badge tone="danger">fail {counts.fail}</Badge>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="border-b-0 pb-0">
          <CardTitle>Rule Review</CardTitle>
          <CardDescription>Result summary and evidence references for each rule.</CardDescription>
        </CardHeader>
        <CardBody className="space-y-0">
          {checks.map((check) => {
            const result = check.result;

            return (
              <div key={check.rule.id} className="border-b border-border py-3 last:border-b-0">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-display text-sm font-semibold">{check.rule.title}</h4>
                  {result ? <Badge tone={toneForResult(result.status)}>{result.status}</Badge> : <Badge tone="neutral">pending</Badge>}
                </div>
                <p className="text-sm text-muted">{check.rule.description}</p>

                {result && <p className="mt-2 text-sm text-text">{result.summary}</p>}

                {result && result.evidence.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-muted">
                    {result.evidence.map((item, index) => (
                      <li key={`${check.rule.id}-${index}`}>
                        {item.filePath ? `${item.filePath}: ` : ""}
                        {item.note}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          {checks.length === 0 && (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
              No standards checks available yet.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
