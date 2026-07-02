import { countUnresolvedConflictGroups, isConflictGroupResolved } from './conflictGroups';
import type {
  VendorPriceConflictGroup,
  VendorPriceReviewLine,
  VendorPriceReviewSnapshot,
} from './vendorPriceImportTypes';

export type ReviewTabId = 'overview' | 'review' | 'no-change' | 'conflicts';

export type ReadinessResult = {
  canCommit: boolean;
  blockerCount: number;
  unresolvedConflicts: number;
  hasSelections: boolean;
  progressPercent: number;
  statusLabel: string;
  isApplied: boolean;
};

export function isVendorPriceImportApplied(importStatus: string): boolean {
  return importStatus === 'COMMITTED';
}

export function vendorPriceImportStatusLabel(importStatus: string): string {
  if (importStatus === 'COMMITTED') return 'Applied';
  if (importStatus === 'READY') return 'Ready to review';
  if (importStatus === 'PROCESSING') return 'Processing';
  if (importStatus === 'FAILED') return 'Failed';
  if (importStatus === 'DISCARDED') return 'Discarded';
  return importStatus;
}

export type FinancialImpact = {
  totalBefore: number;
  totalAfter: number;
  netDelta: number;
  increaseDollars: number;
  decreaseDollars: number;
  selectedCount: number;
};

export type PercentBucket = {
  id: string;
  label: string;
  count: number;
  colorClass: string;
};

export { isConflictGroupResolved };

export function partitionConflictGroups(groups: VendorPriceConflictGroup[]): {
  unresolved: VendorPriceConflictGroup[];
  resolved: VendorPriceConflictGroup[];
} {
  const unresolved: VendorPriceConflictGroup[] = [];
  const resolved: VendorPriceConflictGroup[] = [];
  for (const group of groups) {
    if (isConflictGroupResolved(group)) {
      resolved.push(group);
    } else {
      unresolved.push(group);
    }
  }
  return { unresolved, resolved };
}

export function computeReadiness(
  review: VendorPriceReviewSnapshot | null,
  importStatus: string,
): ReadinessResult {
  if (!review) {
    return {
      canCommit: false,
      blockerCount: 0,
      unresolvedConflicts: 0,
      hasSelections: false,
      progressPercent: 0,
      statusLabel: 'Loading',
      isApplied: false,
    };
  }

  if (isVendorPriceImportApplied(importStatus)) {
    const appliedCount = review.summary.selectedCount;
    return {
      canCommit: false,
      blockerCount: 0,
      unresolvedConflicts: 0,
      hasSelections: appliedCount > 0,
      progressPercent: 100,
      statusLabel: 'Applied to inventory',
      isApplied: true,
    };
  }

  const unresolvedConflicts = countUnresolvedConflictGroups(review.conflicts);
  const hasSelections = review.summary.selectedCount > 0;
  const blockerCount = review.blockingIssues.length;
  const canCommit =
    importStatus === 'READY' && blockerCount === 0 && hasSelections;

  let stepsDone = 0;
  if (unresolvedConflicts === 0) stepsDone += 1;
  if (hasSelections) stepsDone += 1;
  if (canCommit) stepsDone += 1;
  const progressPercent = Math.round((stepsDone / 3) * 100);

  const statusLabel = canCommit
    ? 'Ready to apply'
    : unresolvedConflicts > 0
      ? `${unresolvedConflicts} conflict${unresolvedConflicts === 1 ? '' : 's'} to resolve`
      : !hasSelections
        ? 'Select parts to update'
        : 'Review in progress';

  return {
    canCommit,
    blockerCount,
    unresolvedConflicts,
    hasSelections,
    progressPercent,
    statusLabel,
    isApplied: false,
  };
}

export function computeFinancialImpact(lines: VendorPriceReviewLine[]): FinancialImpact {
  const selected = lines.filter((l) => l.matchStatus === 'MATCHED' && l.selected);
  let totalBefore = 0;
  let totalAfter = 0;
  let increaseDollars = 0;
  let decreaseDollars = 0;

  for (const line of selected) {
    const before = line.costBefore ?? 0;
    const after = line.costAfter ?? line.proposedCost;
    totalBefore += before;
    totalAfter += after;
    const delta = after - before;
    if (delta > 0) increaseDollars += delta;
    else if (delta < 0) decreaseDollars += Math.abs(delta);
  }

  return {
    totalBefore,
    totalAfter,
    netDelta: totalAfter - totalBefore,
    increaseDollars,
    decreaseDollars,
    selectedCount: selected.length,
  };
}

export function computePercentBuckets(matchedLines: VendorPriceReviewLine[]): PercentBucket[] {
  let noChange = 0;
  let up1to5 = 0;
  let up5to10 = 0;
  let up10plus = 0;
  let decreases = 0;

  for (const line of matchedLines) {
    const pct = line.percentChange;
    if (pct === null || pct === 0) {
      noChange += 1;
    } else if (pct < 0) {
      decreases += 1;
    } else if (pct < 5) {
      up1to5 += 1;
    } else if (pct < 10) {
      up5to10 += 1;
    } else {
      up10plus += 1;
    }
  }

  return [
    { id: 'decrease', label: 'Decrease', count: decreases, colorClass: 'bg-emerald-500' },
    { id: 'flat', label: 'No change', count: noChange, colorClass: 'bg-slate-400' },
    { id: '1-5', label: '1–5%', count: up1to5, colorClass: 'bg-amber-400' },
    { id: '5-10', label: '5–10%', count: up5to10, colorClass: 'bg-orange-500' },
    { id: '10+', label: '≥10%', count: up10plus, colorClass: 'bg-red-500' },
  ];
}

export function formatUsd(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
