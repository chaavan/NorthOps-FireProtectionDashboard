/** Normalize part number for matching job lines to pre-order rows (same as overview inventory lookups). */
export function normalizeJobPartKey(partNumber: string | null | undefined): string {
  if (!partNumber) return "";
  return partNumber.replace(/[\s\t\r\n]+/g, "").toUpperCase().trim();
}

export function jobPreorderPartKey(
  partNumber: string | null | undefined,
): string {
  return normalizeJobPartKey(partNumber);
}

export function jobPreorderLineAggregateKey(
  listNumber: string | null | undefined,
  partNumber: string | null | undefined,
): string {
  const ln = (listNumber && String(listNumber).trim()) || "1";
  const pn = normalizeJobPartKey(partNumber);
  return `${ln}::${pn}`;
}
