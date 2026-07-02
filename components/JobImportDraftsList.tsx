'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  JobImportListStatus,
  JobImportListStatusCounts,
  JobImportListSummary,
} from '@/lib/jobImportTypes';

type DraftAction = 'discard' | 'rescan';
type DraftTab = 'all' | JobImportListStatus;

interface JobImportDraftsListProps {
  canViewDrafts?: boolean;
  canViewAllDrafts?: boolean;
  canEditOthersDrafts?: boolean;
  currentUserEmail?: string;
  refreshKey?: number;
}

const PAGE_SIZE = 8;

const EMPTY_COUNTS: JobImportListStatusCounts = {
  all: 0,
  processing: 0,
  ready: 0,
  failed: 0,
};

const TABS: Array<{ id: DraftTab; label: string; countKey: keyof JobImportListStatusCounts }> = [
  { id: 'all', label: 'All', countKey: 'all' },
  { id: 'READY', label: 'Ready', countKey: 'ready' },
  { id: 'PROCESSING', label: 'Processing', countKey: 'processing' },
  { id: 'FAILED', label: 'Failed', countKey: 'failed' },
];

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Not saved yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not saved yet';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getDraftTitle(draft: JobImportListSummary): string {
  const jobNumber = draft.jobInfo?.jobNumber?.trim();
  const jobName = draft.jobInfo?.jobName?.trim();
  if (jobNumber && jobName) return `${jobNumber} - ${jobName}`;
  if (jobNumber) return `Job ${jobNumber}`;
  if (jobName) return jobName;
  return draft.sourceFileName;
}

function getDraftSubtitle(draft: JobImportListSummary): string {
  const listNumber = draft.jobInfo?.listNumber?.trim();
  const sourceLabel = `PDF: ${draft.sourceFileName}`;
  return listNumber ? `List ${listNumber} - ${sourceLabel}` : sourceLabel;
}

function getStatusClasses(status: JobImportListSummary['status']): string {
  if (status === 'FAILED') {
    return 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200';
  }
  if (status === 'PROCESSING') {
    return 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200';
  }
  return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200';
}

function getStatusLabel(status: JobImportListSummary['status']): string {
  if (status === 'PROCESSING') return 'Processing';
  if (status === 'FAILED') return 'Failed';
  return 'Ready';
}

function mergeDrafts(current: JobImportListSummary[], incoming: JobImportListSummary[]): JobImportListSummary[] {
  const byId = new Map<string, JobImportListSummary>();
  for (const draft of current) byId.set(draft.id, draft);
  for (const draft of incoming) byId.set(draft.id, draft);
  return Array.from(byId.values());
}

function decrementCounts(
  counts: JobImportListStatusCounts,
  status: JobImportListSummary['status'],
): JobImportListStatusCounts {
  const next = { ...counts, all: Math.max(0, counts.all - 1) };
  if (status === 'PROCESSING') next.processing = Math.max(0, next.processing - 1);
  if (status === 'READY') next.ready = Math.max(0, next.ready - 1);
  if (status === 'FAILED') next.failed = Math.max(0, next.failed - 1);
  return next;
}

