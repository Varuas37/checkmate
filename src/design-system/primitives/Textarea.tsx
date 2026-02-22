import type { TextareaHTMLAttributes } from "react";

import { cn } from "../../shared/index.ts";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text",
        "placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-0",
        className,
      )}
      {...props}
    />
  );
}
