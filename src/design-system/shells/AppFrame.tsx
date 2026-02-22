import type { ReactNode } from "react";

import { cn } from "../../shared/index.ts";

export interface AppFrameProps {
  readonly header: ReactNode;
  readonly sidebar: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

export function AppFrame({ header, sidebar, children, className }: AppFrameProps) {
  return (
    <div className={cn("min-h-screen bg-canvas text-text", className)}>
      <div className="mx-auto flex w-full max-w-[1820px] flex-col px-3 pb-3 pt-3 lg:px-5 lg:pb-5">
        {header}
        <div className="grid overflow-hidden rounded-b-lg border border-border bg-surface shadow-soft lg:grid-cols-[minmax(0,1fr)_18.5rem]">
          <main className="min-w-0">{children}</main>
          <aside className="min-w-0 border-t border-border bg-surface-subtle lg:sticky lg:top-3 lg:h-[calc(100vh-1.5rem)] lg:border-l lg:border-t-0">
            {sidebar}
          </aside>
        </div>
      </div>
    </div>
  );
}
