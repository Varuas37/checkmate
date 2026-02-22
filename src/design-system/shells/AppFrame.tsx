import type { ReactNode } from "react";

import { cn } from "../../shared/index.ts";
import { ThemeSwitcher } from "../composed/index.ts";

export interface AppFrameProps {
  readonly header: ReactNode;
  readonly sidebar: ReactNode;
  readonly children: ReactNode;
  readonly title?: string;
  readonly className?: string;
}

export function AppFrame({ header, sidebar, children, title = "AI Code Review", className }: AppFrameProps) {
  return (
    <div className={cn("min-h-screen bg-canvas text-text", className)}>
      <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-4 px-4 py-4 lg:px-6 lg:py-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 shadow-soft">
          <div className="flex items-center gap-3">
            <span className="rounded-sm border border-accent/35 bg-accent/15 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
              CodeLens
            </span>
            <p className="text-xs text-muted">{title}</p>
          </div>
          <ThemeSwitcher />
        </div>
        {header}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <main className="min-w-0">{children}</main>
          <aside className="min-w-0 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">{sidebar}</aside>
        </div>
      </div>
    </div>
  );
}
