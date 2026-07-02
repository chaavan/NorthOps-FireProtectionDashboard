import { MovementType, type Prisma } from '@prisma/client';
import { JOB_CONTEXT_TYPE, recordOperationalDelta } from '@/lib/inventoryLedger';
import {
  JOB_STOCK_RETURN_STATUS,
  type JobStockReturnStatusValue,
} from '@/lib/jobStockReturnStatus';
import { voidStockBackPdfDocument } from '@/lib/stockBackPdfShared';

export type ReverseJobStockReturnParams = {
  jobNumber: string;
  returnId: string;
  actorUserId: string;
  undoReason: string;
};

export async function reverseJobStockReturn(
  tx: Prisma.TransactionClient,
  params: ReverseJobStockReturnParams,
): Promise<{ id: string; status: JobStockReturnStatusValue }> {
  const normalizedJobNumber = params.jobNumber.trim();
  const normalizedReturnId = params.returnId.trim();
  const trimmedReason = params.undoReason.trim();

  const stockReturn = await tx.jobStockReturn.findFirst({
    where: {
      id: normalizedReturnId,
      jobNumber: normalizedJobNumber,
    },
    include: {
      lines: {
        orderBy: { partNumber: 'asc' },
      },
    },
  });

  if (!stockReturn) {
    throw Object.assign(new Error('Stock-back record not found'), { status: 404 });
  }

  if (stockReturn.status !== JOB_STOCK_RETURN_STATUS.ACTIVE) {
    throw Object.assign(
      new Error('This stock-in has already been reversed'),
      { status: 409 },
    );
  }

  const now = new Date();

  for (const line of stockReturn.lines) {
    const qty = line.returnedQuantity;
    if (qty <= 0) continue;

    const note = `Stock in reversed from job ${normalizedJobNumber} | ${trimmedReason}`;

    try {
      await recordOperationalDelta(tx, {
        partId: line.partId,
        signedDelta: -qty,
        movementType: MovementType.PULL,
        contextType: JOB_CONTEXT_TYPE,
        contextId: normalizedJobNumber,
        actorUserId: params.actorUserId,
        note,
      });
    } catch (error) {
      const message = (error as Error).message;
      if (message === 'INSUFFICIENT_STOCK' || message === 'NEGATIVE_STOCK') {
        throw Object.assign(
          new Error(
            `Cannot undo stock-in — part ${line.partNumber} on-hand is below the returned quantity (${qty})`,
          ),
          { status: 409 },
        );
      }
      throw error;
    }
  }

  const voidedPdf = voidStockBackPdfDocument(stockReturn.pdfDocument, {
    status: 'REVERSED',
    voidedAt: now.toISOString(),
    voidReason: trimmedReason,
  });

  await tx.jobStockReturn.update({
    where: { id: stockReturn.id },
    data: {
      status: JOB_STOCK_RETURN_STATUS.REVERSED,
      pdfDocument: voidedPdf as Prisma.InputJsonValue,
      reversedAt: now,
      reversedByUserId: params.actorUserId,
      reverseReason: trimmedReason,
    },
  });

  return { id: stockReturn.id, status: JOB_STOCK_RETURN_STATUS.REVERSED };
}
