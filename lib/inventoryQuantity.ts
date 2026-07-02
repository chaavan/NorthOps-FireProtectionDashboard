export function normalizePartNumber(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/[\s\t\r\n]+/g, "").toUpperCase().trim();
}

export function partNumberLookupVariants(
  value: string | null | undefined,
): string[] {
  const raw = (value || "").trim();
  const normalized = normalizePartNumber(value);

  const variants = [normalized, raw, raw.toUpperCase(), raw.toLowerCase()].filter(
    Boolean,
  );
  return Array.from(new Set(variants));
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseNonNegativeInt(
  value: unknown,
  fieldName: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = parseFiniteNumber(value);
  if (parsed === null) {
    return { ok: false, error: `${fieldName} must be a valid number` };
  }
  if (!Number.isInteger(parsed)) {
    return { ok: false, error: `${fieldName} must be an integer` };
  }
  if (parsed < 0) {
    return { ok: false, error: `${fieldName} must be >= 0` };
  }
  return { ok: true, value: parsed };
}

export function parseSignedInt(
  value: unknown,
  fieldName: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = parseFiniteNumber(value);
  if (parsed === null) {
    return { ok: false, error: `${fieldName} must be a valid number` };
  }
  if (!Number.isInteger(parsed)) {
    return { ok: false, error: `${fieldName} must be an integer` };
  }
  return { ok: true, value: parsed };
}
