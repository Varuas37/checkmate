import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "../../shared/index.ts";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-md border border-border bg-canvas px-3 text-sm text-text shadow-inset transition-colors",
        "placeholder:text-text-subtle hover:border-border-strong",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-0",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
});
