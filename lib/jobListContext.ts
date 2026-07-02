export const DEFAULT_LIST_NUMBER = "1";
export const LIST_CONTEXT_ALL = "__ALL__";

export function normalizeListNumber(
  listNumber: string | null | undefined,
): string {
  const trimmed = typeof listNumber === "string" ? listNumber.trim() : "";
  return trimmed.length > 0 ? trimmed : DEFAULT_LIST_NUMBER;
}

export function normalizeListContextForLookup(
  listNumber: string | null | undefined,
): string {
  const trimmed = typeof listNumber === "string" ? listNumber.trim() : "";
  if (!trimmed || trimmed === LIST_CONTEXT_ALL) {
    return DEFAULT_LIST_NUMBER;
  }
  return trimmed;
}

export function buildJobListKey(
  jobNumber: string,
  listNumber: string | null | undefined,
): string {
  return `${jobNumber.trim()}|${normalizeListNumber(listNumber)}`;
}

