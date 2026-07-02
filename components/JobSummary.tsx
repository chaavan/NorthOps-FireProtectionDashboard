'use client';

import type { JobLineItem } from '@/lib/types';
import { isJobPreorderEnabled } from '@/lib/featureFlags';
import {
  getRemainingForItem,
  hasFab,
  hasOpenJobPreorder,
  hasShopPull,
  isOrdered,
  isTakenCareOf,
  type LineFilter,
  type PreorderTotalsForItem,
} from '@/lib/jobSummaryUtils';
import { jobPreorderPartKey } from '@/lib/jobPartKey';

interface JobSummaryProps {
  lineItems: JobLineItem[];
  showUnpulledOnly: boolean;
  onToggleFilter: () => void;
  hasUnsavedChanges: boolean;
  variant?: 'sidebar' | 'bar';
  activeFilter?: LineFilter;
  onFilterChange?: (filter: LineFilter) => void;
  showOnlyReceived?: boolean;
  onToggleOnlyReceived?: () => void;
  /** Normalized part key → qty still on order (informational). */
  jobPreorderOpenByPart?: ReadonlyMap<string, number>;
}

export default function JobSummary({
  lineItems,
  showUnpulledOnly,
  onToggleFilter,
  hasUnsavedChanges,
  variant = 'sidebar',
  activeFilter,
  onFilterChange,
  showOnlyReceived,
  onToggleOnlyReceived,
  jobPreorderOpenByPart,
}: JobSummaryProps) {
  const jobPreorderFeaturesEnabled = isJobPreorderEnabled();

  const getPreFor = (item: JobLineItem): PreorderTotalsForItem | undefined => {
    if (!jobPreorderFeaturesEnabled) {
      return { pulled: 0, open: 0 };
    }
    const partKey = jobPreorderPartKey(item.partNumber);
    return {
      pulled: item.quantityPulledFromPreorder ?? item.quantityPreordered ?? 0,
      open: jobPreorderOpenByPart?.get(partKey),
    };
  };

  // Calculate statistics
  const totalLines = lineItems.length;

  // Pulled card: any qty pulled from the shop.
  const pulledCount = lineItems.filter((item) => hasShopPull(item)).length;

  // Ordered card includes vendor-PO orders AND any open job pre-order line.
  const orderedLines = lineItems.filter(
    (item) => isOrdered(item) || hasOpenJobPreorder(getPreFor(item)),
  ).length;

  const fabCount = lineItems.filter((item) => hasFab(item)).length;

  // Progress tracks parts that have been taken care of across every path:
  // FAB, shop pull, vendor order/receipt, or job pre-order.
  const fulfilledLines = lineItems.filter((item) =>
    isTakenCareOf(item, getPreFor(item)),
  ).length;

  // Remaining card: rows with qty not covered by any fulfillment path.
  const remaining = lineItems.filter(
    (item) => getRemainingForItem(item, getPreFor(item)) > 0,
  ).length;

  const completionPercentage =
    totalLines > 0 ? Math.round((fulfilledLines / totalLines) * 100) : 0;

  const isInteractive = !!onFilterChange;

  const handleFilterClick = (filter: LineFilter) => {
    if (!onFilterChange) return;
    onFilterChange(filter);
  };

  const currentFilter: LineFilter = activeFilter ?? 'all';

  const baseCardClasses =
    'rounded-xl p-3 shadow-md transition-all transform ' +
    (isInteractive
      ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-400'
      : 'cursor-default');

  const selectedRing =
    'ring-2 ring-white/80 dark:ring-slate-100/70 scale-[1.02]';

  if (variant === 'bar') {
    return (
      <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-4 backdrop-blur-sm shadow-sm flex flex-col gap-4 flex-shrink-0">
        {/* Row 1: Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <button
            type="button"
            onClick={isInteractive ? () => handleFilterClick('all') : undefined}
            className={`bg-gradient-to-br from-primary-400 to-primary-600 text-white ${baseCardClasses} ${
              isInteractive
                ? currentFilter === 'all'
                  ? `shadow-lg shadow-blue-400/60 ${selectedRing}`
                  : 'hover:shadow-lg hover:scale-105'
                : ''
            }`}
            aria-pressed={isInteractive ? currentFilter === 'all' : undefined}
          >
            <div className="text-[10px] text-white/80 uppercase tracking-wide font-bold">Total Parts</div>
            <div className="text-2xl font-bold">{totalLines}</div>
          </button>
          <button
            type="button"
            onClick={
              isInteractive ? () => handleFilterClick('pulled') : undefined
            }
            className={`bg-gradient-success text-white ${baseCardClasses} ${
              isInteractive
                ? currentFilter === 'pulled'
                  ? 'shadow-lg shadow-emerald-400/60 ' + selectedRing
                  : 'hover:shadow-lg hover:scale-105'
                : ''
            }`}
            aria-pressed={
              isInteractive ? currentFilter === 'pulled' : undefined
            }
          >
            <div className="text-[10px] text-white/80 uppercase tracking-wide font-bold">Pulled</div>
            <div className="text-2xl font-bold">{pulledCount}</div>
          </button>
          <button
            type="button"
            onClick={
              isInteractive ? () => handleFilterClick('ordered') : undefined
            }
            className={`bg-gradient-to-br from-amber-500 to-orange-600 text-white ${baseCardClasses} ${
              isInteractive
                ? currentFilter === 'ordered'
                  ? 'shadow-lg shadow-amber-300/70 ' + selectedRing
                  : 'hover:shadow-lg hover:scale-105'
                : ''
            }`}
            aria-pressed={isInteractive ? currentFilter === 'ordered' : undefined}
          >
            <div className="text-[10px] text-white/80 uppercase tracking-wide font-bold">Ordered</div>
            <div className="text-2xl font-bold">{orderedLines}</div>
          </button>
          <button
            type="button"
            onClick={
              isInteractive ? () => handleFilterClick('remaining') : undefined
            }
            className={`bg-gradient-danger text-white ${baseCardClasses} ${
              isInteractive
                ? currentFilter === 'remaining'
                  ? 'shadow-lg shadow-red-400/60 ' + selectedRing
                  : 'hover:shadow-lg hover:scale-105'
                : ''
            }`}
            aria-pressed={
              isInteractive ? currentFilter === 'remaining' : undefined
            }
          >
            <div className="text-[10px] text-white/80 uppercase tracking-wide font-bold">Remaining</div>
            <div className="text-2xl font-bold">{remaining}</div>
          </button>
          <button
            type="button"
            onClick={isInteractive ? () => handleFilterClick('fab') : undefined}
            className={`bg-gradient-to-br from-violet-500 to-purple-600 text-white ${baseCardClasses} ${
              isInteractive
                ? currentFilter === 'fab'
                  ? 'shadow-lg shadow-purple-400/70 ' + selectedRing
                  : 'hover:shadow-lg hover:scale-105'
                : ''
            }`}
            aria-pressed={isInteractive ? currentFilter === 'fab' : undefined}
          >
            <div className="text-[10px] text-white/80 uppercase tracking-wide font-bold">FAB&apos;d</div>
            <div className="text-2xl font-bold">{fabCount}</div>
          </button>
        </div>
        {/* Row 2: Progress + Unsaved */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[120px]">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-slate-700 dark:text-slate-300 uppercase tracking-wide font-bold">Progress</span>
              <span className="text-xs font-bold text-slate-600 dark:text-slate-400">{completionPercentage}%</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-slate-700/50 rounded-full h-4 overflow-hidden shadow-inner">
              <div
                className="bg-green-500 h-full transition-all duration-500"
                style={{ width: `${completionPercentage}%` }}
              />
            </div>
          </div>
          {hasUnsavedChanges && (
            <div className="bg-gradient-to-br from-yellow-400 to-orange-400 text-white rounded-lg px-3 py-2 shadow-md border border-yellow-300/30 animate-pulse-glow flex items-center gap-2 shrink-0">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92z" clipRule="evenodd" />
              </svg>
              <span className="text-xs font-bold">Unsaved changes</span>
            </div>
          )}
          {currentFilter === 'ordered' && onToggleOnlyReceived != null && (
            <label
              htmlFor="show-only-received"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-slate-600/70 bg-gray-50 dark:bg-slate-700/50 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer select-none"
            >
              <input
                id="show-only-received"
                type="checkbox"
                checked={showOnlyReceived === true}
                onChange={onToggleOnlyReceived}
                className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 bg-white dark:bg-slate-800"
              />
              <span>Only received</span>
            </label>
          )}
          <label
            htmlFor="show-unfulfilled-paths"
            className="ml-auto inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-slate-600/70 bg-gray-50 dark:bg-slate-700/50 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer select-none"
          >
            <input
              id="show-unfulfilled-paths"
              type="checkbox"
              checked={showUnpulledOnly}
              onChange={onToggleFilter}
              className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 bg-white dark:bg-slate-800"
            />
            <span>Unattended parts</span>
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-2">
      {/* Summary Cards */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={isInteractive ? () => handleFilterClick('all') : undefined}
          className={`bg-gradient-to-br from-primary-400 to-primary-600 text-white rounded-xl py-3 px-4 shadow-lg transform transition-all w-full text-left ${
            isInteractive
              ? 'cursor-pointer ' +
                (currentFilter === 'all'
                  ? 'shadow-blue-400/60 ring-2 ring-white/80 dark:ring-slate-100/70 scale-[1.02]'
                  : 'hover:scale-105 hover:shadow-blue-400/60')
              : 'cursor-default'
          }`}
          aria-pressed={isInteractive ? currentFilter === 'all' : undefined}
        >
          <div className="text-[11px] text-white/80 uppercase tracking-wide mb-1 font-bold">
            Total Parts
          </div>
          <div className="text-2xl md:text-3xl font-bold leading-tight">
            {totalLines}
          </div>
        </button>

        <button
          type="button"
          onClick={
            isInteractive ? () => handleFilterClick('pulled') : undefined
          }
          className={`bg-gradient-success text-white rounded-xl py-3 px-4 shadow-lg transform transition-all w-full text-left ${
            isInteractive
              ? 'cursor-pointer ' +
                (currentFilter === 'pulled'
                  ? 'shadow-emerald-400/60 ring-2 ring-white/80 dark:ring-slate-100/70 scale-[1.02]'
                  : 'hover:scale-105 hover:shadow-emerald-400/60')
              : 'cursor-default'
          }`}
          aria-pressed={
            isInteractive ? currentFilter === 'pulled' : undefined
          }
        >
          <div className="text-[11px] text-white/80 uppercase tracking-wide mb-1 font-bold">
            Pulled
          </div>
          <div className="text-2xl md:text-3xl font-bold leading-tight">
            {pulledCount}
          </div>
        </button>

        <button
          type="button"
          onClick={
            isInteractive ? () => handleFilterClick('ordered') : undefined
          }
          className={`bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-xl py-3 px-4 shadow-lg transform transition-all w-full text-left ${
            isInteractive
              ? 'cursor-pointer ' +
                (currentFilter === 'ordered'
                  ? 'shadow-amber-300/70 ring-2 ring-white/80 dark:ring-slate-100/70 scale-[1.02]'
                  : 'hover:scale-105 hover:shadow-amber-300/70')
              : 'cursor-default'
          }`}
          aria-pressed={isInteractive ? currentFilter === 'ordered' : undefined}
        >
          <div className="text-[11px] text-white/80 uppercase tracking-wide mb-1 font-bold">
            Ordered
          </div>
          <div className="text-2xl md:text-3xl font-bold leading-tight">
            {orderedLines}
          </div>
        </button>

        <button
          type="button"
          onClick={
            isInteractive ? () => handleFilterClick('remaining') : undefined
          }
          className={`bg-gradient-danger text-white rounded-xl py-3 px-4 shadow-lg transform transition-all w-full text-left ${
            isInteractive
              ? 'cursor-pointer ' +
                (currentFilter === 'remaining'
                  ? 'shadow-red-400/60 ring-2 ring-white/80 dark:ring-slate-100/70 scale-[1.02]'
                  : 'hover:scale-105 hover:shadow-red-400/60')
              : 'cursor-default'
          }`}
          aria-pressed={
            isInteractive ? currentFilter === 'remaining' : undefined
          }
        >
          <div className="text-[11px] text-white/80 uppercase tracking-wide mb-1 font-bold">
            Remaining
          </div>
          <div className="text-2xl md:text-3xl font-bold leading-tight">
            {remaining}
          </div>
        </button>

        <button
          type="button"
          onClick={isInteractive ? () => handleFilterClick('fab') : undefined}
          className={`bg-gradient-to-br from-violet-500 to-purple-600 text-white rounded-xl py-3 px-4 shadow-lg transform transition-all w-full text-left ${
            isInteractive
              ? 'cursor-pointer ' +
                (currentFilter === 'fab'
                  ? 'shadow-purple-400/70 ring-2 ring-white/80 dark:ring-slate-100/70 scale-[1.02]'
                  : 'hover:scale-105 hover:shadow-purple-400/70')
              : 'cursor-default'
          }`}
          aria-pressed={isInteractive ? currentFilter === 'fab' : undefined}
        >
          <div className="text-[11px] text-white/80 uppercase tracking-wide mb-1 font-bold">
            FAB&apos;d
          </div>
          <div className="text-2xl md:text-3xl font-bold leading-tight">
            {fabCount}
          </div>
        </button>
      </div>

      {/* Progress Bar */}
      <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-4 backdrop-blur-sm">
        <div className="text-[11px] text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2 font-bold">
          Progress
        </div>
        <div className="w-full bg-gray-200 dark:bg-slate-700/50 rounded-full h-5 overflow-hidden shadow-inner">
          <div
            className="bg-green-500 h-full transition-all duration-500 flex items-center justify-center text-[11px] font-bold text-white shadow-lg"
            style={{ width: `${completionPercentage}%` }}
          >
            {completionPercentage > 15 && `${completionPercentage}%`}
          </div>
        </div>
        {completionPercentage <= 15 && (
          <div className="text-sm text-slate-700 dark:text-slate-300 mt-2 text-center font-bold">{completionPercentage}%</div>
        )}
      </div>

      {/* Unsaved Changes Warning */}
      {hasUnsavedChanges && (
        <div className="bg-gradient-to-br from-yellow-400 to-orange-400 text-white rounded-2xl p-4 shadow-lg border-2 border-yellow-300/30 animate-pulse-glow">
          <div className="flex items-start space-x-3">
            <svg
              className="w-6 h-6 text-white flex-shrink-0 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <div className="text-sm font-bold">Unsaved Changes</div>
              <div className="text-xs text-white/90 mt-1 font-medium">
                Don't forget to save your changes
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
