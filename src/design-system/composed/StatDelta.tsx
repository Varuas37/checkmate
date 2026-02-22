import { Badge } from "../primitives/index.ts";

export interface StatDeltaProps {
  readonly additions: number;
  readonly deletions: number;
}

export function StatDelta({ additions, deletions }: StatDeltaProps) {
  return (
    <div className="flex items-center gap-2">
      <Badge tone="positive">+{additions}</Badge>
      <Badge tone="danger">-{deletions}</Badge>
    </div>
  );
}