export default function JobImportDraftsList({
  canViewDrafts = false,
  canViewAllDrafts = false,
  canEditOthersDrafts = false,
  currentUserEmail = '',
  refreshKey = 0,
}: JobImportDraftsListProps) {
  const router = useRouter();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [drafts, setDrafts] = useState<JobImportListSummary[]>([]);
  const [counts, setCounts] = useState<JobImportListStatusCounts>(EMPTY_COUNTS);
  const [activeTab, setActiveTab] = useState<DraftTab>('all');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<{ id: string; action: DraftAction } | null>(null);
  const [draftToDiscard, setDraftToDiscard] = useState<JobImportListSummary | null>(null);

  const buildListUrl = useCallback(
    (cursor?: string | null) => {
      const params = new URLSearchParams({ take: String(PAGE_SIZE) });
      params.set('status', activeTab === 'all' ? 'all' : activeTab);
      if (cursor) params.set('cursor', cursor);
      return `/api/job-imports?${params.toString()}`;
    },
    [activeTab],
  );

  const loadDrafts = useCallback(
    async (options?: { reset?: boolean; cursor?: string | null }) => {
      if (!canViewDrafts) {
        setDrafts([]);
        setCounts(EMPTY_COUNTS);
        setHasMore(false);
        setNextCursor(null);
        setIsInitialLoading(false);
        setIsLoadingMore(false);
        return;
      }

      const reset = options?.reset ?? false;
      try {
        if (reset) {
          setIsInitialLoading(true);
          setDrafts([]);
        } else {
          setIsLoadingMore(true);
        }
        setError(null);
        const response = await fetch(buildListUrl(options?.cursor ?? null));
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load job drafts.');
        }

        const incoming = (data?.imports || []) as JobImportListSummary[];
        setDrafts((current) => (reset ? incoming : mergeDrafts(current, incoming)));
        setCounts(data?.counts || EMPTY_COUNTS);
        setNextCursor(data?.nextCursor || null);
        setHasMore(Boolean(data?.hasMore));
      } catch (draftError) {
        setError((draftError as Error).message || 'Failed to load job drafts.');
      } finally {
        setIsInitialLoading(false);
        setIsLoadingMore(false);
      }
    },
    [buildListUrl, canViewDrafts],
  );

  useEffect(() => {
    void loadDrafts({ reset: true });
  }, [activeTab, loadDrafts, refreshKey]);

  useEffect(() => {
    if (!canViewDrafts || counts.processing <= 0) return;

    const interval = window.setInterval(() => {
      void loadDrafts({ reset: true });
    }, 4000);

    return () => window.clearInterval(interval);
  }, [canViewDrafts, counts.processing, loadDrafts]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || isInitialLoading || isLoadingMore || !canViewDrafts) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && nextCursor) {
          void loadDrafts({ reset: false, cursor: nextCursor });
        }
      },
      { rootMargin: '240px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canViewDrafts, hasMore, isInitialLoading, isLoadingMore, loadDrafts, nextCursor]);

  const openDraft = (draftId: string) => {
    router.push(`/jobs/import/${encodeURIComponent(draftId)}`);
  };

  const discardDraft = async (draft: JobImportListSummary) => {
    try {
      setActiveAction({ id: draft.id, action: 'discard' });
      setError(null);
      const response = await fetch(`/api/job-imports/${encodeURIComponent(draft.id)}`, {
        method: 'DELETE',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to discard draft.');
      }
      setDrafts((current) => current.filter((item) => item.id !== draft.id));
      setCounts((current) => decrementCounts(current, draft.status));
    } catch (discardError) {
      setError((discardError as Error).message || 'Failed to discard draft.');
    } finally {
      setActiveAction(null);
    }
  };

  const rescanDraft = async (draft: JobImportListSummary) => {
    try {
      setActiveAction({ id: draft.id, action: 'rescan' });
      setError(null);
      const response = await fetch(`/api/job-imports/${encodeURIComponent(draft.id)}/reparse`, {
        method: 'POST',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to retry draft.');
      }
      await loadDrafts({ reset: true });
    } catch (rescanError) {
      setError((rescanError as Error).message || 'Failed to retry draft.');
    } finally {
      setActiveAction(null);
    }
  };

  const tabSummary = useMemo(() => {
    const count = counts[TABS.find((tab) => tab.id === activeTab)?.countKey || 'all'];
    return `${count} ${count === 1 ? 'draft' : 'drafts'}`;
  }, [activeTab, counts]);

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/60 p-4 sm:p-5 lg:p-6 shadow-sm dark:shadow-none min-w-0">
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">Job Drafts</h2>
        <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">{tabSummary}</p>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full border px-3 py-1.5 text-xs sm:text-sm font-semibold transition ${
              activeTab === tab.id
                ? 'border-blue-500 bg-blue-600 text-white shadow-sm'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-300 dark:hover:bg-slate-700/50'
            }`}
          >
            {tab.label}
            <span className="ml-2 rounded-full bg-white/20 px-1.5 py-0.5 text-[11px]">
              {counts[tab.countKey]}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs sm:text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
          {error}
        </div>
      )}

      {!canViewDrafts ? (
        <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-400">
          Job import drafts are turned off for your account.
        </p>
      ) : isInitialLoading ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/30"
            />
          ))}
        </div>
      ) : drafts.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-600 dark:bg-slate-900/30 dark:text-slate-400">
          No {activeTab === 'all' ? '' : getStatusLabel(activeTab).toLowerCase()} drafts found. Upload a picksheet to start one.
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {drafts.map((draft) => {
              const isDiscarding = activeAction?.id === draft.id && activeAction.action === 'discard';
              const isRescanning = activeAction?.id === draft.id && activeAction.action === 'rescan';
              const lastSavedAt = draft.draftState.lastAutosavedAt || draft.updatedAt;
              const isOwnDraft = draft.createdBy?.trim().toLowerCase() === currentUserEmail.trim().toLowerCase();
              const canEditDraft = isOwnDraft || (canViewAllDrafts && canEditOthersDrafts);

              return (
                <article
                  key={draft.id}
                  className="group flex min-h-[178px] flex-col justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-blue-200 hover:bg-white hover:shadow-sm dark:border-slate-700 dark:bg-slate-900/30 dark:hover:border-blue-500/40 dark:hover:bg-slate-800/80"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="line-clamp-2 text-base font-bold leading-snug text-slate-900 dark:text-white">
                          {getDraftTitle(draft)}
                        </h3>
                        <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                          {getDraftSubtitle(draft)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${getStatusClasses(draft.status)}`}
                      >
                        {getStatusLabel(draft.status)}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <p>Last saved: {formatDateTime(lastSavedAt)}</p>
                      {canViewAllDrafts && draft.createdBy ? <p>Created by: {draft.createdBy}</p> : null}
                      {draft.status === 'FAILED' && draft.errorMessage ? (
                        <p className="line-clamp-2 text-red-700 dark:text-red-200">{draft.errorMessage}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openDraft(draft.id)}
                      className="rounded-xl bg-blue-600 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      {canEditDraft ? 'Resume' : 'View'}
                    </button>
                    {canEditDraft && draft.status === 'FAILED' && (
                      <button
                        type="button"
                        onClick={() => void rescanDraft(draft)}
                        disabled={Boolean(activeAction)}
                        className="rounded-xl border border-amber-300 px-3.5 py-2 text-xs sm:text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/10"
                      >
                        {isRescanning ? 'Retrying...' : 'Retry'}
                      </button>
                    )}
                    {canEditDraft && (
                      <button
                        type="button"
                        onClick={() => setDraftToDiscard(draft)}
                        disabled={Boolean(activeAction)}
                        className="rounded-xl border border-red-200 px-3.5 py-2 text-xs sm:text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-500/40 dark:text-red-200 dark:hover:bg-red-500/10"
                      >
                        {isDiscarding ? 'Discarding...' : 'Discard'}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <div ref={sentinelRef} className="h-8" />
          {isLoadingMore && (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 2 }).map((_, index) => (
                <div
                  key={index}
                  className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/30"
                />
              ))}
            </div>
          )}
          {!hasMore && drafts.length > 0 && (
            <p className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">
              You are caught up on this draft view.
            </p>
          )}
        </>
      )}

      {draftToDiscard && typeof document !== 'undefined' && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          style={{ zIndex: 9999 }}
          onClick={(event) => {
            if (event.target === event.currentTarget && !activeAction) {
              setDraftToDiscard(null);
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700/50"
            style={{ zIndex: 10000 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mb-2 text-center">
              Discard This Draft?
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 text-center">
              This will permanently remove the draft for{' '}
              <span className="font-semibold break-all">"{getDraftTitle(draftToDiscard)}"</span>. This cannot
              be undone.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                disabled={Boolean(activeAction)}
                onClick={() => setDraftToDiscard(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(activeAction)}
                onClick={() => {
                  if (draftToDiscard) {
                    void discardDraft(draftToDiscard);
                  }
                  setDraftToDiscard(null);
                }}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                Discard Draft
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
