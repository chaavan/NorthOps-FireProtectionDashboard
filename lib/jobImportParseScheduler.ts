import { waitUntil } from '@vercel/functions';
import { parseJobImport } from '@/lib/jobImportService';

/**
 * On Vercel, keep the HTTP response fast and finish parsing in the background.
 * Locally (`!VERCEL`), the caller should `await parseJobImport` instead for reliability.
 */
export function scheduleJobImportParse(importId: string): void {
  const task = parseJobImport(importId).catch((error) => {
    console.error('Background job import parse failed:', importId, error);
  });
  waitUntil(task);
}
