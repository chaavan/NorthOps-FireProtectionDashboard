import { normalizeListContextForLookup } from '@/lib/jobListContext';

/** Overview tab (puller) — omit tab param; job page defaults to Overview. */
export function buildJobOverviewUrl(
  baseUrl: string,
  jobNumber: string,
  listNumber: string | null | undefined,
): string {
  const normalizedJobNumber = jobNumber.trim();
  const normalizedList = normalizeListContextForLookup(listNumber ?? null);
  const root = baseUrl.replace(/\/$/, '');
  return `${root}/job/${encodeURIComponent(normalizedJobNumber)}?list=${encodeURIComponent(normalizedList)}`;
}

/** Notes tab with deep link to a specific note. */
export function buildJobNotesUrl(
  baseUrl: string,
  jobNumber: string,
  listNumber: string | null | undefined,
  noteId: string,
): string {
  const overview = buildJobOverviewUrl(baseUrl, jobNumber, listNumber);
  return `${overview}&tab=notes&openNoteId=${encodeURIComponent(noteId.trim())}`;
}
