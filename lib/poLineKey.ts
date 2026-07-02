export function normalizeListForPoKey(
  listNumber: string | null | undefined,
): string {
  const s = String(listNumber ?? "").trim();
  if (!s) return "1";

  const num = parseInt(s, 10);
  return Number.isNaN(num) ? s : String(num);
}

/**
 * Canonical identity for a PO line.
 * This MUST be list-scoped so ordering the same part on a different list
 * does not incorrectly appear in Pending-to-Receive.
 */
export function buildPoLineKey(
  jobNumber: string | null | undefined,
  listNumber: string | null | undefined,
  partNumber: string | null | undefined,
): string {
  const job = String(jobNumber ?? "").trim();
  const list = normalizeListForPoKey(listNumber);
  const part = String(partNumber ?? "").trim();
  return `${job}::${list}::${part}`;
}

