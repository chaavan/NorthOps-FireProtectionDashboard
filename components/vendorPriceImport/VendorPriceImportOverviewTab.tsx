'use client';

import {
  computeFinancialImpact,
  computePercentBuckets,
  computeReadiness,
  formatUsd,
  isVendorPriceImportApplied,
  vendorPriceImportStatusLabel,
} from '@/lib/vendorPriceImport/reviewAnalytics';
import { formatPercentChange } from '@/lib/vendorPriceImport/percentChange';
import type { VendorPriceReviewSnapshot } from '@/lib/vendorPriceImport/vendorPriceImportTypes';

type VendorPriceImportOverviewTabProps = {
  review: VendorPriceReviewSnapshot;
  importStatus: string;
  appliedCount?: number | null;
  onGoToConflicts: () => void;
  onGoToNoChange?: () => void;
};

export default function VendorPriceImportOverviewTab({
  review,
  importStatus,
  appliedCount = null,
  onGoToConflicts,
  onGoToNoChange,
}: VendorPriceImportOverviewTabProps) {
  const { summary } = review;
  const matchedLines = review.lines.filter((l) => l.matchStatus === 'MATCHED');
  const readiness = computeReadiness(review, importStatus);
  const isApplied = readiness.isApplied;
  const finance = computeFinancialImpact(review.lines);
  const buckets = computePercentBuckets(matchedLines);
  const bucketTotal = buckets.reduce((s, b) => s + b.count, 0) || 1;
  const statusLabel = vendorPriceImportStatusLabel(importStatus);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-6">
      {isApplied ? (
        <div className="rounded-2xl border border-emerald-300/60 bg-emerald-50 px-5 py-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
              Applied
            </span>
            <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
              {appliedCount ?? summary.selectedCount} catalog price
              {(appliedCount ?? summary.selectedCount) === 1 ? '' : 's'} updated in inventory.
            </p>
          </div>
          <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-200">
            This import is read-only. Prices in inventory have been updated; you can review the snapshot
            below but cannot edit or re-apply.
          </p>
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 dark:border-slate-600/80 bg-gradient-to-br from-slate-50 to-white dark:from-slate-800/90 dark:to-slate-800/50 p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-8">
          <ReadinessRing
            percent={readiness.progressPercent}
            ready={readiness.canCommit}
            applied={isApplied}
          />
          <div className="flex-1 min-w-[12rem]">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {isApplied ? 'Import status' : 'Import readiness'}
            </p>
            <h2 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{readiness.statusLabel}</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {isApplied
                ? `${appliedCount ?? summary.selectedCount} part${(appliedCount ?? summary.selectedCount) === 1 ? '' : 's'} were applied from this sheet`
                : readiness.hasSelections
                  ? `${summary.selectedCount} part${summary.selectedCount === 1 ? '' : 's'} selected for price update`
                  : 'No parts selected yet — review matched rows and check selections.'}
            </p>
            {!isApplied && readiness.unresolvedConflicts > 0 && (
              <button
                type="button"
                onClick={onGoToConflicts}
                className="mt-4 text-sm font-semibold text-amber-700 dark:text-amber-300 hover:underline"
              >
                Go to Conflicts tab →
              </button>
            )}
          </div>
        </div>
      </section>

      {review.blockingIssues.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-500/30 dark:bg-red-500/10">
          <p className="text-sm font-semibold text-red-800 dark:text-red-200">Commit blockers</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-red-700 dark:text-red-300">
            {review.blockingIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-8 gap-3">
        {[
          { label: 'File rows', value: summary.fileRowCount },
          { label: 'Matched', value: summary.matchedCount },
          { label: 'No change', value: summary.noCostChangeCount },
          { label: 'Selected', value: summary.selectedCount, highlight: true },
          { label: 'Adjusted', value: summary.manuallyAdjustedCount ?? 0 },
          { label: 'Increases', value: summary.increasesCount },
          { label: 'Decreases', value: summary.decreasesCount },
          {
            label: 'Avg % (selected)',
            value:
              summary.avgPercentChangeSelected !== null
                ? formatPercentChange(summary.avgPercentChangeSelected)
                : '—',
          },
        ].map((card) => (
          <div
            key={card.label}
            className={`rounded-xl border px-3 py-4 text-center ${
              card.highlight
                ? 'border-blue-300 bg-blue-50 dark:border-blue-500/40 dark:bg-blue-500/10'
                : 'border-slate-200 dark:border-slate-600/80 bg-slate-50 dark:bg-slate-800/80'
            }`}
          >
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{card.value}</p>
            <p className="text-xs text-slate-500 mt-1">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-600/80 bg-slate-50 dark:bg-slate-800/80 p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Financial impact (selected)
          </h3>
          <p className="mt-3 text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
            {formatUsd(finance.netDelta)}
            <span className="text-base font-medium text-slate-500 ml-2">net catalog change</span>
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-500">Total before</dt>
              <dd className="font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatUsd(finance.totalBefore)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Total after</dt>
              <dd className="font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatUsd(finance.totalAfter)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Increases</dt>
              <dd className="font-semibold tabular-nums text-red-600 dark:text-red-400">
                +{formatUsd(finance.increaseDollars)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Decreases</dt>
              <dd className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                −{formatUsd(finance.decreaseDollars)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-600/80 bg-slate-50 dark:bg-slate-800/80 p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            % change distribution (matched)
          </h3>
          <div className="mt-4 space-y-3">
            {buckets.map((bucket) => (
              <div key={bucket.id}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 dark:text-slate-300">{bucket.label}</span>
                  <span className="font-semibold text-slate-900 dark:text-white">{bucket.count}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${bucket.colorClass}`}
                    style={{ width: `${(bucket.count / bucketTotal) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-600/80 bg-slate-50 dark:bg-slate-800/80 p-5">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          File & import
        </h3>
        <dl className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div className="flex justify-between gap-4 border-b border-slate-200/80 dark:border-slate-700/50 py-2">
            <dt className="text-slate-500">Source file</dt>
            <dd className="font-medium text-slate-900 dark:text-white truncate">{review.sourceFileName}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-slate-200/80 dark:border-slate-700/50 py-2">
            <dt className="text-slate-500">Vendor</dt>
            <dd className="font-medium text-slate-900 dark:text-white">{review.vendorDisplayName}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-slate-200/80 dark:border-slate-700/50 py-2">
            <dt className="text-slate-500">Status</dt>
            <dd className="font-medium text-slate-900 dark:text-white">
              {isVendorPriceImportApplied(importStatus) ? (
                <span className="inline-flex items-center rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
                  {statusLabel}
                </span>
              ) : (
                statusLabel
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-slate-200/80 dark:border-slate-700/50 py-2">
            <dt className="text-slate-500">Parsed rows</dt>
            <dd className="font-medium tabular-nums text-slate-900 dark:text-white">{summary.parsedRows}</dd>
          </div>
          {(summary.collapsedDuplicateCount ?? 0) > 0 && (
            <div className="sm:col-span-2 flex justify-between gap-4 py-2">
              <dt className="text-slate-500">Merged duplicates</dt>
              <dd className="font-medium tabular-nums text-blue-700 dark:text-blue-300">
                {summary.collapsedDuplicateCount} identical rows collapsed
              </dd>
            </div>
          )}
        </dl>
      </div>

      {summary.noCostChangeCount > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-600/80 bg-slate-100/80 dark:bg-slate-800/50 px-4 py-3">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {summary.noCostChangeCount} part{summary.noCostChangeCount === 1 ? '' : 's'} matched with no
            catalog price change
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Vendor file price already equals your catalog cost. Review these on the No change tab if you
            need to correct a price (e.g. pack-size conversion).
          </p>
          {onGoToNoChange ? (
            <button
              type="button"
              onClick={onGoToNoChange}
              className="mt-3 text-sm font-semibold text-blue-700 dark:text-blue-300 hover:underline"
            >
              Go to No change tab →
            </button>
          ) : null}
        </div>
      )}

      {summary.unmatchedCount > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-600/80 bg-slate-100/80 dark:bg-slate-800/50 px-4 py-3">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {summary.unmatchedCount} file row{summary.unmatchedCount === 1 ? '' : 's'} did not match inventory
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            These vendor IDs are not linked to parts in your catalog (ETNA vendor + vendor part ID). They are not
            shown in the review table and will not be updated on apply.
          </p>
        </div>
      )}
    </div>
  );
}

function ReadinessRing({
  percent,
  ready,
  applied = false,
}: {
  percent: number;
  ready: boolean;
  applied?: boolean;
}) {
  const size = 96;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  const ringClass = applied ? 'text-emerald-500' : ready ? 'text-emerald-500' : 'text-blue-500';
  const centerLabel = applied ? 'Applied' : ready ? 'Ready' : 'Steps';

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-slate-200 dark:text-slate-700"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={ringClass}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-slate-900 dark:text-white">{percent}%</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">{centerLabel}</span>
      </div>
    </div>
  );
}
