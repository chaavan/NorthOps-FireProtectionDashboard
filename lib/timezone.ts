const DEFAULT_LOCALE = 'en-US';

export const APP_TIME_ZONE = 'America/New_York';

type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getPartsInTimeZone(
  value: DateInput,
  timeZone: string = APP_TIME_ZONE
): { year: string; month: string; day: string } | null {
  const date = toDate(value);
  if (!date) return null;

  const parts = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  if (!year || !month || !day) return null;
  return { year, month, day };
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);

  const offsetText = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+0';
  const match = offsetText.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!match) return 0;

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2] || '0');
  const minutes = Number(match[3] || '0');
  return sign * (hours * 60 + minutes);
}

function getMidnightUtcForTimeZoneDate(
  year: number,
  month: number,
  day: number,
  timeZone: string
): Date {
  const approxUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(approxUtc, timeZone);
  return new Date(approxUtc.getTime() - offsetMinutes * 60_000);
}

export function formatDateInAppTimeZone(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  },
  locale: string = DEFAULT_LOCALE
): string {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(locale, {
    timeZone: APP_TIME_ZONE,
    ...options,
  }).format(date);
}

export function toDateKeyInAppTimeZone(value: DateInput = new Date()): string {
  const parts = getPartsInTimeZone(value, APP_TIME_ZONE);
  if (!parts) return '';
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function parseDateInputInAppTimeZone(value: DateInput): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const text = String(value).trim();
  if (!text) return null;

  // Interpret plain date input as a stable day in Eastern time.
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getAppTimeZoneDayBounds(
  value: DateInput = new Date()
): { start: Date; end: Date } {
  const key = toDateKeyInAppTimeZone(value);
  if (!key) {
    const now = new Date();
    return { start: now, end: now };
  }

  const [yearStr, monthStr, dayStr] = key.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  const start = getMidnightUtcForTimeZoneDate(year, month, day, APP_TIME_ZONE);
  const end = getMidnightUtcForTimeZoneDate(year, month, day + 1, APP_TIME_ZONE);

  return { start, end };
}
