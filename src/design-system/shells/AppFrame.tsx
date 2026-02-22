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
      <div className="mx-auto flex min-h-screen w-full max-w-[1880px] flex-col px-2 pb-2 pt-2 lg:px-4 lg:pb-4">
        {header}
        <div className="grid min-h-0 flex-1 overflow-hidden rounded-b-lg border border-border bg-surface shadow-soft lg:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_21.5rem]">
          <main className="min-h-0 min-w-0 overflow-hidden">{children}</main>
          <aside className="min-h-0 min-w-0 border-t border-border bg-surface-subtle lg:border-l lg:border-t-0">
            {sidebar}
          </aside>
        </div>
      </div>
    </div>
  );
}
