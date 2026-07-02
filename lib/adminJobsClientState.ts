/**
 * Client-only sessionStorage helpers for /admin/jobs (search, filter, return highlight).
 * Do not import from Server Components.
 */

export const ADMIN_JOBS_UI_KEY = 'tfp:adminJobs:ui';
export const ADMIN_JOBS_LAST_OPENED_KEY = 'tfp:adminJobs:lastOpened';

export const ADMIN_JOBS_UI_TTL_MS = 10 * 60 * 1000;
export const ADMIN_JOBS_HIGHLIGHT_MAX_AGE_MS = 15_000;
export const ADMIN_JOBS_HIGHLIGHT_DURATION_MS = 3000;

export type AdminJobsStatusFilter =
  | 'all'
  | 'service'
  | 'white'
  | 'green'
  | 'yellow'
  | 'orange'
  | 'pink'
  | 'lime'
  | 'blue'
  | 'not-processed';

export type AdminJobsUiSnapshot = {
  v: 1;
  searchTerm: string;
  filter: AdminJobsStatusFilter;
  updatedAt: number;
};

export type LastOpenedHighlight = {
  v: 1;
  jobNumber: string;
  listNumber: string;
  openedAt: number;
};

type SearchParamsLike = {
  get(name: string): string | null;
  has(name: string): boolean;
};

function isAdminJobsStatusFilter(v: unknown): v is AdminJobsStatusFilter {
  return (
    v === 'all' ||
    v === 'service' ||
    v === 'white' ||
    v === 'green' ||
    v === 'yellow' ||
    v === 'orange' ||
    v === 'pink' ||
    v === 'lime' ||
    v === 'blue' ||
    v === 'not-processed'
  );
}

export function normalizeAdminJobsSearchTerm(searchTerm: string | null | undefined): string {
  return typeof searchTerm === 'string' ? searchTerm.trim() : '';
}

export function normalizeAdminJobsListNumber(listNumber: string | null | undefined): string {
  const t = typeof listNumber === 'string' ? listNumber.trim() : '';
  return t.length > 0 ? t : '1';
}

export function adminJobsRowKey(jobNumber: string, listNumber: string | null | undefined): string {
  return `${jobNumber.trim()}|${normalizeAdminJobsListNumber(listNumber)}`;
}

export function readUiSnapshotFromSearchParams(
  searchParams: SearchParamsLike | null | undefined,
): {
  searchTerm: string;
  filter: AdminJobsStatusFilter;
  hasExplicitState: boolean;
} {
  const rawSearchTerm = searchParams?.get('search') ?? '';
  const searchTerm = normalizeAdminJobsSearchTerm(rawSearchTerm);
  const rawFilter = searchParams?.get('filter');
  const filter = isAdminJobsStatusFilter(rawFilter) ? rawFilter : 'all';
  const hasExplicitState =
    searchTerm.length > 0 ||
    (!!searchParams?.has('filter') && rawFilter !== null);

  return { searchTerm, filter, hasExplicitState };
}

export function buildAdminJobsSearchParams(snapshot: {
  searchTerm: string;
  filter: AdminJobsStatusFilter;
}): URLSearchParams {
  const params = new URLSearchParams();
  const normalizedSearchTerm = normalizeAdminJobsSearchTerm(snapshot.searchTerm);

  if (normalizedSearchTerm) {
    params.set('search', normalizedSearchTerm);
  }
  if (snapshot.filter !== 'all') {
    params.set('filter', snapshot.filter);
  }

  return params;
}

export function loadUiSnapshot(): Pick<
  AdminJobsUiSnapshot,
  'searchTerm' | 'filter'
> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(ADMIN_JOBS_UI_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AdminJobsUiSnapshot>;
    if (parsed.v !== 1 || typeof parsed.updatedAt !== 'number') return null;
    if (Date.now() - parsed.updatedAt > ADMIN_JOBS_UI_TTL_MS) {
      sessionStorage.removeItem(ADMIN_JOBS_UI_KEY);
      return null;
    }
    const searchTerm = normalizeAdminJobsSearchTerm(parsed.searchTerm);
    const filter = isAdminJobsStatusFilter(parsed.filter) ? parsed.filter : 'all';
    return { searchTerm, filter };
  } catch {
    return null;
  }
}

export function saveUiSnapshot(snapshot: {
  searchTerm: string;
  filter: AdminJobsStatusFilter;
}): void {
  if (typeof window === 'undefined') return;
  try {
    const normalizedSearchTerm = normalizeAdminJobsSearchTerm(snapshot.searchTerm);
    const payload: AdminJobsUiSnapshot = {
      v: 1,
      searchTerm: normalizedSearchTerm,
      filter: snapshot.filter,
      updatedAt: Date.now(),
    };
    sessionStorage.setItem(ADMIN_JOBS_UI_KEY, JSON.stringify(payload));
  } catch {
    // quota / private mode
  }
}

export function setLastOpened(jobNumber: string, listNumber: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: LastOpenedHighlight = {
      v: 1,
      jobNumber: jobNumber.trim(),
      listNumber: normalizeAdminJobsListNumber(listNumber),
      openedAt: Date.now(),
    };
    sessionStorage.setItem(ADMIN_JOBS_LAST_OPENED_KEY, JSON.stringify(payload));
  } catch {
    // quota / private mode
  }
}

/** Read last-opened marker without removing (safe for React Strict Mode). */
export function peekLastOpened(): LastOpenedHighlight | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(ADMIN_JOBS_LAST_OPENED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastOpenedHighlight>;
    if (parsed.v !== 1 || typeof parsed.jobNumber !== 'string') return null;
    const listNumber = normalizeAdminJobsListNumber(parsed.listNumber ?? '1');
    const openedAt =
      typeof parsed.openedAt === 'number' ? parsed.openedAt : 0;
    return {
      v: 1,
      jobNumber: parsed.jobNumber.trim(),
      listNumber,
      openedAt,
    };
  } catch {
    return null;
  }
}

export function clearLastOpened(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(ADMIN_JOBS_LAST_OPENED_KEY);
  } catch {
    // ignore
  }
}
