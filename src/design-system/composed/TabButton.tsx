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
        "relative -mb-px border-b-2 px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors",
        active
          ? "border-accent text-text"
          : "border-transparent text-muted hover:border-border-strong hover:text-text",
        className,
      )}
      {...props}
    >
      {label}
    </button>
  );
}
