/**
 * Vendor name normalization utilities.
 * Canonical keys are lowercase; display uses title casing.
 */

export const MANUAL_VENDOR_KEYS = ['reliable', 'macomb'] as const;

/**
 * Normalize a vendor name to its canonical lowercase key.
 * Use for storage, comparison, and deduplication.
 */
export function normalizeVendorKey(name: string | null | undefined): string {
  if (name == null || typeof name !== 'string') return '';
  return name.toLowerCase().trim();
}

export function mergeManualVendorKeys(vendors: Iterable<string | null | undefined>): string[] {
  const normalized = new Set<string>();

  for (const vendor of vendors) {
    const key = normalizeVendorKey(vendor);
    if (key) normalized.add(key);
  }

  for (const vendor of MANUAL_VENDOR_KEYS) {
    normalized.add(vendor);
  }

  return Array.from(normalized).sort((a, b) => a.localeCompare(b));
}

/**
 * Format a vendor key for display (title case).
 * Preserves symbols like &, -, etc. Capitalizes first letter of each word.
 * Example: 'shop' -> 'Shop', 'core & main' -> 'Core & Main'
 */
export function formatVendorDisplay(key: string | null | undefined): string {
  if (key == null || typeof key !== 'string' || !key.trim()) return '';
  return key
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word) => {
      if (word.length === 0) return '';
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}
