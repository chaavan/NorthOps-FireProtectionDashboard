/**
 * Client-only sessionStorage helpers for the home calendar (view, date, filters).
 * Do not import from Server Components.
 */

export const CALENDAR_UI_KEY = 'tfp:calendar:ui';

export type CalendarViewMode = 'month' | 'week' | 'biweek';

export type CalendarStatusFilter =
  | 'all'
  | 'delivered'
  | 'delivery-only'
  | 'not-processed'
  | 'green'
  | 'yellow'
  | 'orange'
  | 'pink'
  | 'lime'
  | 'blue';

export type CalendarJobTypeFilter = 'all' | 'contract' | 'service';

export type CalendarUiSnapshot = {
  v: 1;
  viewMode: CalendarViewMode;
  selectedDate: string;
  currentMonth: string;
  statusFilter: CalendarStatusFilter;
  jobTypeFilter: CalendarJobTypeFilter;
  updatedAt: number;
};

export type CalendarUiState = {
  viewMode: CalendarViewMode;
  selectedDate: Date;
  currentMonth: Date;
  statusFilter: CalendarStatusFilter;
  jobTypeFilter: CalendarJobTypeFilter;
};

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_RE = /^\d{4}-\d{2}-01$/;

function toNearestWorkday(date: Date): Date {
  const normalized = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    12,
    0,
    0,
  );
  const day = normalized.getDay();
  if (day === 0) {
    normalized.setDate(normalized.getDate() + 1);
  } else if (day === 6) {
    normalized.setDate(normalized.getDate() - 1);
  }
  return normalized;
}

function isCalendarViewMode(v: unknown): v is CalendarViewMode {
  return v === 'month' || v === 'week' || v === 'biweek';
}

function isCalendarStatusFilter(v: unknown): v is CalendarStatusFilter {
  return (
    v === 'all' ||
    v === 'delivered' ||
    v === 'delivery-only' ||
    v === 'not-processed' ||
    v === 'green' ||
    v === 'yellow' ||
    v === 'orange' ||
    v === 'pink' ||
    v === 'lime' ||
    v === 'blue'
  );
}

function isCalendarJobTypeFilter(v: unknown): v is CalendarJobTypeFilter {
  return v === 'all' || v === 'contract' || v === 'service';
}

function parseDateKey(value: string): Date | null {
  if (!DATE_KEY_RE.test(value)) return null;
  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  const date = new Date(year, month - 1, day, 12, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function parseMonthKey(value: string): Date | null {
  if (!MONTH_KEY_RE.test(value)) return null;
  const [yearRaw, monthRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const date = new Date(year, month - 1, 1, 12, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1) return null;
  return date;
}

export function formatCalendarDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatCalendarMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

export function getDefaultCalendarUiState(): CalendarUiState {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  return {
    viewMode: 'week',
    selectedDate: toNearestWorkday(today),
    currentMonth: new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0),
    statusFilter: 'all',
    jobTypeFilter: 'all',
  };
}

export function loadCalendarUiSnapshot(): CalendarUiState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CALENDAR_UI_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CalendarUiSnapshot>;
    if (parsed.v !== 1) return null;
    if (!isCalendarViewMode(parsed.viewMode)) return null;
    if (!isCalendarStatusFilter(parsed.statusFilter)) return null;
    if (!isCalendarJobTypeFilter(parsed.jobTypeFilter)) return null;
    if (typeof parsed.selectedDate !== 'string' || typeof parsed.currentMonth !== 'string') {
      return null;
    }

    const selectedDate = parseDateKey(parsed.selectedDate);
    const currentMonth = parseMonthKey(parsed.currentMonth);
    if (!selectedDate || !currentMonth) return null;

    return {
      viewMode: parsed.viewMode,
      selectedDate: toNearestWorkday(selectedDate),
      currentMonth,
      statusFilter: parsed.statusFilter,
      jobTypeFilter: parsed.jobTypeFilter,
    };
  } catch {
    return null;
  }
}

export function saveCalendarUiSnapshot(state: CalendarUiState): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: CalendarUiSnapshot = {
      v: 1,
      viewMode: state.viewMode,
      selectedDate: formatCalendarDateKey(state.selectedDate),
      currentMonth: formatCalendarMonthKey(state.currentMonth),
      statusFilter: state.statusFilter,
      jobTypeFilter: state.jobTypeFilter,
      updatedAt: Date.now(),
    };
    sessionStorage.setItem(CALENDAR_UI_KEY, JSON.stringify(payload));
  } catch {
    // quota / private mode
  }
}
