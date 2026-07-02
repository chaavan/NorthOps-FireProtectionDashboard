'use client';

import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import DashboardSidebar from '@/components/DashboardSidebar';
import AccessDeniedOverlay from '@/components/AccessDeniedOverlay';
import { formatDateInAppTimeZone } from '@/lib/timezone';
import { usePermissions } from '@/lib/hooks/usePermissions';
import {
  ADMIN_JOBS_HIGHLIGHT_DURATION_MS,
  ADMIN_JOBS_HIGHLIGHT_MAX_AGE_MS,
  adminJobsRowKey,
  buildAdminJobsSearchParams,
  clearLastOpened,
  loadUiSnapshot,
  normalizeAdminJobsSearchTerm,
  peekLastOpened,
  readUiSnapshotFromSearchParams,
  saveUiSnapshot,
  setLastOpened,
  type AdminJobsStatusFilter,
} from '@/lib/adminJobsClientState';
import { canAccessJobDirectory } from '@/lib/permissionCatalog';
import { isJobPreorderEnabled } from '@/lib/featureFlags';

interface JobWithStatus {
  jobNumber: string;
  jobName: string;
  listNumber: string | null;
  area: string | null;
  lineCount: number;
  pulledCount: number;
  status: 'white' | 'green' | 'yellow' | 'orange' | 'pink' | 'lime' | 'blue' | 'purple' | 'not-processed';
  allDelivered?: boolean;
  isServiceJob?: boolean;
  listDate: string | null;
  deliveryDate: string | null;
  createdAt: string;
  updatedAt: string;
  creatorTimezone: string | null;
  completionPercentage: number;
  purchaseOrderAccountedFor?: boolean;
}

