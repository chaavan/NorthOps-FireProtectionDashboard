'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import InventoryPageShell, {
  InventoryLoadingSpinner,
  inventoryPrimaryButtonClass,
  inventorySecondaryButtonClass,
} from '@/components/InventoryPageShell';
import AccessDeniedOverlay from '@/components/AccessDeniedOverlay';
import PriceImportTabBar from '@/components/vendorPriceImport/PriceImportTabBar';
import VendorPriceImportConflictsTab from '@/components/vendorPriceImport/VendorPriceImportConflictsTab';
import VendorPriceImportOverviewTab from '@/components/vendorPriceImport/VendorPriceImportOverviewTab';
import VendorPriceImportReviewTab from '@/components/vendorPriceImport/VendorPriceImportReviewTab';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { permissionLoadingFallback } from '@/lib/clientPermissionChecks';
import { countUnresolvedConflictGroups } from '@/lib/vendorPriceImport/conflictGroups';
import {
  isVendorPriceImportApplied,
  vendorPriceImportStatusLabel,
  type ReviewTabId,
} from '@/lib/vendorPriceImport/reviewAnalytics';
import type {
  VendorPriceConflictGroup,
  VendorPriceReviewSnapshot,
} from '@/lib/vendorPriceImport/vendorPriceImportTypes';

const VALID_TABS: ReviewTabId[] = ['overview', 'review', 'no-change', 'conflicts'];

function parseTabParam(value: string | null): ReviewTabId {
  if (value && VALID_TABS.includes(value as ReviewTabId)) {
    return value as ReviewTabId;
  }
  return 'overview';
}

export default function VendorPriceImportReviewPage() {
  return (
    <Suspense
      fallback={
        <InventoryPageShell
          title="Price import review"
          subtitle="Loading…"
          backHref="/parts/price-updates"
          backLabel="Price updates"
          contentScroll
        >
          <InventoryLoadingSpinner label="Loading review…" />
        </InventoryPageShell>
      }
    >
      <VendorPriceImportReviewPageContent />
    </Suspense>
  );
}

