import { Prisma, type PartCostChange } from '@prisma/client';

/** Admin UI / API edits to catalog cost */
export const COST_CONTEXT_MANUAL = 'MANUAL' as const;
/** Future automated pricing feed or batch job */
export const COST_CONTEXT_AUTO = 'AUTO' as const;
/** Side effects driven from job flows (e.g. supplier mismatch reset) */
export const COST_CONTEXT_JOB = 'JOB' as const;
/** Bulk CSV / script imports */
export const COST_CONTEXT_IMPORT = 'IMPORT' as const;
/** Reserved for cron/system without user actor */
export const COST_CONTEXT_SYSTEM = 'SYSTEM' as const;

export type PartCostContextType =
  | typeof COST_CONTEXT_MANUAL
  | typeof COST_CONTEXT_AUTO
  | typeof COST_CONTEXT_JOB
  | typeof COST_CONTEXT_IMPORT
  | typeof COST_CONTEXT_SYSTEM;

export type RecordPartCostChangeArgs = {
  partId: string;
  costBefore: Prisma.Decimal | number | string | null;
  costAfter: Prisma.Decimal | number | string;
  actorUserId: string | null;
  contextType: PartCostContextType;
  contextId?: string | null;
  note?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

function toDecimal(value: Prisma.Decimal | number | string | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  return new Prisma.Decimal(value as any);
}

/** Compare at cents scale to avoid duplicate noise (10 vs 10.00). */
export function catalogCostsEqual(
  a: Prisma.Decimal | number | string | null | undefined,
  b: Prisma.Decimal | number | string | null | undefined,
): boolean {
  const da = toDecimal(a);
  const db = toDecimal(b);
  if (da === null && db === null) return true;
  if (da === null || db === null) return false;
  return da.toDecimalPlaces(2).equals(db.toDecimalPlaces(2));
}

/**
 * Append a part_cost_changes row. Caller must run inside `prisma.$transaction` next to `part.update` when mutating cost.
 * No-op (returns null) when before/after costs are equal at 2dp.
 */
export async function recordPartCostChange(
  tx: Prisma.TransactionClient,
  args: RecordPartCostChangeArgs,
): Promise<PartCostChange | null> {
  const { partId, actorUserId, contextType, contextId, note, metadata } = args;
  if (!partId?.trim()) {
    throw new Error('recordPartCostChange: partId is required');
  }
  if (!contextType?.trim()) {
    throw new Error('recordPartCostChange: contextType is required');
  }

  const beforeDec = toDecimal(args.costBefore);
  const afterDec = toDecimal(args.costAfter);
  if (afterDec === null) {
    throw new Error('recordPartCostChange: costAfter is required');
  }

  if (catalogCostsEqual(beforeDec, afterDec)) {
    return null;
  }

  return tx.partCostChange.create({
    data: {
      partId: partId.trim(),
      actorUserId: actorUserId?.trim() || null,
      costBefore: beforeDec,
      costAfter: afterDec,
      contextType: contextType.trim(),
      contextId: contextId?.trim() || null,
      note: note?.trim() || null,
      ...(metadata !== undefined && metadata !== null ? { metadata } : {}),
    },
  });
}

/**
 * Cost-only catalog update + audit row (use from jobs/scripts; admin PUT uses full `part.update` + `recordPartCostChange`).
 * Returns false if part missing or cost already equal to `newUnitCost`.
 */
export async function setCatalogUnitCost(
  tx: Prisma.TransactionClient,
  args: {
    partId: string;
    newUnitCost: Prisma.Decimal | number | string;
    actorUserId: string | null;
    contextType: PartCostContextType;
    contextId?: string | null;
    note?: string | null;
    metadata?: Prisma.InputJsonValue | null;
  },
): Promise<boolean> {
  const row = await tx.part.findUnique({ where: { id: args.partId.trim() } });
  if (!row) return false;
  if (catalogCostsEqual(row.cost, args.newUnitCost)) return false;

  const next = new Prisma.Decimal(args.newUnitCost as any);
  await tx.part.update({
    where: { id: row.id },
    data: { cost: next },
  });

  await recordPartCostChange(tx, {
    partId: row.id,
    costBefore: row.cost,
    costAfter: next,
    actorUserId: args.actorUserId,
    contextType: args.contextType,
    contextId: args.contextId,
    note: args.note,
    metadata: args.metadata,
  });
  return true;
}
