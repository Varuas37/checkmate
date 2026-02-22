import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../shared/index.ts";

export interface TabButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick" | "type"> {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}

export function TabButton({ label, active, onClick, className, ...props }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors",
        active
          ? "border-accent/45 bg-accent/14 text-text"
          : "border-border bg-surface text-muted hover:border-border-strong hover:bg-elevated hover:text-text",
        className,
      )}
      {...props}
    >
      {label}
    </button>
  );
}