export default function AdminJobsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const {
    permissions,
    isDeveloper,
    isSuperAdmin,
    isLoading: permissionsLoading,
  } = usePermissions();
  const jobPreorderFeaturesEnabled = isJobPreorderEnabled();
  const [jobs, setJobs] = useState<JobWithStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AdminJobsStatusFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null);
  const wasLoadingRef = useRef(true);
  const uiHydratedRef = useRef(false);
  const canAccessAllJobs =
    isDeveloper ||
    isSuperAdmin ||
    canAccessJobDirectory(permissions);
  const isAccessDenied = !permissionsLoading && !canAccessAllJobs;
  const normalizedSearchTerm = useMemo(
    () => normalizeAdminJobsSearchTerm(searchTerm),
    [searchTerm],
  );
  const currentUiSnapshot = useMemo(
    () => ({ searchTerm: normalizedSearchTerm, filter }),
    [normalizedSearchTerm, filter],
  );

  useLayoutEffect(() => {
    if (status !== 'authenticated') return;
    if (pathname !== '/admin/jobs') return;
    if (typeof window === 'undefined') return;

    const fromUrl = readUiSnapshotFromSearchParams(
      new URLSearchParams(window.location.search),
    );
    const fromStorage = loadUiSnapshot();
    const nextUiState = fromUrl.hasExplicitState
      ? { searchTerm: fromUrl.searchTerm, filter: fromUrl.filter }
      : fromStorage ?? { searchTerm: '', filter: 'all' as const };

    setSearchTerm((prev) =>
      prev === nextUiState.searchTerm ? prev : nextUiState.searchTerm,
    );
    setFilter((prev) => (prev === nextUiState.filter ? prev : nextUiState.filter));
    uiHydratedRef.current = true;
  }, [pathname, status]);

  useEffect(() => {
    if (status === 'loading') return;

    if (!session) {
      router.push('/login?callbackUrl=/admin/jobs');
      return;
    }

    if (permissionsLoading) return;
    if (isAccessDenied) {
      setJobs([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    loadJobs();
  }, [isAccessDenied, permissionsLoading, session, status, router]);

  useEffect(() => {
    if (status !== 'authenticated' || !uiHydratedRef.current || !pathname) return;
    const id = window.setTimeout(() => {
      const currentQuery = window.location.search.startsWith('?')
        ? window.location.search.slice(1)
        : window.location.search;
      const nextParams = buildAdminJobsSearchParams(currentUiSnapshot);
      const nextQuery = nextParams.toString();

      if (nextQuery !== currentQuery) {
        router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
          scroll: false,
        });
      }
      saveUiSnapshot(currentUiSnapshot);
    }, 300);
    return () => window.clearTimeout(id);
  }, [currentUiSnapshot, pathname, router, status]);

  const loadJobs = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/admin/jobs/all');
      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 403) {
          setJobs([]);
          setError(null);
          return;
        }
        throw new Error(errorData.error || 'Failed to load jobs');
      }

      const data = await response.json();
      setJobs(data.jobs || []);
    } catch (err) {
      console.error('Error loading jobs:', err);
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string, allDelivered?: boolean): string => {
    // Delivered jobs stay readable, but look clearly lower-priority.
    if (allDelivered) {
      return 'bg-slate-200 text-slate-700 border-slate-300 dark:bg-slate-800/80 dark:text-slate-300 dark:border-slate-700';
    }

    switch (status) {
      case 'white':
        return 'bg-gray-500/80 text-white border-gray-600';
      case 'green':
        return 'bg-green-600 text-white border-green-700';
      case 'yellow':
        return 'bg-yellow-500 text-white border-yellow-600';
      case 'orange':
        return 'bg-orange-500 text-white border-orange-600';
      case 'pink':
        return 'bg-pink-600 text-white border-pink-700';
      case 'lime':
        return 'bg-fuchsia-600 text-white border-fuchsia-700';
      case 'blue':
        return 'bg-blue-600 text-white border-blue-700';
      case 'not-processed':
        return 'bg-red-600 text-white border-red-700';
      case 'purple':
        return 'bg-purple-600 text-white border-purple-700';
      case 'darker-blue': // Legacy support
        return 'bg-purple-600 text-white border-purple-700';
      default:
        return 'bg-gray-500/80 text-white border-gray-600';
    }
  };

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'white':
        return 'Delivered';
      case 'green':
        return 'Needs Pulling';
      case 'yellow':
        return 'Backorders';
      case 'orange':
        return 'Supplier Pickup';
      case 'pink':
        return 'Jobsite Delivery';
      case 'lime':
        return 'Preordered';
      case 'blue':
        return 'Ready for Delivery';
      case 'not-processed':
        return 'Not Processed';
      case 'purple':
        return 'Service Jobs';
      case 'darker-blue': // Legacy support
        return 'Service Jobs';
      default:
        return 'Unknown';
    }
  };

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchesFilter =
        filter === 'all'
          ? true
          : filter === 'service'
            ? job.isServiceJob === true
            : job.status === filter;
      const normalizedSearch = normalizedSearchTerm.toLowerCase();
      const matchesSearch =
        normalizedSearch === '' ||
        job.jobNumber.toLowerCase().includes(normalizedSearch) ||
        (job.jobName?.toLowerCase().includes(normalizedSearch) ?? false) ||
        (job.listNumber ?? '').toLowerCase().includes(normalizedSearch);
      return matchesFilter && matchesSearch;
    });
  }, [filter, jobs, normalizedSearchTerm]);

  useLayoutEffect(() => {
    if (isLoading) {
      wasLoadingRef.current = true;
      return;
    }
    if (!wasLoadingRef.current || jobs.length === 0) return;
    wasLoadingRef.current = false;

    const pending = peekLastOpened();
    if (!pending) return;
    if (Date.now() - pending.openedAt > ADMIN_JOBS_HIGHLIGHT_MAX_AGE_MS) {
      clearLastOpened();
      return;
    }
    const key = adminJobsRowKey(pending.jobNumber, pending.listNumber);
    const exists = filteredJobs.some(
      (j) => adminJobsRowKey(j.jobNumber, j.listNumber) === key,
    );
    if (!exists) {
      clearLastOpened();
      return;
    }
    clearLastOpened();
    setHighlightKey(key);
  }, [isLoading, jobs.length, filteredJobs]);

  useEffect(() => {
    if (!highlightKey) return;
    const t = window.setTimeout(
      () => setHighlightKey(null),
      ADMIN_JOBS_HIGHLIGHT_DURATION_MS,
    );
    return () => window.clearTimeout(t);
  }, [highlightKey]);

  useLayoutEffect(() => {
    if (!highlightKey) return;
    highlightRowRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [highlightKey]);

  useEffect(() => {
    if (jobPreorderFeaturesEnabled || filter !== 'lime') return;
    setFilter('all');
  }, [filter, jobPreorderFeaturesEnabled]);

  if (status === 'loading' || permissionsLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-slate-700 dark:text-slate-400 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50 dark:bg-slate-900 flex">
      {/* Left Sidebar */}
      <DashboardSidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className={`sticky top-0 z-10 bg-white dark:bg-slate-800/95 backdrop-blur-sm border-b border-gray-200 dark:border-slate-700/50 ${isAccessDenied ? 'pointer-events-none select-none blur-sm opacity-60' : ''}`}>
          <div className="px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">
                  All Jobs
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 font-medium">
                  Complete job history and status overview
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Error Banner */}
        {error && !isAccessDenied && (
          <div className="px-6 pt-4">
            <div className="bg-red-500 text-white p-4 rounded-xl shadow-lg">
              <p className="font-bold">Error: {error}</p>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className={`flex-1 flex flex-col overflow-hidden px-6 py-6 bg-gray-50 dark:bg-slate-900 min-h-0 ${isAccessDenied ? 'pointer-events-none select-none blur-sm opacity-60' : ''}`}>
          <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-6 sm:p-8 flex flex-col overflow-hidden min-h-0 h-full">
            {/* Filters and Search */}
            <div className="mb-6 space-y-4 flex-shrink-0">
              <div className="flex w-full min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="relative w-full min-w-0 lg:flex-1 lg:min-w-[min(100%,20rem)]">
                  <input
                    type="text"
                    placeholder="Search by job number, job name, or list number..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full min-w-0 px-4 py-2.5 pl-11 text-base bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-500 shadow-sm hover:border-gray-400 dark:hover:border-slate-500/80 transition-all"
                  />
                  <svg
                    className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-500 dark:text-slate-400 pointer-events-none"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <div className="flex min-w-0 max-w-full flex-wrap gap-2">
                  {(
                    [
                      'all',
                      'white',
                      'green',
                      'yellow',
                      'orange',
                      'pink',
                      ...(jobPreorderFeaturesEnabled ? (['lime'] as const) : []),
                      'blue',
                      'not-processed',
                      'service',
                    ] as const satisfies readonly AdminJobsStatusFilter[]
                  ).map((statusFilter) => (
                    <button
                      key={statusFilter}
                      onClick={() => setFilter(statusFilter)}
                      className={`px-4 py-2 rounded-xl font-semibold text-sm transition-all border ${
                        filter === statusFilter
                          ? statusFilter === 'service'
                            ? 'bg-purple-600 text-white border-purple-700 shadow-md'
                            : getStatusColor(statusFilter) + ' shadow-md'
                          : 'bg-gray-100 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 border-gray-300 dark:border-slate-600/80 hover:bg-gray-200 dark:hover:bg-slate-700/70'
                      }`}
                    >
                      {statusFilter === 'all' ? 'All' : statusFilter === 'service' ? 'Service jobs' : getStatusLabel(statusFilter)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400">
                Showing {filteredJobs.length} of {jobs.length} jobs
              </div>
            </div>

            {/* Jobs Table */}
            <div className="flex-1 overflow-y-auto overflow-x-auto min-h-0">
              <table className="w-full">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b-2 border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/95 backdrop-blur-sm">
                    <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Job Number</th>
                    <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Job Name</th>
                    <th className="text-center py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">List #</th>
                    <th className="text-center py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Area</th>
                    <th className="text-center py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Status</th>
                    <th className="text-center py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Progress</th>
                    <th className="text-center py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">List Date</th>
                    <th className="text-center py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Delivery Date</th>
                    <th className="text-center py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                  {filteredJobs.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-8 text-slate-500 dark:text-slate-400">
                        No jobs found
                      </td>
                    </tr>
                  ) : (
                    filteredJobs.map((job) => {
                      const rowKey = adminJobsRowKey(job.jobNumber, job.listNumber);
                      const isHighlighted = highlightKey === rowKey;
                      const highlightedCellClass = isHighlighted
                        ? 'bg-[linear-gradient(90deg,rgba(34,211,238,0.14),rgba(59,130,246,0.14)_28%,rgba(14,165,233,0.2)_52%,rgba(59,130,246,0.14)_76%,rgba(34,211,238,0.12))] dark:bg-[linear-gradient(90deg,rgba(34,211,238,0.14),rgba(37,99,235,0.2)_30%,rgba(14,165,233,0.26)_52%,rgba(37,99,235,0.18)_74%,rgba(34,211,238,0.12))] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-1px_0_rgba(34,211,238,0.2)]'
                        : '';
                      const firstHighlightedCellClass = isHighlighted
                        ? 'relative before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-[linear-gradient(180deg,rgba(103,232,249,0.1),rgba(103,232,249,0.95),rgba(56,189,248,0.55),rgba(103,232,249,0.12))] before:shadow-[0_0_18px_rgba(34,211,238,0.55)]'
                        : '';
                      const rowGlowClass = isHighlighted
                        ? 'shadow-[inset_0_0_0_1px_rgba(34,211,238,0.18),0_16px_40px_rgba(8,47,73,0.22)]'
                        : '';
                      return (
                      <tr
                        key={`${job.jobNumber}-${job.listNumber ?? ''}`}
                        ref={(el) => {
                          if (isHighlighted) {
                            highlightRowRef.current = el;
                          } else if (highlightRowRef.current === el) {
                            highlightRowRef.current = null;
                          }
                        }}
                        onClick={() => {
                          if (status === 'authenticated') {
                            saveUiSnapshot(currentUiSnapshot);
                          }
                          setLastOpened(job.jobNumber, job.listNumber);
                          router.push(
                            `/job/${job.jobNumber}?list=${encodeURIComponent(job.listNumber || '1')}`,
                          );
                        }}
                        className={`border-b border-gray-200 dark:border-slate-700/30 hover:bg-gray-50 dark:hover:bg-slate-700/30 cursor-pointer transition-all duration-300 ${job.allDelivered ? 'opacity-55' : ''}`}
                      >
                        <td className={`py-3 px-4 font-semibold transition-all duration-300 ${highlightedCellClass} ${firstHighlightedCellClass} ${rowGlowClass} ${job.allDelivered ? 'text-slate-700 dark:text-slate-300' : 'text-slate-900 dark:text-white'}`}>{job.jobNumber}</td>
                        <td className={`py-3 px-4 transition-all duration-300 ${highlightedCellClass} ${rowGlowClass} ${job.allDelivered ? 'text-slate-500 dark:text-slate-400' : 'text-slate-700 dark:text-slate-300'}`}>
                          <span className="inline-flex items-center gap-2 flex-wrap">
                            {job.jobName || '-'}
                            {job.isServiceJob && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 dark:bg-purple-500/20 text-purple-800 dark:text-purple-200">
                                Service job
                              </span>
                            )}
                          </span>
                        </td>
                        <td className={`py-3 px-4 text-center text-sm text-slate-600 dark:text-slate-400 transition-all duration-300 ${highlightedCellClass} ${rowGlowClass}`}>{job.listNumber || '-'}</td>
                        <td className={`py-3 px-4 text-center text-sm text-slate-600 dark:text-slate-400 transition-all duration-300 ${highlightedCellClass} ${rowGlowClass}`}>{job.area || '-'}</td>
                        <td className={`py-3 px-4 text-center transition-all duration-300 ${highlightedCellClass} ${rowGlowClass}`}>
                          <span className="inline-flex items-center justify-center gap-1 flex-wrap">
                            {job.purchaseOrderAccountedFor ? (
                              <span
                                className="text-amber-500 dark:text-amber-400 text-sm leading-none"
                                title="Purchase order accounted for"
                                aria-label="Purchase order accounted for"
                              >
                                ★
                              </span>
                            ) : null}
                            <span className={`inline-block px-3 py-1 rounded-lg text-xs font-semibold border ${getStatusColor(job.status, job.allDelivered)}`}>
                              {job.allDelivered ? 'Delivered' : getStatusLabel(job.status)}
                            </span>
                          </span>
                        </td>
                        <td className={`py-3 px-4 text-center transition-all duration-300 ${highlightedCellClass} ${rowGlowClass}`}>
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-24 bg-gray-200 dark:bg-slate-700/50 rounded-full h-2">
                              <div
                                className="bg-blue-600 h-2 rounded-full transition-all"
                                style={{ width: `${job.completionPercentage}%` }}
                              />
                            </div>
                            <span className="text-sm text-slate-600 dark:text-slate-400">
                              {job.pulledCount}/{job.lineCount}
                            </span>
                          </div>
                        </td>
                        <td className={`py-3 px-4 text-center text-sm text-slate-600 dark:text-slate-400 transition-all duration-300 ${highlightedCellClass} ${rowGlowClass}`}>
                          {job.listDate ? formatDateInAppTimeZone(job.listDate) : '-'}
                        </td>
                        <td className={`py-3 px-4 text-center text-sm text-slate-600 dark:text-slate-400 transition-all duration-300 ${highlightedCellClass} ${rowGlowClass}`}>
                          {job.deliveryDate ? formatDateInAppTimeZone(job.deliveryDate) : '-'}
                        </td>
                        <td className={`py-3 px-4 text-center text-sm text-slate-600 dark:text-slate-500 transition-all duration-300 ${highlightedCellClass} ${rowGlowClass}`}>
                          {formatDateInAppTimeZone(job.createdAt)}
                        </td>
                      </tr>
                    );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
        {isAccessDenied && (
          <AccessDeniedOverlay message="You do not have permission to view All Jobs." />
        )}
      </div>
    </div>
  );
}