function VendorPriceImportReviewPageContent() {
  const params = useParams();
  const importId = String(params?.importId || '');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status: sessionStatus } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const { hasPermission, isLoading: permissionsLoading, isSuperAdmin, isDeveloper } = usePermissions();
  const loadingFallback = permissionLoadingFallback({ role, isSuperAdmin, isDeveloper });
  const canViewImports = permissionsLoading
    ? loadingFallback
    : hasPermission('inventory.vendor_prices.import');
  const canReviewAndImport = permissionsLoading
    ? loadingFallback
    : hasPermission('inventory.vendor_prices.review');
  const canCommitImports = permissionsLoading
    ? loadingFallback
    : hasPermission('inventory.vendor_prices.commit');
  const canDiscardImports = permissionsLoading
    ? loadingFallback
    : hasPermission('inventory.vendor_prices.discard');

  const [review, setReview] = useState<VendorPriceReviewSnapshot | null>(null);
  const [status, setStatus] = useState<string>('PROCESSING');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ReviewTabId>(() => parseTabParam(searchParams?.get('tab') ?? null));
  const [isSaving, setIsSaving] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [appliedCount, setAppliedCount] = useState<number | null>(null);
  const [ambiguousPartPick, setAmbiguousPartPick] = useState<Record<string, string>>({});

  const mergeAmbiguousPicks = useCallback((picks: Record<string, string>) => {
    setAmbiguousPartPick((prev) => {
      const merged = { ...prev };
      let changed = false;
      for (const [groupId, partId] of Object.entries(picks)) {
        if (!merged[groupId]) {
          merged[groupId] = partId;
          changed = true;
        }
      }
      return changed ? merged : prev;
    });
  }, []);

  const setTab = useCallback(
    (tab: ReviewTabId) => {
      setActiveTab(tab);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      router.replace(url.pathname + url.search, { scroll: false });
    },
    [router],
  );

  useEffect(() => {
    setActiveTab(parseTabParam(searchParams?.get('tab') ?? null));
  }, [searchParams]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/vendor-price-imports/${encodeURIComponent(importId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load import.');
    setReview(data.review);
    setStatus(data.import?.status || 'PROCESSING');
    if (data.import?.status === 'FAILED') {
      setError(data.import?.errorMessage || 'Import failed.');
    }
  }, [importId]);

  useEffect(() => {
    if (sessionStatus === 'loading' || permissionsLoading || !canViewImports) {
      if (sessionStatus !== 'loading' && !permissionsLoading) setLoading(false);
      return;
    }
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [sessionStatus, permissionsLoading, canViewImports, load]);

  useEffect(() => {
    if (canReviewAndImport || activeTab === 'overview') return;
    setTab('overview');
  }, [activeTab, canReviewAndImport, setTab]);

  const matchedLines = useMemo(
    () => review?.lines.filter((l) => l.matchStatus === 'MATCHED') || [],
    [review],
  );

  const noChangeLines = useMemo(
    () => review?.lines.filter((l) => l.matchStatus === 'NO_COST_CHANGE') || [],
    [review],
  );

  const conflictsTabCount = useMemo(
    () => (review ? countUnresolvedConflictGroups(review.conflicts) : 0),
    [review],
  );

  const persistReviewUpdate = async (body: {
    lineSelections?: Array<{ lineId: string; selected: boolean }>;
    excludeLineIds?: string[];
    lineCostOverrides?: Array<{ lineId: string; costAfter: number }>;
    resetLineCostIds?: string[];
  }) => {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/vendor-price-imports/${encodeURIComponent(importId)}/review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save.');
      setReview(data.review);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
      throw e;
    } finally {
      setIsSaving(false);
    }
  };

  const saveCostOverride = async (lineId: string, costAfter: number) => {
    const wasNoChange = noChangeLines.some((l) => l.id === lineId);
    await persistReviewUpdate({ lineCostOverrides: [{ lineId, costAfter }] });
    if (wasNoChange) {
      setNotice('Price updated — part moved to Per-part review for apply.');
      setTab('review');
    }
  };

  const resetCostOverride = async (lineId: string) => {
    await persistReviewUpdate({ resetLineCostIds: [lineId] });
  };

  const removeLine = (lineId: string) => {
    setReview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        lines: prev.lines.filter((l) => l.id !== lineId),
      };
    });
    void persistReviewUpdate({ excludeLineIds: [lineId] });
  };

  const resolveConflict = async (group: VendorPriceConflictGroup, winningLineId: string) => {
    const partId = ambiguousPartPick[group.conflictGroupId];
    setIsSaving(true);
    try {
      const res = await fetch(`/api/vendor-price-imports/${encodeURIComponent(importId)}/review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolveConflicts: [
            {
              conflictGroupId: group.conflictGroupId,
              winningLineId,
              ...(partId ? { partId } : {}),
            },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve conflict.');
      setReview(data.review);
      setNotice('Conflict resolved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resolve.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCommit = async () => {
    setIsCommitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/vendor-price-imports/${encodeURIComponent(importId)}/commit`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Commit failed.');
      setAppliedCount(data.appliedCount ?? null);
      setNotice(`Applied ${data.appliedCount} price update(s) to inventory.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Commit failed.');
    } finally {
      setIsCommitting(false);
    }
  };

  const handleRescan = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/vendor-price-imports/${encodeURIComponent(importId)}/rescan`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rescan failed.');
      setReview(data.review);
      setStatus(data.import?.status);
      setNotice('File rescanned.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rescan failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleDiscard = async () => {
    if (!confirm('Discard this draft?')) return;
    await fetch(`/api/vendor-price-imports/${encodeURIComponent(importId)}/discard`, { method: 'POST' });
    router.push('/parts/price-updates');
  };

  const summary = review?.summary;
  const isApplied = isVendorPriceImportApplied(status);
  const readOnly = isApplied;
  const canCommit =
    !isApplied &&
    canCommitImports &&
    review &&
    status === 'READY' &&
    review.blockingIssues.length === 0 &&
    (summary?.selectedCount ?? 0) > 0;

  const statusLabel = vendorPriceImportStatusLabel(status);

  const headerActions = isApplied ? null : (
    <>
      {canReviewAndImport ? (
      <button
        type="button"
        onClick={() => void handleRescan()}
        disabled={loading || isCommitting}
        className={inventorySecondaryButtonClass}
      >
        Rescan
      </button>
      ) : null}
      {canDiscardImports ? (
      <button
        type="button"
        onClick={() => void handleDiscard()}
        className={inventorySecondaryButtonClass}
      >
        Discard
      </button>
      ) : null}
      {canCommitImports ? (
      <button
        type="button"
        onClick={() => void handleCommit()}
        disabled={!canCommit || isCommitting || isSaving}
        className={inventoryPrimaryButtonClass}
      >
        {isCommitting ? 'Applying…' : `Apply ${summary?.selectedCount ?? 0} update(s)`}
      </button>
      ) : null}
    </>
  );

  const noticeBanner =
    notice || error ? (
      <div className="px-6 pt-4 space-y-2">
        {notice && (
          <div className="bg-green-600 text-white p-4 rounded-xl shadow-lg">
            <p className="font-bold">{notice}</p>
          </div>
        )}
        {error && (
          <div className="bg-red-500 text-white p-4 rounded-xl shadow-lg">
            <p className="font-bold">{error}</p>
          </div>
        )}
      </div>
    ) : null;

  if (sessionStatus === 'loading' || permissionsLoading || loading) {
    return (
      <InventoryPageShell
        title="Price import review"
        subtitle="Loading…"
        backHref="/parts/price-updates"
        backLabel="Price updates"
        contentScroll
      >
        <InventoryLoadingSpinner label="Loading review…" />
      </InventoryPageShell>
    );
  }

  if (!canViewImports) {
    return (
      <InventoryPageShell
        title="Price import review"
        backHref="/parts/price-updates"
        backLabel="Price updates"
      >
        <div className="pointer-events-none select-none space-y-4 blur-sm opacity-60">
          <div className="h-20 rounded-2xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="h-36 rounded-2xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
            <div className="h-36 rounded-2xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
            <div className="h-36 rounded-2xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
          </div>
        </div>
        <AccessDeniedOverlay message="You do not have permission to view vendor price imports." />
      </InventoryPageShell>
    );
  }

  if (!review) {
    return (
      <InventoryPageShell
        title="Price import review"
        backHref="/parts/price-updates"
        backLabel="Price updates"
      >
        <p className="text-slate-500 py-8">Import not found.</p>
      </InventoryPageShell>
    );
  }

  return (
    <InventoryPageShell
      title={review.sourceFileName}
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span>{review.vendorDisplayName}</span>
          {isApplied ? (
            <span className="inline-flex items-center rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
              {statusLabel}
            </span>
          ) : (
            <span className="text-slate-500 dark:text-slate-400">· {statusLabel}</span>
          )}
        </span>
      }
      backHref="/parts/price-updates"
      backLabel="Price updates"
      headerActions={headerActions}
      banner={noticeBanner}
      contentScroll={false}
    >
      <div className="flex flex-col flex-1 min-h-0 h-full">
        {canReviewAndImport ? (
          <PriceImportTabBar
            activeTab={activeTab}
            onTabChange={setTab}
            unresolvedConflicts={conflictsTabCount}
            matchedCount={matchedLines.length}
            noChangeCount={noChangeLines.length}
          />
        ) : null}

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {activeTab === 'overview' && (
            <VendorPriceImportOverviewTab
              review={review}
              importStatus={status}
              appliedCount={appliedCount}
              onGoToConflicts={() => setTab('conflicts')}
              onGoToNoChange={() => setTab('no-change')}
            />
          )}
          {canReviewAndImport && activeTab === 'review' && (
            <VendorPriceImportReviewTab
              lines={matchedLines}
              variant="changes"
              sourceFileName={review.sourceFileName}
              onRemoveLine={readOnly ? undefined : removeLine}
              onSaveCostOverride={saveCostOverride}
              onResetCostOverride={resetCostOverride}
              isSaving={isSaving}
              readOnly={readOnly}
            />
          )}
          {canReviewAndImport && activeTab === 'no-change' && (
            <VendorPriceImportReviewTab
              lines={noChangeLines}
              variant="no-change"
              sourceFileName={review.sourceFileName}
              onSaveCostOverride={saveCostOverride}
              onResetCostOverride={resetCostOverride}
              isSaving={isSaving}
              readOnly={readOnly}
            />
          )}
          {canReviewAndImport && activeTab === 'conflicts' && (
            <VendorPriceImportConflictsTab
              review={review}
              ambiguousPartPick={ambiguousPartPick}
              onAmbiguousPartPick={(groupId, partId) =>
                setAmbiguousPartPick((prev) => ({ ...prev, [groupId]: partId }))
              }
              onMergeAmbiguousPicks={mergeAmbiguousPicks}
              onResolveConflict={(group, lineId) => void resolveConflict(group, lineId)}
              isSaving={isSaving}
              readOnly={readOnly}
            />
          )}
        </div>
      </div>
    </InventoryPageShell>
  );
}
