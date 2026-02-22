import type { ReactNode } from "react";

export interface AppFrameProps {
  readonly header: ReactNode;
  readonly sidebar: ReactNode;
  readonly children: ReactNode;
}

export function AppFrame({ header, sidebar, children }: AppFrameProps) {
  return (
    <div className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-4 px-4 py-4 lg:px-6">
        {header}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <main className="min-w-0">{children}</main>
          <aside className="min-w-0">{sidebar}</aside>
        </div>
      </div>
    </div>
  );
}
