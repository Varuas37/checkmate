import { TabButton } from "../../../design-system/index.ts";

import type { ReviewTabId, ReviewTabOption } from "../types.ts";

export interface TopTabsProps {
  readonly tabs: readonly ReviewTabOption[];
  readonly activeTab: ReviewTabId;
  readonly onChange: (tabId: ReviewTabId) => void;
}

export function TopTabs({ tabs, activeTab, onChange }: TopTabsProps) {
  return (
    <nav className="flex w-full gap-1 overflow-x-auto border-b border-border bg-canvas px-3">
      {tabs.map((tab) => (
        <TabButton key={tab.id} label={tab.label} active={tab.id === activeTab} onClick={() => onChange(tab.id)} />
      ))}
    </nav>
  );
}
