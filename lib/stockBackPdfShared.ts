export const STOCK_BACK_SALES_TAX_RATE = 0.06;

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildSalesTaxTotals(subtotal: number) {
  const roundedSubtotal = roundCurrency(subtotal);
  const salesTaxAmount = roundCurrency(roundedSubtotal * STOCK_BACK_SALES_TAX_RATE);
  const grandTotal = roundCurrency(roundedSubtotal + salesTaxAmount);

  return {
    subtotal: roundedSubtotal,
    salesTaxRate: STOCK_BACK_SALES_TAX_RATE,
    salesTaxAmount,
    grandTotal,
  };
}

export type StockBackPdfLine = {
  partNumber: string;
  description: string | null;
  uom: string | null;
  quantity: number;
  unitCost: number | null;
  lineTotal: number | null;
  supplier: string | null;
};

export type StockBackPdfDocumentStatus = 'ACTIVE' | 'REVERSED' | 'DELETED';

export type StockBackPdfDocument = {
  jobNumber: string;
  jobName: string;
  area: string | null;
  stockReturnId: string;
  note: string | null;
  createdAt: string;
  lines: StockBackPdfLine[];
  subtotal: number;
  salesTaxRate: number;
  salesTaxAmount: number;
  grandTotal: number;
  status?: StockBackPdfDocumentStatus;
  voidedAt?: string;
  voidReason?: string | null;
};

export function getStockBackLinesMissingCosts(lines: StockBackPdfLine[]): string[] {
  return lines
    .filter((line) => line.quantity > 0 && line.unitCost === null)
    .map((line) => line.partNumber);
}

export function parseStoredStockBackPdfDocument(
  value: unknown,
): StockBackPdfDocument | null {
  if (!value || typeof value !== 'object') return null;
  const doc = value as Partial<StockBackPdfDocument>;
  if (
    typeof doc.jobNumber !== 'string' ||
    typeof doc.stockReturnId !== 'string' ||
    !Array.isArray(doc.lines)
  ) {
    return null;
  }
  return doc as StockBackPdfDocument;
}

export function voidStockBackPdfDocument(
  stored: unknown,
  params: {
    status: Exclude<StockBackPdfDocumentStatus, 'ACTIVE'>;
    voidedAt: string;
    voidReason?: string | null;
  },
): StockBackPdfDocument | Record<string, unknown> {
  const parsed = parseStoredStockBackPdfDocument(stored);
  if (parsed) {
    return {
      ...parsed,
      status: params.status,
      voidedAt: params.voidedAt,
      voidReason: params.voidReason ?? null,
    };
  }
  return {
    status: params.status,
    voidedAt: params.voidedAt,
    voidReason: params.voidReason ?? null,
  };
}

export function validateStockInUndoReason(reason: unknown): string | null {
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (trimmed.length < 10) {
    return 'Enter at least 10 characters explaining why this stock-in is being undone.';
  }
  return null;
}
