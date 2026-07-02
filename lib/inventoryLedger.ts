import { MovementType, type InventoryMovement, type Prisma } from '@prisma/client';

/** Path 1: manual corrections from Inventory UI (and guarded batch tools). */
export const MANUAL_CONTEXT_TYPE = 'MANUAL' as const;

/** Path 2: operational changes tied to jobs. */
export const JOB_CONTEXT_TYPE = 'JOB' as const;

/** Path 2: operational changes tied to purchase orders (cancel receive, delete PO history). */
export const ORDER_CONTEXT_TYPE = 'ORDER' as const;

export type OperationalContextType = typeof JOB_CONTEXT_TYPE | typeof ORDER_CONTEXT_TYPE;

export type ManualReasonCode =
  | 'COUNT'
  | 'STOCK_IN'
  | 'DAMAGE'
  | 'SUPPLIER'
  | 'CORRECTION'
  | 'OTHER';

const REASON_LABELS: Record<ManualReasonCode, string> = {
  COUNT: 'Physical count / cycle count',
  STOCK_IN: 'Stock in',
  DAMAGE: 'Damage / scrap',
  SUPPLIER: 'Supplier / receipt correction',
  CORRECTION: 'Data entry correction',
  OTHER: 'Other',
};

export const MANUAL_REASON_CODES: ManualReasonCode[] = [
  'COUNT',
  'STOCK_IN',
  'DAMAGE',
  'SUPPLIER',
  'CORRECTION',
  'OTHER',
];

export function buildManualMovementNote(params: {
  reasonCode: ManualReasonCode;
  reasonDetail: string;
  additionalNote?: string | null;
}): string {
  const label = REASON_LABELS[params.reasonCode] ?? params.reasonCode;
  const segments = [`[MANUAL:${params.reasonCode}]`, label];
  const detail = params.reasonDetail.trim();
  if (detail) segments.push(detail);
  const extra = params.additionalNote?.trim();
  if (extra) segments.push(extra);
  return segments.join(' | ');
}

export function parseManualReasonCode(value: unknown): ManualReasonCode | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toUpperCase() as ManualReasonCode;
  return MANUAL_REASON_CODES.includes(v) ? v : null;
}

/** Validates Path 1 reason fields; returns error message or null if ok. */
export function validateManualReasonInput(params: {
  reasonCode: ManualReasonCode;
  reasonDetail: string;
  additionalNote?: string | null;
}): string | null {
  const detail = params.reasonDetail.trim();
  const extra = params.additionalNote?.trim() ?? '';
  const combined = `${detail} ${extra}`.trim();
  if (combined.length < 10) {
    return 'Enter at least 10 characters combined in reason detail and optional notes.';
  }
  if (params.reasonCode === 'OTHER' && detail.length < 5) {
    return 'For “Other”, add at least 5 characters describing the reason.';
  }
  return null;
}

export type RecordOperationalDeltaArgs = {
  partId: string;
  /** Signed integer: negative = pull from stock, positive = return to stock. */
  signedDelta: number;
  movementType: typeof MovementType.PULL | typeof MovementType.UNPULL;
  contextType: OperationalContextType;
  contextId: string;
  actorUserId: string | null;
  note: string;
};

/**
 * Path 2 only: apply a pull or unpull to parts.quantity and append inventory_movements.
 * Caller must supply movementType consistent with signedDelta (PULL < 0, UNPULL > 0).
 */
