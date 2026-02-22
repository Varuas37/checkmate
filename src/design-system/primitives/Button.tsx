import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../shared/index.ts";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-accent bg-accent text-accent-contrast shadow-soft hover:border-accent-emphasis hover:bg-accent-emphasis disabled:border-accent/35 disabled:bg-accent/35",
  secondary:
    "border border-border bg-surface text-text hover:border-border-strong hover:bg-elevated disabled:border-border-muted disabled:text-muted",
  ghost:
    "border border-transparent bg-transparent text-muted hover:border-border hover:bg-surface-subtle hover:text-text disabled:text-text-subtle",
  danger:
    "border border-danger bg-danger text-accent-contrast hover:border-danger-emphasis hover:bg-danger-emphasis disabled:border-danger/35 disabled:bg-danger/35",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 font-mono text-[11px] uppercase tracking-[0.08em]",
  md: "h-10 px-4 text-sm",
};

export function Button({ className, variant = "primary", size = "md", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        "disabled:cursor-not-allowed disabled:opacity-60",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
