import type { Prisma } from '@prisma/client';

/** Line payload for persisting a stock-in return. */
export type StockInReturnLineInput = {
  partId: string;
  partNumber: string;
  quantity: number;
  sentShopQuantity: number;
  sentVendorQuantity: number;
};

/**
 * Build Prisma create rows for job_stock_return_lines.
 * jobNumber is required on the line table (denormalized for legacy DB layouts).
 */
export function buildJobStockReturnLineCreates(
  jobNumber: string,
  stockReturnId: string,
  lines: StockInReturnLineInput[],
): Prisma.JobStockReturnLineCreateManyInput[] {
  const normalizedJobNumber = jobNumber.trim();
  return lines.map((line) => ({
    jobStockReturnId: stockReturnId,
    jobNumber: normalizedJobNumber,
    partId: line.partId,
    partNumber: line.partNumber,
    returnedQuantity: line.quantity,
    sentShopQuantity: line.sentShopQuantity,
    sentVendorQuantity: line.sentVendorQuantity,
  }));
}

/** Nested line creates for jobStockReturn.create({ lines: { create } }). */
export function buildJobStockReturnNestedLineCreates(
  jobNumber: string,
  lines: StockInReturnLineInput[],
): Prisma.JobStockReturnLineCreateWithoutJobStockReturnInput[] {
  const normalizedJobNumber = jobNumber.trim();
  return lines.map((line) => ({
    jobNumber: normalizedJobNumber,
    part: { connect: { id: line.partId } },
    partNumber: line.partNumber,
    returnedQuantity: line.quantity,
    sentShopQuantity: line.sentShopQuantity,
    sentVendorQuantity: line.sentVendorQuantity,
  }));
}