export async function recordOperationalDelta(
  tx: Prisma.TransactionClient,
  args: RecordOperationalDeltaArgs,
): Promise<void> {
  const { partId, signedDelta, movementType, contextType, contextId, actorUserId, note } = args;
  if (!partId || !contextId?.trim()) {
    throw new Error('recordOperationalDelta: partId and contextId are required');
  }
  if (signedDelta === 0) {
    return;
  }
  if (signedDelta < 0 && movementType !== MovementType.PULL) {
    throw new Error('recordOperationalDelta: PULL requires negative signedDelta');
  }
  if (signedDelta > 0 && movementType !== MovementType.UNPULL) {
    throw new Error('recordOperationalDelta: UNPULL requires positive signedDelta');
  }

  const part = await tx.part.findUnique({
    where: { id: partId },
  });
  if (!part) {
    throw new Error('Part not found');
  }

  const currentQty = part.quantity ? BigInt(part.quantity.toString()) : BigInt(0);
  const delta = BigInt(signedDelta);
  const quantityAfter = currentQty + delta;

  if (quantityAfter < BigInt(0)) {
    throw new Error('NEGATIVE_STOCK');
  }

  if (delta < BigInt(0)) {
    const pullQuantity = -delta;
    if (currentQty < pullQuantity) {
      throw new Error('INSUFFICIENT_STOCK');
    }
    const updateResult = await tx.$executeRawUnsafe(
      `UPDATE parts 
         SET quantity = $1::bigint, "updatedAt" = NOW()
         WHERE id = $2 AND quantity >= $3::bigint`,
      quantityAfter.toString(),
      partId,
      pullQuantity.toString(),
    );
    if (updateResult === 0) {
      throw new Error('INSUFFICIENT_STOCK');
    }
  } else {
    await tx.$executeRawUnsafe(
      `UPDATE parts
         SET quantity = $1::bigint, "updatedAt" = NOW()
         WHERE id = $2`,
      quantityAfter.toString(),
      partId,
    );
  }

  await tx.inventoryMovement.create({
    data: {
      partId,
      actorUserId: actorUserId?.trim() || null,
      type: movementType,
      quantityDelta: signedDelta,
      quantityBefore: currentQty,
      quantityAfter,
      contextType,
      contextId: contextId.trim(),
      note,
    },
  });
}

export type RecordManualAdjustmentArgs = {
  partId: string;
  signedDelta: number;
  actorUserId: string | null;
  reasonCode: ManualReasonCode;
  reasonDetail: string;
  additionalNote?: string | null;
};

/**
 * Path 1 only: manual ADJUSTMENT with contextType MANUAL (Inventory tab).
 */
export async function recordManualAdjustment(
  tx: Prisma.TransactionClient,
  args: RecordManualAdjustmentArgs,
): Promise<{ movement: InventoryMovement }> {
  const err = validateManualReasonInput({
    reasonCode: args.reasonCode,
    reasonDetail: args.reasonDetail,
    additionalNote: args.additionalNote,
  });
  if (err) {
    throw new Error(err);
  }
  if (args.signedDelta === 0) {
    throw new Error('Adjustment delta cannot be zero');
  }

  const part = await tx.part.findUnique({ where: { id: args.partId } });
  if (!part) {
    throw new Error('Part not found');
  }

  const currentQty = part.quantity ? BigInt(part.quantity.toString()) : BigInt(0);
  const delta = BigInt(args.signedDelta);
  const quantityAfter = currentQty + delta;

  if (quantityAfter < BigInt(0)) {
    throw new Error('NEGATIVE_STOCK');
  }

  await tx.part.update({
    where: { id: args.partId },
    data: { quantity: quantityAfter, updatedAt: new Date() },
  });

  const note = buildManualMovementNote({
    reasonCode: args.reasonCode,
    reasonDetail: args.reasonDetail,
    additionalNote: args.additionalNote,
  });

  const contextId = `manual:${args.actorUserId?.trim() || "unknown"}:${Date.now()}`;

  const movement = await tx.inventoryMovement.create({
    data: {
      partId: args.partId,
      actorUserId: args.actorUserId?.trim() || null,
      type: MovementType.ADJUSTMENT,
      quantityDelta: args.signedDelta,
      quantityBefore: currentQty,
      quantityAfter,
      contextType: MANUAL_CONTEXT_TYPE,
      contextId,
      note,
    },
  });

  return { movement };
}
