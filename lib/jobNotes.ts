import { formatDateInAppTimeZone } from '@/lib/timezone';

export const JOB_NOTE_KIND_DELIVERY_DATE_CHANGE = 'delivery_date_change' as const;

const DATE_ONLY_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
};

function formatNoteDate(value: Date | string | null | undefined): string {
  if (value == null || value === '') return '—';
  const formatted = formatDateInAppTimeZone(value, DATE_ONLY_OPTIONS);
  return formatted || '—';
}

/** Label for delivery-date-change notes in the Notes tab. */
export function formatDeliveryDateChangeBadge(
  from: Date | string | null | undefined,
  to: Date | string | null | undefined,
): string {
  return `Delivery date change · ${formatNoteDate(from)} → ${formatNoteDate(to)}`;
}
