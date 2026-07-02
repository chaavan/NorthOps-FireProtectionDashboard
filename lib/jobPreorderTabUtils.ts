import { jobPreorderPartKey } from "@/lib/jobPartKey";
import type { JobPreorderLineDto } from "@/lib/jobPreorderLines";
import type { JobLineItem } from "@/lib/types";
import { getRemainingQty } from "@/lib/quantityMath";
import { normalizeVendorKey } from "@/lib/vendorUtils";

export type { JobPreorderLineDto };

export type JobPartCatalogEntry = {
  partNumber: string;
  description: string | null;
  uom: string | null;
  vendor: string | null;
  totalNeeded: number;
  listBreakdown: Array<{ listNumber: string; needed: number }>;
};

export type PartReceiveStatus =
  | "None"
  | "On order"
  | "Partial"
  | "In pool"
  | "Received";

export type ReceivingPartRow = {
  partKey: string;
  partNumber: string;
  description: string | null;
  orderedTotal: number;
  receivedTotal: number;
  pendingTotal: number;
  poolAvailable: number;
  pulledJobwide: number;
  status: PartReceiveStatus;
  lastOrderedAt: string | null;
  lines: JobPreorderLineDto[];
};

/** Overview supplier (`type`) wins over PN database vendor (`supplierFromDatabase`). */
export function resolveVendorFromLineItem(item: JobLineItem): string | null {
  const fromOverview = normalizeVendorKey((item.type ?? "").trim());
  if (fromOverview) return fromOverview;
  const fromDatabase = normalizeVendorKey((item.supplierFromDatabase ?? "").trim());
  return fromDatabase || null;
}

function mergePartVendor(entry: JobPartCatalogEntry, item: JobLineItem): void {
  const overviewVendor = normalizeVendorKey((item.type ?? "").trim());
  if (overviewVendor) {
    entry.vendor = overviewVendor;
    return;
  }
  if (!entry.vendor) {
    entry.vendor = resolveVendorFromLineItem(item);
  }
}

export function buildJobPartsCatalog(
  jobLineItems: JobLineItem[],
): JobPartCatalogEntry[] {
  const map = new Map<string, JobPartCatalogEntry>();
  for (const item of jobLineItems) {
    const pn = (item.partNumber || "").trim();
    if (!pn) continue;
    const key = jobPreorderPartKey(pn);
    const needed = Math.max(0, Number(item.quantityNeeded || 0));
    const listNumber = item.listNumber?.trim() || "1";
    if (!map.has(key)) {
      map.set(key, {
        partNumber: pn,
        description: item.description,
        uom: item.uom,
        vendor: resolveVendorFromLineItem(item),
        totalNeeded: 0,
        listBreakdown: [],
      });
    }
    const entry = map.get(key)!;
    entry.totalNeeded += needed;
    const existing = entry.listBreakdown.find((l) => l.listNumber === listNumber);
    if (existing) {
      existing.needed += needed;
    } else {
      entry.listBreakdown.push({ listNumber, needed });
    }
    mergePartVendor(entry, item);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.partNumber.localeCompare(b.partNumber),
  );
}

export function suggestQuantityForPart(
  partNumber: string,
  jobLineItems: JobLineItem[],
  openByPart: Record<string, number>,
  receivedByPart: Record<string, number>,
): number {
  const key = jobPreorderPartKey(partNumber);
  const items = jobLineItems.filter(
    (item) => jobPreorderPartKey(item.partNumber) === key,
  );
  const totalRemaining = items.reduce((sum, item) => {
    const needed = Math.max(0, Number(item.quantityNeeded || 0));
    const fab = Math.max(0, Number(item.quantityFab || 0));
    const shop = Math.max(0, Number(item.quantityPulled || 0));
    const pre = Math.max(0, Number(item.quantityPulledFromPreorder || 0));
    const vendor = Math.max(0, Number(item.quantityReceivedFromOrder || 0));
    return sum + getRemainingQty({ needed, fab, shop, preorder: pre, vendor });
  }, 0);
  const open = openByPart[key] ?? 0;
  const receivedPool = receivedByPart[key] ?? 0;
  const pulled = items.reduce(
    (sum, item) =>
      sum + Math.max(0, Number(item.quantityPulledFromPreorder || 0)),
    0,
  );
  const availableReceived = Math.max(0, receivedPool - pulled);
  const shortfall = Math.max(0, totalRemaining - availableReceived);
  const pendingOpen = open;
  return Math.max(1, shortfall > 0 ? shortfall : pendingOpen > 0 ? 0 : 1);
}

export function derivePartStatus(
  orderedTotal: number,
  receivedTotal: number,
  pendingTotal: number,
  poolAvailable: number,
): PartReceiveStatus {
  if (orderedTotal <= 0 && receivedTotal <= 0) return "None";
  if (pendingTotal > 0 && receivedTotal === 0) return "On order";
  if (pendingTotal > 0 && receivedTotal > 0) return "Partial";
  if (pendingTotal === 0 && poolAvailable > 0) return "In pool";
  if (pendingTotal === 0 && receivedTotal > 0) return "Received";
  return "None";
}

