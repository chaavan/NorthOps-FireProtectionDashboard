'use client';

import {
  inventoryTabActiveClass,
  inventoryTabInactiveClass,
} from '@/components/InventoryPageShell';
import type { ReviewTabId } from '@/lib/vendorPriceImport/reviewAnalytics';

type TabDef = {
  id: ReviewTabId;
  label: string;
  badge?: number;
};

type PriceImportTabBarProps = {
  activeTab: ReviewTabId;
  onTabChange: (tab: ReviewTabId) => void;
  unresolvedConflicts: number;
  matchedCount: number;
  noChangeCount: number;
};

export default function PriceImportTabBar({
  activeTab,
  onTabChange,
  unresolvedConflicts,
  matchedCount,
  noChangeCount,
}: PriceImportTabBarProps) {
  const tabs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'review', label: 'Per-part review', badge: matchedCount },
    { id: 'no-change', label: 'No change', badge: noChangeCount },
    {
      id: 'conflicts',
      label: 'Conflicts',
      badge: unresolvedConflicts > 0 ? unresolvedConflicts : undefined,
    },
  ];

  return (
    <div className="flex flex-wrap gap-2 flex-shrink-0 pb-4 border-b border-slate-200 dark:border-slate-700/50">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onTabChange(tab.id)}
          className={activeTab === tab.id ? inventoryTabActiveClass : inventoryTabInactiveClass}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 && (
            <span
              className={`ml-2 inline-flex min-w-[1.25rem] justify-center rounded-full px-1.5 py-0.5 text-xs font-bold ${
                activeTab === tab.id
                  ? 'bg-white/25 text-white'
                  : tab.id === 'conflicts'
                    ? 'bg-amber-500/20 text-amber-700 dark:text-amber-200'
                    : 'bg-slate-300/50 dark:bg-slate-600/50 text-slate-700 dark:text-slate-200'
              }`}
            >
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
