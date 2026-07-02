/**
 * Normalize vendor catalog IDs for matching (ETNA sends numeric IDs; DB may store as string).
 * Mirrors legacy Python: 54350.0 -> "54350"
 */
export function normalizeVendorPartId(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim();
  if (!raw) return '';

  const numeric = Number(raw.replace(/,/g, ''));
  if (Number.isFinite(numeric) && /^-?\d+(\.\d+)?$/.test(raw.replace(/,/g, ''))) {
    if (Number.isInteger(numeric) || Math.abs(numeric - Math.round(numeric)) < 1e-9) {
      return String(Math.round(numeric));
    }
  }

  return raw.replace(/\s+/g, '').toUpperCase();
}

export function isValidVendorPartIdForMatch(normalized: string): boolean {
  return normalized.length > 0;
}
