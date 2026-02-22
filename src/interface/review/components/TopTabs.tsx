import type { ReactNode } from "react";

import { TabButton } from "../../../design-system/index.ts";

import type { ReviewTabId, ReviewTabOption } from "../types.ts";

export interface TopTabsProps {
  readonly tabs: readonly ReviewTabOption[];
  readonly activeTab: ReviewTabId;
  readonly onChange: (tabId: ReviewTabId) => void;
  readonly trailingAction?: ReactNode;
}

export function TopTabs({ tabs, activeTab, onChange, trailingAction }: TopTabsProps) {
  return (
    <nav className="border-t border-border/70 bg-surface-subtle/60" role="tablist" aria-label="Review sections">
      <div className="flex min-h-10 w-full items-end justify-between gap-2 px-3 sm:px-4">
        <div className="flex min-w-0 items-end gap-0.5 overflow-x-auto">
          {tabs.map((tab) => (
            <TabButton
              key={tab.id}
              label={tab.label}
              active={tab.id === activeTab}
              onClick={() => onChange(tab.id)}
              className="px-3 py-2"
            />
          ))}
        </div>
        {trailingAction ? <div className="shrink-0 pb-1">{trailingAction}</div> : null}
      </div>
    </nav>
  );
}
