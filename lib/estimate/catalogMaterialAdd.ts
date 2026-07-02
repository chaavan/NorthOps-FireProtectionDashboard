import { buildMaterialCatalogRowMetadata } from "@/lib/estimate/system1Template";
import type { EstimateCatalogRow, EstimateDraft, EstimateVisibleMaterialLine } from "@/lib/estimateTypes";

export type CatalogPartSearchResult = {
  rowKey: string;
  sheetRow: number;
  section: string;
  subcategory: string | null;
  partNumber: string;
  description: string | null;
  uom: string | null;
  vendor: string | null;
  cost: number | null;
  quantity: number | null;
  quantityCell: string | null;
  unitCostCell: string | null;
  isFormula: boolean;
  rowType: string;
};

function sanitizeCatalogText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("=")) return null;
  return trimmed;
}

export function catalogRowToPart(row: EstimateCatalogRow): CatalogPartSearchResult {
  const cleanLabel = sanitizeCatalogText(row.label);
  const cleanDescription = sanitizeCatalogText(row.description);
  const cleanDetail = sanitizeCatalogText(row.detail);
  const descriptionParts = [cleanDescription, cleanDetail].filter(
    (value, index, values): value is string =>
      Boolean(value) && values.findIndex((candidate) => candidate === value) === index,
  );
  return {
    rowKey: row.rowKey,
    sheetRow: row.sheetRow,
    section: row.section,
    subcategory: row.subcategory,
    partNumber: cleanLabel || cleanDescription || `Row ${row.sheetRow}`,
    description: descriptionParts.join(" - ") || cleanLabel,
    uom: null,
    vendor: row.section,
    cost: row.unitCost ?? row.defaultUnitCost,
    quantity: row.quantity,
    quantityCell: row.quantityCell,
    unitCostCell: row.unitCostCell,
    isFormula: Boolean(row.formulaKey),
    rowType: row.rowType,
  };
}

function makeLineKey(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nextRowIndex(draft: EstimateDraft) {
  return (
    draft.materials.visibleLines.reduce(
      (max, line) => Math.max(max, Number(line.rowIndex) || 0),
      0,
    ) + 1
  );
}

function createEstimateMaterialLine(params: {
  draft: EstimateDraft;
  partNumber: string | null;
  description: string | null;
  quantity: number;
  vendor: string | null;
  unitCost: number | null;
  prefix: string;
  catalogRowKey?: string | null;
  catalogQuantityCell?: string | null;
  catalogUnitCostCell?: string | null;
  isCatalogFormula?: boolean | null;
}): EstimateVisibleMaterialLine {
  const manualQty = Math.max(0, params.quantity || 0);
  return {
    lineKey: makeLineKey(params.prefix),
    autoSource: null,
    catalogRowKey: params.catalogRowKey ?? null,
    catalogQuantityCell: params.catalogQuantityCell ?? null,
    catalogUnitCostCell: params.catalogUnitCostCell ?? null,
    isCatalogFormula: params.isCatalogFormula ?? false,
    rowIndex: nextRowIndex(params.draft),
    partNumber: params.partNumber?.trim() || null,
    description: params.description?.trim() || null,
    manualQty,
    autoQty: 0,
    effectiveQuantity: manualQty,
    supplier: params.vendor?.trim() || null,
    databaseUnitPrice:
      params.catalogRowKey && typeof params.unitCost === "number" && Number.isFinite(params.unitCost)
        ? Math.max(0, params.unitCost)
        : null,
    manualUnitPrice:
      !params.catalogRowKey && typeof params.unitCost === "number" && Number.isFinite(params.unitCost)
        ? Math.max(0, params.unitCost)
        : null,
    baseUnitPrice: null,
    vendorAdjustmentPercent: null,
    adjustedUnitPrice: null,
    resolvedUnitPrice: null,
    priceSource: "missing",
    blockingReason: null,
    lineTotal: null,
  };
}

export function isCatalogRowAddable(row: EstimateCatalogRow) {
  return row.rowType !== "section_header" && Boolean(row.quantityCell);
}

export function addCatalogPartToDraft(
  draft: EstimateDraft,
  params: {
    part: CatalogPartSearchResult;
    quantity: number;
    manualUnitCost?: number | null;
  },
): EstimateDraft {
  const quantity = Math.max(0, params.quantity || 0);
  return {
    ...draft,
    materials: {
      ...draft.materials,
      workbookCatalog: {
        rows: draft.materials.workbookCatalog?.rows?.length
          ? draft.materials.workbookCatalog.rows
          : buildMaterialCatalogRowMetadata(),
        cellOverrides: {
          ...(draft.materials.workbookCatalog?.cellOverrides ?? {}),
          ...(params.part.quantityCell
            ? { [params.part.quantityCell]: quantity }
            : {}),
          ...(params.part.unitCostCell &&
          !params.part.isFormula &&
          params.manualUnitCost !== null &&
          params.manualUnitCost !== undefined
            ? { [params.part.unitCostCell]: params.manualUnitCost }
            : {}),
        },
      },
      visibleLines: [
        ...draft.materials.visibleLines,
        createEstimateMaterialLine({
          draft,
          partNumber: params.part.partNumber,
          description: params.part.description,
          quantity,
          vendor: params.part.vendor,
          unitCost: params.part.isFormula
            ? (params.part.cost ?? null)
            : (params.manualUnitCost ?? params.part.cost ?? null),
          prefix: "part",
          catalogRowKey: params.part.rowKey,
          catalogQuantityCell: params.part.quantityCell,
          catalogUnitCostCell: params.part.unitCostCell,
          isCatalogFormula: params.part.isFormula,
        }),
      ],
    },
  };
}
