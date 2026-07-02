'use client';

import { useEffect, useMemo, useState } from 'react';
import { suggestPartFromDescription } from '@/lib/vendorPriceImport/descriptionPartNumber';
import type { DescriptionPartSuggestion } from '@/lib/vendorPriceImport/descriptionPartNumber';
import { countUnresolvedConflictGroups } from '@/lib/vendorPriceImport/conflictGroups';
import { partitionConflictGroups } from '@/lib/vendorPriceImport/reviewAnalytics';
import type {
  VendorPriceConflictGroup,
  VendorPriceReviewLine,
  VendorPriceReviewSnapshot,
} from '@/lib/vendorPriceImport/vendorPriceImportTypes';

type VendorPriceImportConflictsTabProps = {
  review: VendorPriceReviewSnapshot;
  ambiguousPartPick: Record<string, string>;
  onAmbiguousPartPick: (groupId: string, partId: string) => void;
  onMergeAmbiguousPicks: (picks: Record<string, string>) => void;
  onResolveConflict: (group: VendorPriceConflictGroup, winningLineId: string) => void;
  isSaving: boolean;
  readOnly?: boolean;
};

export default function VendorPriceImportConflictsTab({
  review,
  ambiguousPartPick,
  onAmbiguousPartPick,
  onMergeAmbiguousPicks,
  onResolveConflict,
  isSaving,
  readOnly = false,
}: VendorPriceImportConflictsTabProps) {
  const [showResolved, setShowResolved] = useState(false);

  const suggestionsByGroup = useMemo(() => {
    const map: Record<string, DescriptionPartSuggestion> = {};
    for (const group of review.conflicts) {
      if (!group.candidateParts || group.candidateParts.length < 2) continue;
      const description = group.rows[0]?.descriptionFromFile;
      const suggestion = suggestPartFromDescription(description, group.candidateParts);
      if (suggestion) map[group.conflictGroupId] = suggestion;
    }
    return map;
  }, [review.conflicts]);

  useEffect(() => {
    const picks: Record<string, string> = {};
    for (const [groupId, suggestion] of Object.entries(suggestionsByGroup)) {
      picks[groupId] = suggestion.partId;
    }
    if (Object.keys(picks).length > 0) {
      onMergeAmbiguousPicks(picks);
    }
  }, [suggestionsByGroup, onMergeAmbiguousPicks]);

  const { unresolved, resolved } = useMemo(
    () => partitionConflictGroups(review.conflicts),
    [review.conflicts],
  );

  if (review.conflicts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 dark:text-slate-400 py-16">
        <p className="text-center max-w-md">
          No conflicts in this import. All vendor part IDs matched cleanly or were merged as identical duplicates.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {readOnly ? (
        <div className="flex-shrink-0 mb-4 rounded-xl border border-emerald-300/60 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
          This import was applied to inventory. Conflict resolution is read-only.
        </div>
      ) : null}
      <div className="flex-shrink-0 mb-4">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Conflict resolution</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
          Resolve duplicate vendor IDs in the file with different prices, or pick the correct inventory part
          when multiple catalog matches exist.
        </p>
        <p className="text-xs text-slate-500 mt-2">
          <span className="font-semibold text-amber-700 dark:text-amber-300">
            {countUnresolvedConflictGroups(review.conflicts)} blocking
          </span>
          {' · '}
          {unresolved.length} awaiting choice · {resolved.length} resolved
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
        {unresolved.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
              All conflicts resolved. Review selections on the Per-part review tab, then apply from the header.
            </p>
          </div>
        ) : (
          unresolved.map((group) => (
            <ConflictGroupCard
              key={group.conflictGroupId}
              group={group}
              suggestion={suggestionsByGroup[group.conflictGroupId]}
              ambiguousPartPick={ambiguousPartPick}
              onAmbiguousPartPick={onAmbiguousPartPick}
              onResolveConflict={onResolveConflict}
              isSaving={isSaving}
              readOnly={readOnly}
            />
          ))
        )}

        {resolved.length > 0 && (
          <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4">
            <button
              type="button"
              onClick={() => setShowResolved((v) => !v)}
              className="text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
            >
              {showResolved ? '▼' : '▶'} Resolved ({resolved.length})
            </button>
            {showResolved && (
              <div className="mt-3 space-y-3 opacity-80">
                {resolved.map((group) => (
                  <ConflictGroupCard
                    key={group.conflictGroupId}
                    group={group}
                    suggestion={suggestionsByGroup[group.conflictGroupId]}
                    ambiguousPartPick={ambiguousPartPick}
                    onAmbiguousPartPick={onAmbiguousPartPick}
                    onResolveConflict={onResolveConflict}
                    isSaving={isSaving}
                    readOnly={readOnly}
                    resolved
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ConflictGroupCard({
  group,
  suggestion,
  ambiguousPartPick,
  onAmbiguousPartPick,
  onResolveConflict,
  isSaving,
  readOnly = false,
  resolved = false,
}: {
  group: VendorPriceConflictGroup;
  suggestion?: DescriptionPartSuggestion;
  ambiguousPartPick: Record<string, string>;
  onAmbiguousPartPick: (groupId: string, partId: string) => void;
  onResolveConflict: (group: VendorPriceConflictGroup, winningLineId: string) => void;
  isSaving: boolean;
  readOnly?: boolean;
  resolved?: boolean;
}) {
  const isAmbiguous = group.rows.some((r) => r.matchStatus === 'MATCHED_AMBIGUOUS');
  const typeLabel = isAmbiguous ? 'Pick inventory part' : 'File conflict';
  const distinctPrices = new Set(group.rows.map((r) => r.proposedCost.toFixed(2)));
  const pricesDiffer = distinctPrices.size > 1;

  return (
    <div
      className={`rounded-xl border p-4 ${
        resolved
          ? 'border-slate-200 bg-slate-50 dark:border-slate-600/60 dark:bg-slate-800/40'
          : 'border-amber-300/60 bg-white dark:border-amber-500/30 dark:bg-slate-800/80'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">
          Vendor ID {group.vendorPartIdNormalized}
        </p>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
          {typeLabel}
        </span>
        {resolved && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">
            Resolved
          </span>
        )}
        {pricesDiffer && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200">
            Prices differ
          </span>
        )}
      </div>

      {group.candidateParts && group.candidateParts.length > 1 && !resolved && (
        <div className="mt-3">
          <label className="text-xs text-slate-500">Inventory part (multiple matches)</label>
          {suggestion && !readOnly && (
            <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
              Suggested from description (# {suggestion.token} → {suggestion.pn}). Confirm with{' '}
              <span className="font-semibold">Use this row</span> below.
            </p>
          )}
          {readOnly ? (
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
              {group.candidateParts.find((p) => p.id === ambiguousPartPick[group.conflictGroupId])?.pn ||
                group.candidateParts[0]?.pn ||
                '—'}
            </p>
          ) : (
            <select
              className="mt-1 w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-600/80 rounded-xl text-sm text-slate-900 dark:text-white"
              value={ambiguousPartPick[group.conflictGroupId] || ''}
              onChange={(e) => onAmbiguousPartPick(group.conflictGroupId, e.target.value)}
            >
              <option value="">Select part…</option>
              {group.candidateParts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.pn} — ${p.cost.toFixed(2)}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="mt-3 hidden sm:grid sm:grid-cols-[1fr_6.5rem_7.5rem] gap-3 px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-700">
        <span>Description (from file)</span>
        <span className="text-right">Unit</span>
        <span className="text-right">Price</span>
      </div>
      <ul className="mt-1 space-y-2">
        {group.rows.map((row, index) => (
          <ConflictOptionRow
            key={row.id}
            row={row}
            optionIndex={index + 1}
            resolved={resolved}
            isSaving={isSaving}
            readOnly={readOnly}
            onSelect={() => onResolveConflict(group, row.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function ConflictOptionRow({
  row,
  optionIndex,
  resolved,
  isSaving,
  readOnly = false,
  onSelect,
}: {
  row: VendorPriceReviewLine;
  optionIndex: number;
  resolved: boolean;
  isSaving: boolean;
  readOnly?: boolean;
  onSelect: () => void;
}) {
  const description = row.descriptionFromFile?.trim() || '—';

  return (
    <li className="rounded-lg border border-slate-200 bg-slate-50/90 dark:border-slate-600/60 dark:bg-slate-900/40 overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-stretch gap-0 sm:gap-3">
        <div className="flex-1 min-w-0 p-3 sm:pr-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Option {optionIndex}
            <span className="normal-case font-normal ml-2">· file row {row.rowIndex + 1}</span>
          </p>
          <p
            className="text-sm leading-relaxed text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words"
            title={description !== '—' ? description : undefined}
          >
            {description}
          </p>
        </div>

        <div className="flex sm:flex-col items-center sm:items-end justify-between gap-3 px-3 pb-3 sm:py-3 sm:pl-0 sm:pr-4 border-t sm:border-t-0 sm:border-l border-slate-200 dark:border-slate-600/60 flex-shrink-0">
          <div className="sm:text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 sm:hidden">
              Unit / Price
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums hidden sm:block">
              {row.uomFromFile || '—'}
            </p>
            <p className="text-xs text-slate-500 sm:hidden">{row.uomFromFile || '—'}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 hidden sm:block">
              Price
            </p>
            <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
              ${row.proposedCost.toFixed(2)}
            </p>
          </div>
          {!resolved && !readOnly && (
            <button
              type="button"
              disabled={isSaving}
              onClick={onSelect}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap sm:mt-2"
            >
              Use this row
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