export function aggregateReceivingByPart(
  lines: JobPreorderLineDto[],
  jobLineItems: JobLineItem[],
  poolAvailableByPart: Record<string, number>,
  catalogByPart: Map<string, JobPartCatalogEntry>,
): ReceivingPartRow[] {
  const activeLines = lines.filter((line) => line.status !== "CANCELLED");
  const byPart = new Map<string, JobPreorderLineDto[]>();

  for (const line of activeLines) {
    const key = jobPreorderPartKey(line.partNumber);
    const bucket = byPart.get(key) ?? [];
    bucket.push(line);
    byPart.set(key, bucket);
  }

  const rows: ReceivingPartRow[] = [];

  for (const [partKey, partLines] of byPart) {
    const catalog = catalogByPart.get(partKey);
    const partNumber = partLines[0]?.partNumber ?? catalog?.partNumber ?? partKey;
    const description =
      partLines.find((l) => l.description)?.description ??
      catalog?.description ??
      null;

    const orderedTotal = partLines.reduce((s, l) => s + l.quantity, 0);
    const receivedTotal = partLines.reduce(
      (s, l) => s + l.quantityReceived,
      0,
    );
    const pendingTotal = Math.max(0, orderedTotal - receivedTotal);
    const poolAvailable = poolAvailableByPart[partKey] ?? 0;
    const pulledJobwide = jobLineItems
      .filter((item) => jobPreorderPartKey(item.partNumber) === partKey)
      .reduce(
        (s, item) =>
          s + Math.max(0, Number(item.quantityPulledFromPreorder || 0)),
        0,
      );

    const lastOrderedAt = partLines.reduce<string | null>((latest, line) => {
      if (!line.orderedAt) return latest;
      if (!latest || line.orderedAt > latest) return line.orderedAt;
      return latest;
    }, null);

    rows.push({
      partKey,
      partNumber,
      description,
      orderedTotal,
      receivedTotal,
      pendingTotal,
      poolAvailable,
      pulledJobwide,
      status: derivePartStatus(
        orderedTotal,
        receivedTotal,
        pendingTotal,
        poolAvailable,
      ),
      lastOrderedAt,
      lines: partLines.sort(
        (a, b) =>
          new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime(),
      ),
    });
  }

  return rows.sort((a, b) => a.partNumber.localeCompare(b.partNumber));
}

/** Pending qty on non-cancelled lines with remaining open quantity for a part. */
export function getOpenPreorderPendingForPart(
  lines: JobPreorderLineDto[],
  partNumber: string,
): number {
  const key = jobPreorderPartKey(partNumber);
  return lines
    .filter(
      (line) =>
        line.status !== "CANCELLED" &&
        jobPreorderPartKey(line.partNumber) === key,
    )
    .reduce(
      (sum, line) =>
        sum + Math.max(0, line.quantity - line.quantityReceived),
      0,
    );
}

export function hasOpenPreorderForPart(
  lines: JobPreorderLineDto[],
  partNumber: string,
): boolean {
  return getOpenPreorderPendingForPart(lines, partNumber) > 0;
}

/** Max qty that can be undone on a line without going below job-wide pulled total. */
export function maxUnreceivableForLine(
  line: JobPreorderLineDto,
  poolAvailableForPart: number,
): number {
  if (line.quantityReceived <= 0) return 0;
  return Math.min(
    line.quantityReceived,
    Math.max(0, Math.floor(poolAvailableForPart)),
  );
}

export function lineStatusBadgeClass(status: string): string {
  switch (status) {
    case "OPEN":
      return "border-blue-400/40 bg-blue-500/15 text-blue-700 dark:text-blue-200";
    case "RECEIVED":
      return "border-emerald-400/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200";
    case "CANCELLED":
      return "border-slate-400/40 bg-slate-500/15 text-slate-600 dark:text-slate-300";
    default:
      return "border-violet-400/40 bg-violet-500/15 text-violet-700 dark:text-violet-200";
  }
}

export function partStatusBadgeClass(status: PartReceiveStatus): string {
  switch (status) {
    case "On order":
      return "border-blue-400/40 bg-blue-500/15 text-blue-700 dark:text-blue-200";
    case "Partial":
      return "border-amber-400/40 bg-amber-500/15 text-amber-800 dark:text-amber-200";
    case "In pool":
      return "border-emerald-400/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200";
    case "Received":
      return "border-slate-400/40 bg-slate-500/15 text-slate-600 dark:text-slate-300";
    default:
      return "border-slate-300/40 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300";
  }
}

export async function hydratePartFromCatalog(rawPn: string): Promise<{
  description: string | null;
  unitOfMeasurement: string | null;
  vendor: string | null;
  found: boolean;
} | null> {
  const trimmed = rawPn.trim();
  if (!trimmed) return null;
  try {
    const res = await fetch(
      `/api/parts/details?partNumber=${encodeURIComponent(trimmed)}`,
    );
    const data = await res.json().catch(() => ({}));
    if (data.found === true) {
      const desc =
        typeof data.description === "string" ? data.description.trim() : "";
      const u =
        typeof data.unitOfMeasurement === "string"
          ? data.unitOfMeasurement.trim()
          : "";
      return {
        description: desc || null,
        unitOfMeasurement: u || null,
        vendor:
          typeof data.type === "string" ? data.type.trim() || null : null,
        found: true,
      };
    }
    return null;
  } catch {
    return null;
  }
}
