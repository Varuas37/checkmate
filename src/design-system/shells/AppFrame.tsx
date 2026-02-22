import type { ReactNode } from "react";

import { cn } from "../../shared/index.ts";

export interface AppFrameProps {
  readonly header: ReactNode;
  readonly sidebar: ReactNode;
  readonly children: ReactNode;
  readonly sidebarPosition?: "left" | "right";
  readonly sidebarCollapsed?: boolean;
  readonly className?: string;
}

export function AppFrame({
  header,
  sidebar,
  children,
  sidebarPosition = "right",
  sidebarCollapsed = false,
  className,
}: AppFrameProps) {
  const sidebarOnLeft = sidebarPosition === "left";
  const showSidebar = !sidebarCollapsed;

  return (
    <div className={cn("h-screen overflow-hidden bg-canvas text-text", className)}>
      <div className="flex h-full w-full flex-col">
        {header}
        <div
          className={cn(
            "grid min-h-0 flex-1 overflow-hidden bg-surface",
            !showSidebar
              ? "grid-cols-1"
              : sidebarOnLeft
              ? "md:grid-cols-[20rem_minmax(0,1fr)] 2xl:grid-cols-[21.5rem_minmax(0,1fr)]"
              : "md:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_21.5rem]",
          )}
        >
          <aside
            className={cn(
              "min-h-0 min-w-0 overflow-hidden border-t border-border bg-surface-subtle md:border-t-0",
              !showSidebar && "hidden",
              sidebarOnLeft ? "order-1 md:border-r" : "order-2 md:border-l",
            )}
          >
            {sidebar}
          </aside>
          <main className={cn("min-h-0 min-w-0 overflow-hidden", sidebarOnLeft ? "order-2" : "order-1")}>{children}</main>
        </div>
      </div>
    </div>
  );
}
