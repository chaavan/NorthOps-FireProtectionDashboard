const SUPPLIER_ALIASES: Record<string, string> = {
  "CORE & MAIN": "CORE MAIN",
  "CORE AND MAIN": "CORE MAIN",
};

export function normalizeSupplierKey(value: string | null | undefined): string {
  if (!value) return "UNASSIGNED";

  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[&]/g, " AND ")
    .replace(/\s+/g, " ")
    .trim();

  return SUPPLIER_ALIASES[normalized] ?? normalized;
}

export function displaySupplierName(value: string | null | undefined): string {
  const key = normalizeSupplierKey(value);
  if (key === "UNASSIGNED") return "Unassigned";
  return key;
}

export function parseEmailList(input: string[] | string | null | undefined): string[] {
  const raw = Array.isArray(input) ? input : (input ?? "").split(",");
  const seen = new Set<string>();
  const emails: string[] = [];

  for (const value of raw) {
    const email = String(value).trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }

  return emails;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
