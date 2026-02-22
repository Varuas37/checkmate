import type { HTMLAttributes } from "react";

import { cn } from "../../shared/index.ts";

type BadgeTone = "neutral" | "accent" | "positive" | "caution" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-elevated text-muted",
  accent: "bg-accent/15 text-accent",
  positive: "bg-positive/15 text-positive",
  caution: "bg-caution/15 text-caution",
  danger: "bg-danger/15 text-danger",
};

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 font-mono text-xs font-medium uppercase tracking-wide",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
