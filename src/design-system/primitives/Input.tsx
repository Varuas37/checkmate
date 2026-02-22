import type { InputHTMLAttributes } from "react";

import { cn } from "../../shared/index.ts";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text",
        "placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-0",
        className,
      )}
      {...props}
    />
  );
}
