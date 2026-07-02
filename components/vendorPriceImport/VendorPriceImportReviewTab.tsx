'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List, type RowComponentProps } from 'react-window';
import WarningConfirmModal from '@/components/WarningConfirmModal';
import {
  inventorySecondaryButtonClass,
  inventoryTabActiveClass,
  inventoryTabInactiveClass,
} from '@/components/InventoryPageShell';
import { downloadReviewLinesCsv } from '@/lib/vendorPriceImport/exportReviewCsv';
import { formatPercentChange } from '@/lib/vendorPriceImport/percentChange';
import type { VendorPriceReviewLine } from '@/lib/vendorPriceImport/vendorPriceImportTypes';

type FilterId = 'increases' | 'decreases' | 'large' | 'all_matched' | 'adjusted';
type SortKey = 'pn' | 'vendorPartId' | 'percentChange';
type SortDir = 'asc' | 'desc';

const ROW_HEIGHT = 64;
const GRID_COLS_WITH_SKIP =
  'grid-cols-[minmax(6rem,1fr)_minmax(5rem,0.75fr)_minmax(8rem,1.2fr)_minmax(8rem,1.2fr)_5.5rem_minmax(7.5rem,1fr)_4.5rem_2.5rem]';
const GRID_COLS_NO_SKIP =
  'grid-cols-[minmax(6rem,1fr)_minmax(5rem,0.75fr)_minmax(8rem,1.2fr)_minmax(8rem,1.2fr)_5.5rem_minmax(7.5rem,1fr)_4.5rem]';

export type VendorPriceImportReviewVariant = 'changes' | 'no-change';

type PendingAction =
  | { kind: 'save'; line: VendorPriceReviewLine; costAfter: number }
  | { kind: 'reset'; line: VendorPriceReviewLine };

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 0 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.69 0 1.25.56 1.25 1.25v.25a3.736 3.736 0 0 0-2.5 0v-.25C8.75 4.56 9.31 4 10 4ZM8.5 8.25a.75.75 0 0 0-1.5 0v6.5a.75.75 0 0 0 1.5 0v-6.5Zm2.25 0a.75.75 0 0 0-1.5 0v6.5a.75.75 0 0 0 1.5 0v-6.5Zm2.25 0a.75.75 0 0 0-1.5 0v6.5a.75.75 0 0 0 1.5 0v-6.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function savedCostForLine(line: VendorPriceReviewLine): number {
  return line.costAfter ?? line.proposedCost;
}

function formatCostInput(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  return value.toFixed(2);
}

function parseCostInput(raw: string): number | 'invalid' {
  const trimmed = raw.trim();
  if (!trimmed) return 'invalid';
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return 'invalid';
  return Math.round(num * 100) / 100;
}

type ReviewRowProps = {
  lines: VendorPriceReviewLine[];
  variant: VendorPriceImportReviewVariant;
  draftCosts: Record<string, string>;
  inputErrors: Record<string, string>;
  onDraftChange: (lineId: string, value: string) => void;
  onCommitDraft: (line: VendorPriceReviewLine) => void;
  onRequestReset: (line: VendorPriceReviewLine) => void;
  onRemoveLine?: (lineId: string) => void;
  disabled: boolean;
  readOnly: boolean;
};

type VendorPriceImportReviewTabProps = {
  lines: VendorPriceReviewLine[];
  variant?: VendorPriceImportReviewVariant;
  sourceFileName: string;
  onRemoveLine?: (lineId: string) => void;
  onSaveCostOverride: (lineId: string, costAfter: number) => Promise<void>;
  onResetCostOverride: (lineId: string) => Promise<void>;
  isSaving: boolean;
  readOnly?: boolean;
};

function lineMatchesSearch(line: VendorPriceReviewLine, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    line.pn,
    line.vendorPartIdNormalized,
    line.nomenclature,
    line.descriptionFromFile,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

function applyFilter(rows: VendorPriceReviewLine[], filter: FilterId): VendorPriceReviewLine[] {
  switch (filter) {
    case 'increases':
      return rows.filter((l) => l.percentChange !== null && l.percentChange > 0);
    case 'decreases':
      return rows.filter((l) => l.percentChange !== null && l.percentChange < 0);
    case 'large':
      return rows.filter((l) => l.percentChange !== null && Math.abs(l.percentChange) >= 10);
    case 'adjusted':
      return rows.filter((l) => l.isManuallyAdjusted);
    default:
      return rows;
  }
}

function sortLines(
  rows: VendorPriceReviewLine[],
  sortKey: SortKey,
  sortDir: SortDir,
): VendorPriceReviewLine[] {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'pn':
        cmp = (a.pn || '').localeCompare(b.pn || '');
        break;
      case 'vendorPartId':
        cmp = a.vendorPartIdNormalized.localeCompare(b.vendorPartIdNormalized);
        break;
      case 'percentChange': {
        const ap = a.percentChange ?? -Infinity;
        const bp = b.percentChange ?? -Infinity;
        cmp = ap - bp;
        break;
      }
    }
    return cmp * dir;
  });
}

