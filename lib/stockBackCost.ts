import type { Prisma, PrismaClient } from '@prisma/client';
import { getPricingForParts } from '@/lib/partsDatabase';
import {
  buildSalesTaxTotals,
  roundCurrency,
  type StockBackPdfDocument,
  type StockBackPdfLine,
} from '@/lib/stockBackPdfShared';

type DbClient = PrismaClient | Prisma.TransactionClient;

export type StockBackDocumentLineInput = {
  partNumber: string;
  quantity: number;
  description?: string | null;
};

function toPositiveInt(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

const PRICE_MATCH_TOLERANCE = 0.001;

function resolveUnitCost(
  partNumber: string,
  databaseCost: number | null,
  manualCosts: number[],
): number | null {
  const overrides = manualCosts.filter((value) => Number.isFinite(value) && value >= 0);
  if (overrides.length === 0) {
    return databaseCost;
  }

  const manualCost = overrides[0];
  if (
    databaseCost !== null &&
    Math.abs(manualCost - databaseCost) <= PRICE_MATCH_TOLERANCE
  ) {
    return databaseCost;
  }

  return roundCurrency(manualCost);
}

function buildTotals(lines: StockBackPdfLine[]) {
  const subtotal = lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0);
  return buildSalesTaxTotals(subtotal);
}

export async function buildStockBackPdfDocument(
  db: DbClient,
  params: {
    jobNumber: string;
    stockReturnId: string;
    note?: string | null;
    createdAt?: Date | string;
    lines: StockBackDocumentLineInput[];
  },
): Promise<StockBackPdfDocument> {
  const normalizedJobNumber = params.jobNumber.trim();
  const partNumbers = Array.from(
    new Set(
      params.lines
        .map((line) => line.partNumber.trim())
        .filter(Boolean),
    ),
  );

  const [jobMeta, jobRows, pricingMap] = await Promise.all([
    db.job.findFirst({
      where: { jobNumber: normalizedJobNumber },
      select: { jobName: true, area: true },
      orderBy: { listNumber: 'asc' },
    }),
    partNumbers.length
      ? db.job.findMany({
          where: {
            jobNumber: normalizedJobNumber,
            partNumber: { in: partNumbers },
          },
          select: {
            partNumber: true,
            description: true,
            unitOfMeasurement: true,
            type: true,
            manualCost: true,
          },
        })
      : Promise.resolve([]),
    getPricingForParts(partNumbers, db),
  ]);

  const rowsByPartNumber = new Map<
    string,
    Array<{
      description: string | null;
      unitOfMeasurement: string | null;
      type: string | null;
      manualCost: number | null;
    }>
  >();

  for (const row of jobRows) {
    const partNumber = row.partNumber?.trim();
    if (!partNumber) continue;
    const manualCost =
      row.manualCost === null || row.manualCost === undefined
        ? null
        : Number(row.manualCost);
    const bucket = rowsByPartNumber.get(partNumber) ?? [];
    bucket.push({
      description: row.description ?? null,
      unitOfMeasurement: row.unitOfMeasurement ?? null,
      type: row.type ?? null,
      manualCost: Number.isFinite(manualCost) ? manualCost : null,
    });
    rowsByPartNumber.set(partNumber, bucket);
  }

  const pdfLines: StockBackPdfLine[] = params.lines
    .map((line) => {
      const partNumber = line.partNumber.trim();
      const quantity = toPositiveInt(line.quantity);
      if (!partNumber || quantity <= 0) return null;

      const jobLineRows = rowsByPartNumber.get(partNumber) ?? [];
      const pricing = pricingMap.get(partNumber) ?? null;
      const unitCost = resolveUnitCost(
        partNumber,
        pricing?.cost ?? null,
        jobLineRows
          .map((row) => row.manualCost)
          .filter((value): value is number => value !== null),
      );
      const description =
        line.description ??
        jobLineRows.find((row) => row.description)?.description ??
        null;
      const uom =
        jobLineRows.find((row) => row.unitOfMeasurement)?.unitOfMeasurement ??
        null;
      const supplier =
        pricing?.supplier ??
        jobLineRows.find((row) => row.type)?.type ??
        null;
      const lineTotal =
        unitCost !== null ? roundCurrency(unitCost * quantity) : null;

      return {
        partNumber,
        description,
        uom,
        quantity,
        unitCost,
        lineTotal,
        supplier,
      } satisfies StockBackPdfLine;
    })
    .filter((line): line is StockBackPdfLine => line !== null)
    .sort((a, b) =>
      a.partNumber.localeCompare(b.partNumber, undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    );

  const totals = buildTotals(pdfLines);
  const createdAt =
    params.createdAt instanceof Date
      ? params.createdAt.toISOString()
      : typeof params.createdAt === 'string'
        ? params.createdAt
        : new Date().toISOString();

  return {
    jobNumber: normalizedJobNumber,
    jobName: jobMeta?.jobName?.trim() || normalizedJobNumber,
    area: jobMeta?.area ?? null,
    stockReturnId: params.stockReturnId,
    note: params.note?.trim() || null,
    createdAt,
    lines: pdfLines,
    ...totals,
  };
}
