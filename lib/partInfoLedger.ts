import type { Prisma } from '@prisma/client';
import { normalizeVendorKey } from '@/lib/vendorUtils';

export const INFO_CONTEXT_MANUAL = 'MANUAL' as const;
export const INFO_CONTEXT_IMPORT = 'IMPORT' as const;

export type PartInfoContextType = typeof INFO_CONTEXT_MANUAL | typeof INFO_CONTEXT_IMPORT;

export type PartInfoFieldKey =
  | 'PN'
  | 'VENDOR_PART_ID'
  | 'UNITS'
  | 'NOMENCLATURE'
  | 'VENDOR'
  | 'REORDER_POINT'
  | 'ORDER_MINIMUM';

export type PartInfoDiff = {
  field: PartInfoFieldKey;
  before: string | null;
  after: string | null;
};

function trimOrNull(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

export type PartProfileSnapshot = {
  pn: string;
  nomenclature: string;
  units: string;
  vendor: string | null;
  vendorPartID: string | null;
};

export type PartThresholdSnapshot = {
  reorderPoint: number | null;
  orderMinimum: number | null;
};

function formatThresholdValue(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return String(Math.floor(n));
}

/**
 * Build a list of field-level diffs (excludes cost — use part cost ledger only).
 */
export function collectPartProfileDiffs(before: PartProfileSnapshot, after: PartProfileSnapshot): PartInfoDiff[] {
  const diffs: PartInfoDiff[] = [];

  const bPn = before.pn.trim();
  const aPn = after.pn.trim();
  if (bPn !== aPn) {
    diffs.push({ field: 'PN', before: bPn, after: aPn });
  }

  const bNom = before.nomenclature.trim();
  const aNom = after.nomenclature.trim();
  if (bNom !== aNom) {
    diffs.push({ field: 'NOMENCLATURE', before: bNom, after: aNom });
  }

  const bUnits = before.units.trim();
  const aUnits = after.units.trim();
  if (bUnits !== aUnits) {
    diffs.push({ field: 'UNITS', before: bUnits, after: aUnits });
  }

  const bVRaw = trimOrNull(before.vendor);
  const aVRaw = trimOrNull(after.vendor);
  const bVn = bVRaw ? normalizeVendorKey(bVRaw) : null;
  const aVn = aVRaw ? normalizeVendorKey(aVRaw) : null;
  if (bVn !== aVn) {
    diffs.push({ field: 'VENDOR', before: bVRaw, after: aVRaw });
  }

  const bVp = trimOrNull(before.vendorPartID);
  const aVp = trimOrNull(after.vendorPartID);
  if (bVp !== aVp) {
    diffs.push({ field: 'VENDOR_PART_ID', before: bVp, after: aVp });
  }

  return diffs;
}

export function collectPartThresholdDiffs(
  before: PartThresholdSnapshot,
  after: PartThresholdSnapshot,
): PartInfoDiff[] {
  const diffs: PartInfoDiff[] = [];
  const bMin = formatThresholdValue(before.reorderPoint);
  const aMin = formatThresholdValue(after.reorderPoint);
  if (bMin !== aMin) {
    diffs.push({ field: 'REORDER_POINT', before: bMin, after: aMin });
  }
  const bOrder = formatThresholdValue(before.orderMinimum);
  const aOrder = formatThresholdValue(after.orderMinimum);
  if (bOrder !== aOrder) {
    diffs.push({ field: 'ORDER_MINIMUM', before: bOrder, after: aOrder });
  }
  return diffs;
}

export type RecordPartInfoChangeArgs = {
  partId: string;
  actorUserId: string | null;
  contextType: PartInfoContextType;
  contextId?: string | null;
  diffs: PartInfoDiff[];
  note?: string | null;
};

/**
 * One row per save listing all profile field changes. No-op if diffs empty.
 */
export async function recordPartInfoChange(
  tx: Prisma.TransactionClient,
  args: RecordPartInfoChangeArgs,
): Promise<{ id: string } | null> {
  if (!args.diffs.length) return null;
  if (!args.partId?.trim()) {
    throw new Error('recordPartInfoChange: partId is required');
  }
  if (!args.contextType?.trim()) {
    throw new Error('recordPartInfoChange: contextType is required');
  }

  // Prisma client includes partInfoChange after `npx prisma generate` (requires DB migration).
  return (tx as any).partInfoChange.create({
    data: {
      partId: args.partId.trim(),
      actorUserId: args.actorUserId?.trim() || null,
      contextType: args.contextType.trim(),
      contextId: args.contextId?.trim() || null,
      changes: args.diffs as Prisma.InputJsonValue,
      note: args.note?.trim() || null,
    },
  });
}

/** Opening snapshot after part create (before=null for each field). */
export function openingProfileDiffs(snapshot: PartProfileSnapshot): PartInfoDiff[] {
  return [
    { field: 'PN', before: null, after: snapshot.pn.trim() },
    { field: 'NOMENCLATURE', before: null, after: snapshot.nomenclature.trim() },
    { field: 'UNITS', before: null, after: snapshot.units.trim() },
    { field: 'VENDOR', before: null, after: trimOrNull(snapshot.vendor) },
    { field: 'VENDOR_PART_ID', before: null, after: trimOrNull(snapshot.vendorPartID) },
  ];
}

export function openingThresholdDiffs(snapshot: PartThresholdSnapshot): PartInfoDiff[] {
  const minOnHand = formatThresholdValue(snapshot.reorderPoint);
  const orderMin = formatThresholdValue(snapshot.orderMinimum);
  const diffs: PartInfoDiff[] = [];
  if (minOnHand !== null) {
    diffs.push({ field: 'REORDER_POINT', before: null, after: minOnHand });
  }
  if (orderMin !== null) {
    diffs.push({ field: 'ORDER_MINIMUM', before: null, after: orderMin });
  }
  return diffs;
}
