'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import InventoryPageShell, { InventoryLoadingSpinner } from '@/components/InventoryPageShell';
import AccessDeniedOverlay from '@/components/AccessDeniedOverlay';
import VendorPriceImportUploadCard from '@/components/VendorPriceImportUploadCard';
import { usePermissions } from '@/lib/hooks/usePermissions';
import type { VendorPriceImportListItem } from '@/lib/vendorPriceImport/vendorPriceImportTypes';
import { vendorPriceImportStatusLabel } from '@/lib/vendorPriceImport/reviewAnalytics';

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'READY':
      return 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-200';
    case 'PROCESSING':
      return 'bg-blue-500/20 text-blue-700 dark:text-blue-200';
    case 'FAILED':
      return 'bg-red-500/20 text-red-700 dark:text-red-200';
    case 'COMMITTED':
      return 'bg-emerald-600 text-white';
    default:
      return 'bg-amber-500/20 text-amber-700 dark:text-amber-200';
  }
}

export default function VendorPriceUpdatesPage() {
  const { data: session, status: sessionStatus } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const roleIsAdmin = role === 'ADMIN';
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canViewImports = permissionsLoading
    ? roleIsAdmin
    : hasPermission('inventory.vendor_prices.import');
  const canReviewAndImport = permissionsLoading
    ? roleIsAdmin
    : hasPermission('inventory.vendor_prices.review');

  const [profiles, setProfiles] = useState<Array<{ vendorKey: string; displayName: string }>>([]);
  const [imports, setImports] = useState<VendorPriceImportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canViewImports) {
      setLoading(false);
      return;
    }
    try {
      const [profilesRes, importsRes] = await Promise.all([
        fetch('/api/vendor-price-profiles'),
        fetch('/api/vendor-price-imports?take=25'),
      ]);
      const profilesData = await profilesRes.json();
      const importsData = await importsRes.json();
      if (!profilesRes.ok) throw new Error(profilesData.error || 'Failed to load vendors.');
      if (!importsRes.ok) throw new Error(importsData.error || 'Failed to load imports.');
      setProfiles(profilesData.profiles || []);
      setImports(importsData.imports || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [canViewImports]);

  useEffect(() => {
    if (sessionStatus === 'loading' || permissionsLoading) return;
    void load();
  }, [sessionStatus, permissionsLoading, load]);

  const errorBanner =
    error && canViewImports ? (
      <div className="px-6 pt-4">
        <div className="bg-red-500 text-white p-4 rounded-xl shadow-lg">
          <p className="font-bold">{error}</p>
        </div>
      </div>
    ) : null;

  return (
    <InventoryPageShell
      title="Vendor price updates"
      subtitle="Upload vendor pricing sheets, review cost changes, then apply to inventory."
      backHref="/parts"
      backLabel="Inventory"
      banner={errorBanner}
      contentScroll
      >
        {sessionStatus === 'loading' || permissionsLoading || loading ? (
          <InventoryLoadingSpinner label="Loading vendor price updates…" />
        ) : !canViewImports ? (
          <>
            <div className="pointer-events-none select-none space-y-4 blur-sm opacity-60">
              <div className="h-28 rounded-2xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
              <div className="h-64 rounded-2xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
            </div>
            <AccessDeniedOverlay message="You do not have permission to view vendor price imports." />
          </>
        ) : (
        <div className="flex flex-col">
          {canReviewAndImport ? <VendorPriceImportUploadCard canEdit profiles={profiles} /> : null}

          <h2 className="mt-8 text-lg font-semibold text-slate-900 dark:text-white flex-shrink-0">
            Recent imports
          </h2>
          {imports.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No imports yet.</p>
          ) : (
            <div className="mt-3 border border-slate-200 dark:border-slate-700/50 rounded-xl">
              <ul className="divide-y divide-slate-200 dark:divide-slate-700/50">
                {imports.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/parts/price-updates/${item.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-100 dark:hover:bg-slate-700/30 transition-colors"
                    >
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {item.sourceFileName}
                        </span>
                        <span className="ml-2 text-sm text-slate-600 dark:text-slate-300">
                          {item.vendorDisplayName}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        {item.summary && (
                          <span className="text-slate-600 dark:text-slate-400">
                            {item.summary.selectedCount} selected
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(item.status)}`}
                        >
                          {vendorPriceImportStatusLabel(item.status)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </InventoryPageShell>
  );
}
