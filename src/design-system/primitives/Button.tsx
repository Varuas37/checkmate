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
    "bg-accent text-accent-contrast hover:bg-accent/90 focus-visible:outline-accent disabled:bg-accent/40",
  secondary:
    "bg-surface text-text border border-border hover:bg-elevated focus-visible:outline-accent disabled:text-muted",
  ghost:
    "bg-transparent text-text hover:bg-elevated focus-visible:outline-accent disabled:text-muted",
  danger:
    "bg-danger text-accent-contrast hover:bg-danger/90 focus-visible:outline-danger disabled:bg-danger/50",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
};

export function Button({ className, variant = "primary", size = "md", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-150",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