function ReviewVirtualRow({
  index,
  style,
  lines,
  variant,
  draftCosts,
  inputErrors,
  onDraftChange,
  onCommitDraft,
  onRequestReset,
  onRemoveLine,
  disabled,
  readOnly,
}: RowComponentProps<ReviewRowProps>) {
  const line = lines[index];
  if (!line) return null;

  const gridCols = variant === 'no-change' ? GRID_COLS_NO_SKIP : GRID_COLS_WITH_SKIP;
  const pct = line.percentChange;
  const pctClass =
    pct === null
      ? 'text-slate-500'
      : pct > 0
        ? 'text-red-600 dark:text-red-400 font-semibold'
        : pct < 0
          ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
          : 'text-slate-600';

  const savedCost = savedCostForLine(line);
  const displayValue =
    draftCosts[line.id] !== undefined ? draftCosts[line.id] : formatCostInput(savedCost);
  const inputError = inputErrors[line.id];

  return (
    <div
      style={style}
      className={`grid ${gridCols} items-center gap-2 px-4 border-b border-slate-200 dark:border-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-700/30 text-sm`}
    >
      <div className="font-semibold text-slate-900 dark:text-white truncate">{line.pn || '—'}</div>
      <div className="text-slate-600 dark:text-slate-300 truncate">{line.vendorPartIdNormalized}</div>
      <div className="text-slate-600 dark:text-slate-300 truncate" title={line.nomenclature || undefined}>
        {line.nomenclature || '—'}
      </div>
      <div className="text-slate-500 dark:text-slate-400 truncate" title={line.descriptionFromFile || undefined}>
        {line.descriptionFromFile || '—'}
      </div>
      <div className="tabular-nums text-slate-600 dark:text-slate-300">
        {line.costBefore !== null ? `$${line.costBefore.toFixed(2)}` : '—'}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1">
          {line.isManuallyAdjusted ? (
            <span className="rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
              Adjusted
            </span>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <span className="text-slate-500 dark:text-slate-400 text-xs">$</span>
            {readOnly ? (
              <span className="tabular-nums text-sm font-semibold text-slate-900 dark:text-white">
                {formatCostInput(savedCost)}
              </span>
            ) : (
              <input
                type="number"
                min={0}
                step={0.01}
                disabled={disabled}
                value={displayValue}
                onChange={(e) => onDraftChange(line.id, e.target.value)}
                onBlur={() => onCommitDraft(line)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className={`w-full min-w-0 rounded border px-1.5 py-1 text-xs tabular-nums font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-800/80 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 ${
                  line.isManuallyAdjusted
                    ? 'border-amber-400 dark:border-amber-500/50'
                    : 'border-slate-300 dark:border-slate-600/80'
                }`}
                aria-label={`New price for ${line.pn || line.vendorPartIdNormalized}`}
              />
            )}
          </div>
        </div>
        {inputError ? (
          <p className="mt-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">{inputError}</p>
        ) : null}
        {!readOnly && line.isManuallyAdjusted ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRequestReset(line)}
            className="mt-0.5 text-[10px] font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 disabled:opacity-50"
          >
            Reset to vendor
          </button>
        ) : null}
      </div>
      <div className={`tabular-nums ${pctClass}`}>
        {variant === 'no-change' ? 'No change' : formatPercentChange(pct)}
      </div>
      {variant === 'changes' && onRemoveLine && !readOnly ? (
        <div className="flex justify-start">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemoveLine(line.id)}
            className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10 disabled:opacity-50"
            title="Skip this price update"
            aria-label="Skip this price update"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function VendorPriceImportReviewTab({
  lines,
  variant = 'changes',
  sourceFileName,
  onRemoveLine,
  onSaveCostOverride,
  onResetCostOverride,
  isSaving,
  readOnly = false,
}: VendorPriceImportReviewTabProps) {
  const isNoChange = variant === 'no-change';
  const gridCols = isNoChange ? GRID_COLS_NO_SKIP : GRID_COLS_WITH_SKIP;
  const [filter, setFilter] = useState<FilterId>('all_matched');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>(isNoChange ? 'pn' : 'percentChange');
  const [sortDir, setSortDir] = useState<SortDir>(isNoChange ? 'asc' : 'desc');
  const [draftCosts, setDraftCosts] = useState<Record<string, string>>({});
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(400);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;
    const update = () => setListHeight(Math.max(200, el.clientHeight));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const filteredLines = useMemo(() => {
    let rows = isNoChange ? lines : applyFilter(lines, filter);
    rows = rows.filter((l) => lineMatchesSearch(l, debouncedSearch));
    return sortLines(rows, sortKey, sortDir);
  }, [lines, filter, debouncedSearch, sortKey, sortDir, isNoChange]);

  const clearDraft = useCallback((lineId: string) => {
    setDraftCosts((prev) => {
      if (!(lineId in prev)) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
    setInputErrors((prev) => {
      if (!(lineId in prev)) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  }, []);

  const handleDraftChange = useCallback((lineId: string, value: string) => {
    setDraftCosts((prev) => ({ ...prev, [lineId]: value }));
    setInputErrors((prev) => {
      if (!(lineId in prev)) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  }, []);

  const handleCommitDraft = useCallback(
    (line: VendorPriceReviewLine) => {
      const raw = draftCosts[line.id] ?? formatCostInput(savedCostForLine(line));
      const parsed = parseCostInput(raw);
      if (parsed === 'invalid') {
        setInputErrors((prev) => ({
          ...prev,
          [line.id]: 'Enter a valid price (0 or greater).',
        }));
        clearDraft(line.id);
        return;
      }

      const saved = savedCostForLine(line);
      if (parsed === saved) {
        clearDraft(line.id);
        return;
      }

      setPendingAction({ kind: 'save', line, costAfter: parsed });
    },
    [clearDraft, draftCosts],
  );

  const handleRequestReset = useCallback((line: VendorPriceReviewLine) => {
    setPendingAction({ kind: 'reset', line });
  }, []);

  const handleConfirmPending = async () => {
    if (!pendingAction) return;
    try {
      if (pendingAction.kind === 'save') {
        await onSaveCostOverride(pendingAction.line.id, pendingAction.costAfter);
      } else {
        await onResetCostOverride(pendingAction.line.id);
      }
      clearDraft(pendingAction.line.id);
      setPendingAction(null);
    } catch {
      setPendingAction(null);
    }
  };

  const handleCancelPending = () => {
    if (pendingAction) {
      clearDraft(pendingAction.line.id);
    }
    setPendingAction(null);
  };

  const rowProps = useMemo<ReviewRowProps>(
    () => ({
      lines: filteredLines,
      variant,
      draftCosts,
      inputErrors,
      onDraftChange: handleDraftChange,
      onCommitDraft: handleCommitDraft,
      onRequestReset: handleRequestReset,
      onRemoveLine: readOnly ? undefined : onRemoveLine,
      disabled: readOnly || isSaving || pendingAction !== null,
      readOnly,
    }),
    [
      filteredLines,
      variant,
      draftCosts,
      inputErrors,
      handleDraftChange,
      handleCommitDraft,
      handleRequestReset,
      onRemoveLine,
      isSaving,
      pendingAction,
      readOnly,
    ],
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'pn' || key === 'vendorPartId' ? 'asc' : 'desc');
    }
  };

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  const handleExport = () => {
    const base = sourceFileName.replace(/\.[^.]+$/, '') || 'price-import';
    const suffix = isNoChange ? '-no-change' : '-review';
    downloadReviewLinesCsv(filteredLines, `${base}${suffix}.csv`);
  };

  const adjustedCount = lines.filter((l) => l.isManuallyAdjusted).length;

  const modalTitle =
    pendingAction?.kind === 'reset' ? 'Revert to vendor price?' : 'Confirm price change';
  const modalMessage =
    pendingAction?.kind === 'reset'
      ? `Reset ${pendingAction.line.pn || pendingAction.line.vendorPartIdNormalized} to the vendor file price?`
      : `You are changing the price for ${pendingAction?.line.pn || pendingAction?.line.vendorPartIdNormalized} (${pendingAction?.line.vendorPartIdNormalized}).`;
  const modalDetail =
    pendingAction?.kind === 'save'
      ? [
          pendingAction.line.costBefore !== null
            ? `Catalog (old): $${pendingAction.line.costBefore.toFixed(2)}`
            : null,
          `Vendor file: $${pendingAction.line.proposedCost.toFixed(2)}`,
          `New (your entry): $${pendingAction.costAfter.toFixed(2)}`,
          'Applied to the catalog when you click Apply.',
        ]
          .filter(Boolean)
          .join(' · ')
      : pendingAction?.kind === 'reset'
        ? `Vendor file price: $${pendingAction.line.proposedCost.toFixed(2)}`
        : undefined;

  const headerLabelClass =
    'text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300';
  const headerBtnClass = `${headerLabelClass} hover:text-blue-600 dark:hover:text-blue-400`;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {readOnly ? (
        <div className="flex-shrink-0 mb-3 rounded-xl border border-emerald-300/60 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
          Prices from this import were applied to inventory. This sheet is read-only.
        </div>
      ) : null}
      <div className="flex-shrink-0 space-y-3 mb-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            placeholder="Search part #, vendor ID, nomenclature, vendor description…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="flex-1 min-w-[12rem] px-4 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-600/80 rounded-xl text-sm text-slate-900 dark:text-white"
          />
          <button type="button" onClick={handleExport} className={inventorySecondaryButtonClass}>
            Export CSV
          </button>
        </div>

        {!isNoChange ? (
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['all_matched', 'All matched'],
                ['adjusted', `Adjusted (${adjustedCount})`],
                ['increases', 'Increases'],
                ['decreases', 'Decreases'],
                ['large', '≥10% change'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={filter === id ? inventoryTabActiveClass : inventoryTabInactiveClass}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        <p className="text-xs text-slate-500">
          {readOnly ? (
            <>Read-only snapshot · {filteredLines.length} part{filteredLines.length === 1 ? '' : 's'}</>
          ) : isNoChange ? (
            <>
              Vendor file price matches catalog for these {lines.length} part
              {lines.length === 1 ? '' : 's'}. Edit a price if the vendor value needs correction
              (e.g. pack price ÷ 5) — it will move to Per-part review when changed.
            </>
          ) : (
            <>
              Showing {filteredLines.length} of {lines.length} matched
              {adjustedCount > 0 ? ` · ${adjustedCount} manually adjusted` : ''}
            </>
          )}
        </p>
      </div>

      <div className="flex-1 min-h-0 flex flex-col border border-slate-200 dark:border-slate-700/50 rounded-xl overflow-hidden">
        <div
          className={`grid ${gridCols} items-center gap-2 px-4 py-3 border-b-2 border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/95 flex-shrink-0`}
        >
          <button
            type="button"
            onClick={() => toggleSort('pn')}
            className={`${headerBtnClass} w-full text-left`}
          >
            Part #{sortIndicator('pn')}
          </button>
          <button
            type="button"
            onClick={() => toggleSort('vendorPartId')}
            className={`${headerBtnClass} w-full text-left`}
          >
            Vendor ID{sortIndicator('vendorPartId')}
          </button>
          <span className={`${headerLabelClass} text-left`}>Nomenclature</span>
          <span className={`${headerLabelClass} text-left`}>Vendor description</span>
          <span className={`${headerLabelClass} text-left`}>Old</span>
          <span className={`${headerLabelClass} text-left`}>New</span>
          <button
            type="button"
            onClick={() => toggleSort('percentChange')}
            className={`${headerBtnClass} w-full text-left`}
          >
            {isNoChange ? 'Status' : `Change${sortIndicator('percentChange')}`}
          </button>
          {!isNoChange && !readOnly ? <span className={`${headerLabelClass} text-left`} aria-hidden="true" /> : null}
        </div>

        <div ref={listContainerRef} className="flex-1 min-h-0">
          {filteredLines.length === 0 ? (
            <p className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
              {isNoChange ? 'No parts with unchanged prices.' : 'No rows for this filter.'}
            </p>
          ) : (
            <List
              rowCount={filteredLines.length}
              rowHeight={ROW_HEIGHT}
              rowComponent={ReviewVirtualRow}
              rowProps={rowProps}
              defaultHeight={listHeight}
              style={{ height: listHeight, width: '100%' }}
            />
          )}
        </div>
      </div>

      <WarningConfirmModal
        isOpen={pendingAction !== null}
        title={modalTitle}
        message={modalMessage}
        detail={modalDetail}
        confirmLabel={pendingAction?.kind === 'reset' ? 'Reset price' : 'Confirm price'}
        cancelLabel="Cancel"
        onConfirm={() => void handleConfirmPending()}
        onCancel={handleCancelPending}
        confirming={isSaving}
      />
    </div>
  );
}
