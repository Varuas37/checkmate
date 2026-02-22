import { TabButton } from "../../../design-system/index.ts";

import type { ReviewTabId, ReviewTabOption } from "../types.ts";

export interface TopTabsProps {
  readonly tabs: readonly ReviewTabOption[];
  readonly activeTab: ReviewTabId;
  readonly onChange: (tabId: ReviewTabId) => void;
}

export function TopTabs({ tabs, activeTab, onChange }: TopTabsProps) {
  return (
    <nav className="border-t border-border/70 bg-surface-subtle/60" role="tablist" aria-label="Review sections">
      <div className="flex min-h-10 w-full items-end gap-0.5 overflow-x-auto px-3 sm:px-4">
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
    </nav>
  );
}
