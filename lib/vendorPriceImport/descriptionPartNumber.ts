import type { VendorPriceConflictCandidate } from './vendorPriceImportTypes';

/** Normalize catalog part numbers for token comparison. */
export function normalizePartNumberToken(value: string): string {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

/**
 * Extract part number after "#" at end of vendor description (ETNA style).
 * e.g. "... CC0392NPE1 Your # 2515VGRDMT" → 2515VGRDMT
 */
export function extractEndHashPartNumber(description: string | null | undefined): string | null {
  if (!description?.trim()) return null;
  const trimmed = description.trim();
  const match = trimmed.match(/(?:^|\s)#\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*$/i);
  if (!match?.[1]) return null;
  return normalizePartNumberToken(match[1]);
}

export type DescriptionPartSuggestion = {
  partId: string;
  pn: string;
  token: string;
};

/**
 * When multiple inventory parts share a vendor ID, suggest one whose pn appears
 * as the trailing # token in the file description. Returns null if 0 or 2+ candidates match.
 */
export function suggestPartFromDescription(
  description: string | null | undefined,
  candidates: VendorPriceConflictCandidate[],
): DescriptionPartSuggestion | null {
  if (candidates.length < 2) return null;

  const token = extractEndHashPartNumber(description);
  if (!token) return null;

  const matched = candidates.filter((c) => normalizePartNumberToken(c.pn) === token);
  if (matched.length !== 1) return null;

  return { partId: matched[0].id, pn: matched[0].pn, token };
}
