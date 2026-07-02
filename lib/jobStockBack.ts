import { type Prisma, type PrismaClient } from '@prisma/client';
import { NO_PARTS_PLACEHOLDER_PART_NUMBER } from '@/lib/jobImportConstants';
import {
  JOB_STOCK_RETURN_STATUS,
  type JobStockReturnStatusValue,
} from '@/lib/jobStockReturnStatus';
import { parseStoredStockBackPdfDocument } from '@/lib/stockBackPdfShared';

type DbClient = PrismaClient | Prisma.TransactionClient;

export type JobStockBackSummaryPart = {
  partId: string | null;
  partNumber: string;
  description: string | null;
  shopQuantity: number;
  vendorQuantity: number;
  sentQuantity: number;
  alreadyReturnedQuantity: number;
  remainingReturnableQuantity: number;
  currentInventoryQuantity: number | null;
  returnable: boolean;
};

export type JobStockBackHistoryLine = {
  id: string;
  partId: string;
  partNumber: string;
  returnedQuantity: number;
  sentShopQuantity: number;
  sentVendorQuantity: number;
};

export type JobStockBackHistoryEntry = {
  id: string;
  jobNumber: string;
  note: string | null;
  status: JobStockReturnStatusValue;
  createdAt: Date;
  reversedAt: Date | null;
  reverseReason: string | null;
  deletedAt: Date | null;
  deleteReason: string | null;
  actor: { name: string | null; email: string } | null;
  reversedBy: { name: string | null; email: string } | null;
  deletedBy: { name: string | null; email: string } | null;
  lines: JobStockBackHistoryLine[];
  hasPdfDocument: boolean;
  pdfVoided: boolean;
  pdfGrandTotal: number | null;
};

export type JobStockBackSummary = {
  jobNumber: string;
  parts: JobStockBackSummaryPart[];
  history: JobStockBackHistoryEntry[];
};

function toPositiveInt(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function toInventoryNumber(value: bigint | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export async function getJobStockBackSummary(
  db: DbClient,
  jobNumber: string,
): Promise<JobStockBackSummary> {
  const normalizedJobNumber = jobNumber.trim();
  if (!normalizedJobNumber) {
    return { jobNumber: '', parts: [], history: [] };
  }

  const jobRows = await db.job.findMany({
    where: { jobNumber: normalizedJobNumber },
    select: {
      partNumber: true,
      description: true,
      pulled: true,
      quantityReceivedFromOrder: true,
    },
  });

  type SentTotals = {
    description: string | null;
    shopQuantity: number;
    vendorQuantity: number;
  };

  const sentByPartNumber = new Map<string, SentTotals>();
  for (const row of jobRows) {
    const partNumber = row.partNumber?.trim();
    if (!partNumber || partNumber === NO_PARTS_PLACEHOLDER_PART_NUMBER) continue;
    const current = sentByPartNumber.get(partNumber) ?? {
      description: row.description ?? null,
      shopQuantity: 0,
      vendorQuantity: 0,
    };
    if (!current.description && row.description) {
      current.description = row.description;
    }
    current.shopQuantity += toPositiveInt(row.pulled);
    current.vendorQuantity += toPositiveInt(row.quantityReceivedFromOrder);
    sentByPartNumber.set(partNumber, current);
  }

  const partNumbers = Array.from(sentByPartNumber.keys()).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  );

  const parts = partNumbers.length
    ? await db.part.findMany({
        where: { pn: { in: partNumbers } },
        select: {
          id: true,
          pn: true,
          nomenclature: true,
          quantity: true,
        },
      })
    : [];
  const partByNumber = new Map(parts.map((part) => [part.pn, part]));

  const returnLines = await db.jobStockReturnLine.findMany({
    where: {
      jobStockReturn: {
        jobNumber: normalizedJobNumber,
        status: JOB_STOCK_RETURN_STATUS.ACTIVE,
      },
    },
    select: {
      partNumber: true,
      returnedQuantity: true,
    },
  });

  const returnedByPartNumber = new Map<string, number>();
  for (const line of returnLines) {
    const partNumber = line.partNumber?.trim();
    if (!partNumber) continue;
    returnedByPartNumber.set(
      partNumber,
      (returnedByPartNumber.get(partNumber) ?? 0) + toPositiveInt(line.returnedQuantity),
    );
  }

  const history = await db.jobStockReturn.findMany({
    where: { jobNumber: normalizedJobNumber },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      jobNumber: true,
      note: true,
      status: true,
      pdfDocument: true,
      createdAt: true,
      reversedAt: true,
      reverseReason: true,
      deletedAt: true,
      deleteReason: true,
      actor: {
        select: {
          name: true,
          email: true,
        },
      },
      reversedBy: {
        select: {
          name: true,
          email: true,
        },
      },
      deletedBy: {
        select: {
          name: true,
          email: true,
        },
      },
      lines: {
        orderBy: { partNumber: 'asc' },
        select: {
          id: true,
          partId: true,
          partNumber: true,
          returnedQuantity: true,
          sentShopQuantity: true,
          sentVendorQuantity: true,
        },
      },
    },
  });

  const summaryParts = partNumbers.map((partNumber) => {
    const sent = sentByPartNumber.get(partNumber)!;
    const inventoryPart = partByNumber.get(partNumber) ?? null;
    const sentQuantity = sent.shopQuantity + sent.vendorQuantity;
    const alreadyReturnedQuantity = returnedByPartNumber.get(partNumber) ?? 0;
    const remainingReturnableQuantity = Math.max(
      0,
      sentQuantity - alreadyReturnedQuantity,
    );

    return {
      partId: inventoryPart?.id ?? null,
      partNumber,
      description: inventoryPart?.nomenclature ?? sent.description ?? null,
      shopQuantity: sent.shopQuantity,
      vendorQuantity: sent.vendorQuantity,
      sentQuantity,
      alreadyReturnedQuantity,
      remainingReturnableQuantity,
      currentInventoryQuantity: inventoryPart
        ? toInventoryNumber(inventoryPart.quantity)
        : null,
      returnable: Boolean(inventoryPart) && remainingReturnableQuantity > 0,
    };
  });

  return {
    jobNumber: normalizedJobNumber,
    parts: summaryParts,
    history: history.map((entry) => {
      const storedPdf = parseStoredStockBackPdfDocument(entry.pdfDocument);
      const pdfVoided =
        entry.status !== JOB_STOCK_RETURN_STATUS.ACTIVE ||
        (storedPdf?.status != null && storedPdf.status !== 'ACTIVE');
      return {
        id: entry.id,
        jobNumber: entry.jobNumber,
        note: entry.note,
        status: entry.status,
        createdAt: entry.createdAt,
        reversedAt: entry.reversedAt,
        reverseReason: entry.reverseReason,
        deletedAt: entry.deletedAt,
        deleteReason: entry.deleteReason,
        actor: entry.actor,
        reversedBy: entry.reversedBy,
        deletedBy: entry.deletedBy,
        hasPdfDocument: Boolean(storedPdf),
        pdfVoided,
        pdfGrandTotal: storedPdf?.grandTotal ?? null,
        lines: entry.lines.map((line) => ({
          id: line.id,
          partId: line.partId,
          partNumber: line.partNumber,
          returnedQuantity: line.returnedQuantity,
          sentShopQuantity: line.sentShopQuantity,
          sentVendorQuantity: line.sentVendorQuantity,
        })),
      };
    }),
  };
}
