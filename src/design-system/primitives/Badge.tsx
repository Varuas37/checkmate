import type { HTMLAttributes } from "react";

import { cn } from "../../shared/index.ts";

type BadgeTone = "neutral" | "accent" | "positive" | "caution" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: "border-border bg-surface-subtle text-muted",
  accent: "border-accent/30 bg-accent/12 text-accent",
  positive: "border-positive/35 bg-positive/12 text-positive",
  caution: "border-caution/35 bg-caution/12 text-caution",
  danger: "border-danger/35 bg-danger/12 text-danger",
};

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em]",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
