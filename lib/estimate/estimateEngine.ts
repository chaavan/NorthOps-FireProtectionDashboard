import type {
  EstimateComputed,
  EstimateCatalogRow,
  EstimateDraft,
  EstimateValueMap,
  EstimateSectionAdjustment,
  EstimateSummarySection,
  EstimateVendorAdjustmentRule,
  EstimateVisibleMaterialLine,
  EstimateWorkbookSectionRow,
} from "@/lib/estimateTypes";
import {
  buildDesignWorkbookRows,
  buildFieldWorkbookRows,
  buildMaterialCatalogRowMetadata,
  buildShopWorkbookRows,
  cellAddress,
  getBaseCell,
  getProjectDefaultDisplayRows,
  parseCellAddress,
} from "@/lib/estimate/system1Template";
import {
  SYNTHETIC_PUMP_BUNDLE_ROW_KEY,
  SYSTEM1_PUMP_BUNDLE_RULE,
} from "@/lib/estimate/system1AutoChildRules";
import {
  SYSTEM1_SECTION_ADJUSTMENT_RULES,
  parseSheetRowFromCatalogKey,
} from "@/lib/estimate/system1SectionAdjustments";
import { SYSTEM1_AUTO_QUANTITY_ROWS } from "@/lib/estimate/system1AutoQuantityRows";

type PricingLookup = Map<string, { cost: number; supplier: string }>;

const FIELD_PIPE_FOOTAGE_ROWS = new Set([
  "row-15",
  "row-16",
  "row-17",
  "row-18",
  "row-19",
  "row-20",
  "row-22",
  "row-23",
  "row-24",
  "row-25",
  "row-26",
  "row-27",
  "row-28",
]);

const FIELD_PIPE_FOOTAGE_QUANTITY_CELLS = [
  "A15",
  "A16",
  "A17",
  "A18",
  "A19",
  "A20",
  "A22",
  "A23",
  "A24",
  "A25",
  "A26",
  "A27",
  "A28",
];

const FIELD_CPVC_JOINT_ROWS = new Set([
  "row-31",
  "row-32",
  "row-33",
  "row-34",
  "row-35",
  "row-36",
]);

const FIELD_SPRINKLER_ROWS = new Set([
  "row-39",
  "row-40",
  "row-41",
  "row-42",
  "row-43",
  "row-44",
  "row-45",
  "row-46",
  "row-47",
]);

const FIELD_MISC_ROWS = new Set([
  "row-49",
  "row-50",
  "row-51",
  "row-52",
  "row-53",
  "row-54",
  "row-55",
]);

function normalizePartKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/[\s\t\r\n]+/g, "").toUpperCase().trim();
  return normalized || null;
}

function normalizeVendor(value: string | null | undefined) {
  return value?.trim().toLowerCase() || "";
}

function toNonNegativeNumber(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, numberValue);
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function ceilMoney(value: number) {
  return Math.ceil(value);
}

function calculateAutomaticFees(params: {
  feeBase: number;
  totalSprinklers: number;
  sprinklerFeeRate?: number | null;
}) {
  if (params.feeBase < 1) {
    return 0;
  }

  const basePermitFee = 70;
  const tierFee =
    params.feeBase < 3000
      ? 30
      : params.feeBase < 8000
        ? 45
        : params.feeBase < 11000
          ? 60
          : 70;
  const extraFee = Math.ceil(Math.max(params.feeBase - 15000, 0) / 3000) * 17;
  const sprinklerFee =
    toNonNegativeNumber(params.totalSprinklers) * toNonNegativeNumber(params.sprinklerFeeRate);
  return roundMoney(basePermitFee + tierFee + extraFee + sprinklerFee);
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function applyCellOverrides(
  set: (address: string, value: unknown) => void,
  overrides: EstimateValueMap | undefined,
) {
  Object.entries(overrides ?? {}).forEach(([address, value]) => {
    const normalized = address.trim().toUpperCase();
    if (!normalized) return;
    set(normalized, value ?? 0);
  });
}

function createCellModel(draft: EstimateDraft) {
  const overrides = new Map<string, unknown>();
  const set = (address: string, value: unknown) => overrides.set(address.toUpperCase(), value);
  const catalogRows = draft.materials?.workbookCatalog?.rows?.length
    ? draft.materials.workbookCatalog.rows
    : buildMaterialCatalogRowMetadata();
  const selectedCatalogQuantityCells = new Set(
    (draft.materials?.visibleLines ?? [])
      .map((line) => line.catalogQuantityCell?.toUpperCase() ?? null)
      .filter((cell): cell is string => Boolean(cell)),
  );
  const catalogQuantityCells = new Set(
    catalogRows
      .map((row) => row.quantityCell?.toUpperCase() ?? null)
      .filter((cell): cell is string => Boolean(cell)),
  );

  catalogQuantityCells.forEach((cell) => set(cell, 0));

  set("A11", draft.inputs.milesToJobSite ?? 0);
  set("E8", toNonNegativeNumber(draft.inputs.salesTaxPercent) / 100);
  set("E9", toNonNegativeNumber(draft.inputs.materialInflationPercent) / 100);
  set("A99", toNonNegativeNumber(draft.inputs.overheadPercent) / 100);
  set("A101", toNonNegativeNumber(draft.inputs.profitPercent) / 100);
  set("A117", toNonNegativeNumber(draft.inputs.subsMarkupPercent) / 100);
  set("A119", 0);
  set("A121", draft.inputs.peStamp ?? 0);
  set("A122", draft.inputs.bondCost ?? 0);
  set("A128", draft.project.squareFootage ?? 0);

  Object.entries(draft.rates?.adjustedRates ?? {}).forEach(([address, value]) => set(address, value));
  const FORMULA_BACKED_FIELD_INPUTS = new Set(["A67", "A68", "A69", "A70", "A71", "E71"]);
  Object.entries(draft.field?.manualHours ?? {}).forEach(([address, value]) => {
    const upper = address.toUpperCase();
    if (FORMULA_BACKED_FIELD_INPUTS.has(upper) && (value == null || value === "")) return;
    set(address, value);
  });
  Object.entries(draft.field?.costs ?? {}).forEach(([address, value]) => set(address, value));
  const FORMULA_BACKED_SHOP_INPUTS = new Set(["A75", "A77", "A78", "A80", "A81", "A82", "A83", "E80"]);
  Object.entries(draft.shop?.inputs ?? {}).forEach(([address, value]) => {
    const upper = address.toUpperCase();
    if (FORMULA_BACKED_SHOP_INPUTS.has(upper) && (value == null || value === "")) return;
    set(address, value);
  });
  const FORMULA_BACKED_DESIGN_INPUTS = new Set([
    "A86",
    "A87",
    "A88",
    "A90",
    "A93",
    "A94",
    "A95",
    "A96",
    "E94",
  ]);
  Object.entries(draft.design?.inputs ?? {}).forEach(([address, value]) => {
    const upper = address.toUpperCase();
    if (FORMULA_BACKED_DESIGN_INPUTS.has(upper) && (value == null || value === "")) return;
    if (upper === "E87" && value !== null && value !== "") {
      const numeric = toNumber(value);
      set(address, numeric > 1 ? numeric / 100 : numeric);
      return;
    }
    set(address, value);
  });
  Object.entries(draft.subsAndFees?.miscellaneousCosts ?? {}).forEach(([address, value]) => set(address, value));
  const sectionAdjustmentPercentCells = new Set(
    SYSTEM1_SECTION_ADJUSTMENT_RULES.map((rule) => rule.percentCell.toUpperCase()),
  );
  Object.entries(draft.materials?.workbookCatalog?.cellOverrides ?? {}).forEach(([address, value]) => {
    const normalizedAddress = address.toUpperCase();
    if (sectionAdjustmentPercentCells.has(normalizedAddress)) {
      set(normalizedAddress, value);
      return;
    }
    if (catalogQuantityCells.has(normalizedAddress) && !selectedCatalogQuantityCells.has(normalizedAddress)) {
      return;
    }
    set(normalizedAddress, value);
  });

  // Drive A-cell quantities directly from the flat manual lines so that the
  // workbook formula reader sees the authoritative manualQty values (rather
  // than relying on stale cellOverrides entries).
  (draft.materials?.visibleLines ?? []).forEach((line) => {
    if (line.catalogQuantityCell) {
      const qty = toNonNegativeNumber(line.manualQty);
      set(line.catalogQuantityCell, qty);
    }
    if (
      line.catalogRowKey === SYNTHETIC_PUMP_BUNDLE_ROW_KEY &&
      typeof line.pumpSize === "number" &&
      line.pumpSize > 0
    ) {
      set("A965", line.pumpSize);
    }
  });

  FIELD_PIPE_FOOTAGE_QUANTITY_CELLS.forEach((cell) => set(cell, 0));
  return overrides;
}

function expandRange(start: string, end: string) {
  const a = parseCellAddress(start);
  const b = parseCellAddress(end);
  const values: string[] = [];
  for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row += 1) {
    for (let column = Math.min(a.column, b.column); column <= Math.max(a.column, b.column); column += 1) {
      values.push(cellAddress(row, column));
    }
  }
  return values;
}

function createFormulaReader(overrides: Map<string, unknown>) {
  const cache = new Map<string, unknown>();
  const evaluating = new Set<string>();

  const read = (address: string): unknown => {
    const key = address.replace(/\$/g, "").toUpperCase();
    if (cache.has(key)) return cache.get(key);
    if (overrides.has(key)) return overrides.get(key);
    if (evaluating.has(key)) return 0;
    const base = getBaseCell(key);
    if (typeof base === "string" && base.trim().startsWith("=")) {
      evaluating.add(key);
      const evaluated = evaluateFormula(base, read);
      evaluating.delete(key);
      cache.set(key, evaluated);
      return evaluated;
    }
    return base;
  };

  return read;
}

function evaluateFormula(formula: string, read: (address: string) => unknown): unknown {
  const expression = formula.replace(/^=/, "").replace(/\$/g, "");
  const range = (start: string, end: string) => expandRange(start, end).map((address) => read(address));
  const sum = (...values: unknown[]): number =>
    values.flat(Infinity).reduce<number>((total, value) => total + toNumber(value), 0);
  const roundup = (value: unknown, digits = 0) => {
    const factor = 10 ** toNumber(digits);
    return Math.ceil(toNumber(value) * factor) / factor;
  };
  const iff = (condition: unknown, yes: unknown, no: unknown) => (condition ? yes : no);
  const cell = (address: string) => read(address);

  try {
    const js = expression
      .replace(/<>/g, "!=")
      .replace(/(?<![<>!=])=(?!=)/g, "==")
      .replace(/([A-Z]{1,3}\d+):([A-Z]{1,3}\d+)/g, 'range("$1","$2")')
      .replace(/\b(SUM|ROUNDUP|IF)\s*\(/gi, (match, fn) => `${fn.toLowerCase() === "if" ? "iff" : fn.toLowerCase()}(`)
      .replace(/(?<!")\b([A-Z]{1,3}\d+)\b(?!")/g, 'cell("$1")');
    return Function("cell", "range", "sum", "roundup", "iff", `"use strict"; return (${js});`)(
      cell,
      range,
      sum,
      roundup,
      iff,
    );
  } catch {
    return 0;
  }
}

function sanitizeVendorAdjustments(
  rules: EstimateVendorAdjustmentRule[] | undefined,
): EstimateVendorAdjustmentRule[] {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((rule) => ({
      id: rule.id || `${rule.vendor}-${rule.percent}`,
      vendor: rule.vendor?.trim() || "",
      percent: Number(rule.percent),
    }))
    .filter((rule) => rule.vendor && Number.isFinite(rule.percent));
}

function findVendorAdjustment(
  supplier: string | null,
  rules: EstimateVendorAdjustmentRule[],
) {
  const supplierKey = normalizeVendor(supplier);
  if (!supplierKey) return null;
  return rules.find((rule) => normalizeVendor(rule.vendor) === supplierKey) ?? null;
}

function resolvePricing(params: {
  line: EstimateVisibleMaterialLine;
  pricingLookup: PricingLookup;
  vendorAdjustments: EstimateVendorAdjustmentRule[];
}) {
  const normalizedPart = normalizePartKey(params.line.partNumber);
  const pricing =
    (normalizedPart ? params.pricingLookup.get(normalizedPart) : undefined) ??
    (params.line.partNumber ? params.pricingLookup.get(params.line.partNumber) : undefined);
  const manualUnitPrice =
    typeof params.line.manualUnitPrice === "number" &&
    Number.isFinite(params.line.manualUnitPrice)
      ? Math.max(0, params.line.manualUnitPrice)
      : null;
  const databaseUnitPrice =
    pricing && Number.isFinite(pricing.cost) ? Math.max(0, pricing.cost) : null;
  const supplier = pricing?.supplier ?? params.line.supplier ?? null;
  const adjustment = manualUnitPrice === null ? findVendorAdjustment(supplier, params.vendorAdjustments) : null;
  const adjustmentPercent = adjustment?.percent ?? null;
  const baseUnitPrice = manualUnitPrice ?? databaseUnitPrice;
  const adjustedUnitPrice =
    baseUnitPrice === null
      ? null
      : manualUnitPrice !== null
        ? baseUnitPrice
        : roundMoney(baseUnitPrice * (1 + (adjustmentPercent ?? 0) / 100));

  return {
    supplier,
    databaseUnitPrice,
    manualUnitPrice,
    baseUnitPrice,
    vendorAdjustmentPercent: adjustmentPercent,
    adjustedUnitPrice,
    resolvedUnitPrice: adjustedUnitPrice,
    priceSource:
      manualUnitPrice !== null
        ? ("manual" as const)
        : databaseUnitPrice !== null
          ? ("database" as const)
          : ("missing" as const),
  };
}

function buildLineFromCatalogRow(params: {
  catalogRow: EstimateCatalogRow;
  manualQty: number;
  autoQty: number;
  manualUnitPrice: number | null;
  supplierOverride: string | null;
  pumpSize: EstimateVisibleMaterialLine["pumpSize"];
  lineKey: string;
  rowIndex: number;
  autoOnly: boolean;
  readCell: (address: string) => unknown;
}): EstimateVisibleMaterialLine {
  const { catalogRow, manualQty, autoQty, manualUnitPrice, supplierOverride, pumpSize, lineKey, rowIndex, autoOnly, readCell } = params;
  const isSyntheticBundle = catalogRow.rowKey === SYNTHETIC_PUMP_BUNDLE_ROW_KEY;
  const catalogBasePriceRaw = catalogRow.unitCostCell ? toNumber(readCell(catalogRow.unitCostCell)) : null;
  const databaseUnitPrice =
    typeof catalogBasePriceRaw === "number" && Number.isFinite(catalogBasePriceRaw)
      ? Math.max(0, catalogBasePriceRaw)
      : null;
  const resolvedUnitPrice =
    manualUnitPrice !== null ? manualUnitPrice : databaseUnitPrice;
  // Manual qty can be negative — lets the user zero out auto contributions
  // they don't need. Total qty stays as the raw sum (so the display is
  // honest) but line total clamps at 0 so the subtotal never goes negative.
  const totalQty = toNumber(manualQty) + toNonNegativeNumber(autoQty);
  const billableQty = Math.max(0, totalQty);
  const lineTotal = isSyntheticBundle
    ? null
    : resolvedUnitPrice !== null
      ? ceilMoney(billableQty * resolvedUnitPrice)
      : null;
  const partNumber =
    catalogRow.label?.trim() || catalogRow.description?.trim() || `Row ${catalogRow.sheetRow}`;
  const description =
    [catalogRow.description, catalogRow.detail]
      .filter((value): value is string => Boolean(value && value.trim()))
      .join(" - ") || catalogRow.label;
  const priceSource: EstimateVisibleMaterialLine["priceSource"] = isSyntheticBundle
    ? "database"
    : manualUnitPrice !== null
      ? "manual"
      : databaseUnitPrice !== null
        ? "database"
        : "missing";
  return {
    lineKey,
    autoSource: autoOnly ? "rule" : null,
    pumpSize: pumpSize ?? null,
    catalogRowKey: catalogRow.rowKey,
    catalogQuantityCell: catalogRow.quantityCell,
    catalogUnitCostCell: catalogRow.unitCostCell,
    isCatalogFormula: Boolean(catalogRow.formulaKey),
    rowIndex,
    partNumber,
    description,
    manualQty: toNumber(manualQty),
    autoQty: toNonNegativeNumber(autoQty),
    effectiveQuantity: totalQty,
    supplier: supplierOverride ?? (catalogRow.section || "System 1"),
    databaseUnitPrice,
    manualUnitPrice,
    baseUnitPrice: resolvedUnitPrice,
    vendorAdjustmentPercent: null,
    adjustedUnitPrice: resolvedUnitPrice,
    resolvedUnitPrice,
    priceSource,
    blockingReason:
      !isSyntheticBundle && priceSource === "missing"
        ? `Part ${partNumber} needs a database or manual price.`
        : null,
    lineTotal,
  };
}

function buildCustomLine(params: {
  raw: EstimateVisibleMaterialLine;
  autoQty: number;
  rowIndex: number;
  pricingLookup: PricingLookup;
  vendorAdjustments: EstimateVendorAdjustmentRule[];
}): EstimateVisibleMaterialLine {
  const { raw, autoQty, rowIndex, pricingLookup, vendorAdjustments } = params;
  const pricing = resolvePricing({ line: raw, pricingLookup, vendorAdjustments });
  const manualQty = toNumber(raw.manualQty);
  const totalQty = manualQty + toNonNegativeNumber(autoQty);
  const billableQty = Math.max(0, totalQty);
  const lineTotal =
    pricing.resolvedUnitPrice !== null
      ? ceilMoney(billableQty * pricing.resolvedUnitPrice)
      : null;
  return {
    ...raw,
    autoSource: null,
    rowIndex,
    manualQty,
    autoQty: toNonNegativeNumber(autoQty),
    effectiveQuantity: totalQty,
    supplier: pricing.supplier,
    databaseUnitPrice: pricing.databaseUnitPrice,
    manualUnitPrice: pricing.manualUnitPrice,
    baseUnitPrice: pricing.baseUnitPrice,
    vendorAdjustmentPercent: pricing.vendorAdjustmentPercent,
    adjustedUnitPrice: pricing.adjustedUnitPrice,
    resolvedUnitPrice: pricing.resolvedUnitPrice,
    priceSource: pricing.priceSource,
    blockingReason:
      pricing.priceSource === "missing"
        ? `Part ${raw.partNumber || raw.description || "Unknown"} needs a database or manual price.`
        : null,
    lineTotal,
  };
}

/**
 * Returns auto-derived quantities (Map of catalog rowKey -> qty) for every
 * auto-quantity row whose workbook formula evaluates positive given the
 * current manual qty inputs, PLUS fixed Pump Bundle contributions for any
 * size selected on the synthetic Pump Bundle line.
 *
 * When the same row is covered by both passes, the LARGER contribution wins
 * (max) so we never double-count (e.g. rows 966/968/969 evaluate to 1 via
 * the IF(A965>0,1,0) formula AND appear in the bundle's commonChildren list).
 */
function computeAutoQuantityContributions(
  draft: EstimateDraft,
  cellOverrides: Map<string, unknown>,
): Map<string, number> {
  const out = new Map<string, number>();
  const add = (rowKey: string, qty: number) => {
    if (!Number.isFinite(qty) || qty <= 0) return;
    const existing = out.get(rowKey) ?? 0;
    out.set(rowKey, Math.max(existing, qty));
  };

  // Strip every auto-quantity row's own qty cell AND its manual-input cell
  // from the overrides so the workbook formula evaluates from the TRIGGER
  // cells alone. Some auto rows store the formula in A_M and the user's
  // manual addend in B_M (e.g. row 436: A436 = B436 + C436); we have to zero
  // both, otherwise the manual portion leaks into autoQty.
  const catalogRows = draft.materials?.workbookCatalog?.rows?.length
    ? draft.materials.workbookCatalog.rows
    : buildMaterialCatalogRowMetadata();
  const manualCellByRowKey = new Map(
    catalogRows
      .filter((row) => row.quantityCell)
      .map((row) => [row.rowKey, row.quantityCell!.toUpperCase()] as const),
  );
  const autoCellOverrides = new Map(cellOverrides);
  SYSTEM1_AUTO_QUANTITY_ROWS.forEach((autoRow) => {
    autoCellOverrides.delete(autoRow.quantityCell);
    const manualCell = manualCellByRowKey.get(autoRow.childRowKey);
    if (manualCell && manualCell !== autoRow.quantityCell) {
      autoCellOverrides.delete(manualCell);
    }
  });
  const autoReadCell = createFormulaReader(autoCellOverrides);

  SYSTEM1_AUTO_QUANTITY_ROWS.forEach((autoRow) => {
    const qty = toNumber(autoReadCell(autoRow.quantityCell));
    add(autoRow.childRowKey, qty);
  });

  const pumpBundleLine = (draft.materials?.visibleLines ?? []).find(
    (line) =>
      line.catalogRowKey === SYNTHETIC_PUMP_BUNDLE_ROW_KEY &&
      typeof line.pumpSize === "number" &&
      line.pumpSize > 0,
  );
  if (pumpBundleLine && pumpBundleLine.pumpSize) {
    SYSTEM1_PUMP_BUNDLE_RULE.commonChildren.forEach((entry) =>
      add(entry.childRowKey, entry.quantity),
    );
    const sizeList = SYSTEM1_PUMP_BUNDLE_RULE.sizeChildren[pumpBundleLine.pumpSize];
    if (sizeList) sizeList.forEach((entry) => add(entry.childRowKey, entry.quantity));
  }

  return out;
}

function resolveMaterialLines(
  draft: EstimateDraft,
  pricingLookup: PricingLookup,
  vendorAdjustments: EstimateVendorAdjustmentRule[],
) {
  // Normalize legacy draft state: old drafts may have stored child rows and
  // auto-only rows (with `lineKind`/`parentLineKey`/`sourceQuantity` fields).
  // Drop everything that should regenerate and coalesce qty into `manualQty`.
  const legacyRawLines = Array.isArray(draft.materials?.visibleLines)
    ? draft.materials.visibleLines
    : [];
  const normalizedDraft: EstimateDraft = {
    ...draft,
    materials: {
      ...draft.materials,
      visibleLines: legacyRawLines
        .filter((line) => {
          const legacy = line as EstimateVisibleMaterialLine & {
            lineKind?: string;
          };
          if (line.autoSource === "rule") return false;
          if (legacy.lineKind === "child") return false;
          return true;
        })
        .map((line) => {
          const legacy = line as EstimateVisibleMaterialLine & {
            sourceQuantity?: number;
            quantityOverride?: number | null;
          };
          const manualQty =
            typeof line.manualQty === "number" && Number.isFinite(line.manualQty)
              ? line.manualQty
              : typeof legacy.quantityOverride === "number" && Number.isFinite(legacy.quantityOverride)
                ? legacy.quantityOverride
                : typeof legacy.sourceQuantity === "number" && Number.isFinite(legacy.sourceQuantity)
                  ? legacy.sourceQuantity
                  : 0;
          return {
            ...line,
            manualQty,
            autoQty: 0,
            autoSource: null,
            effectiveQuantity: manualQty,
          };
        }),
    },
  };
  const cellOverrides = createCellModel(normalizedDraft);
  const readCell = createFormulaReader(cellOverrides);
  const rawLines = normalizedDraft.materials.visibleLines;
  const catalogRows = draft.materials?.workbookCatalog?.rows?.length
    ? draft.materials.workbookCatalog.rows
    : buildMaterialCatalogRowMetadata();
  const catalogRowsByKey = new Map(catalogRows.map((row) => [row.rowKey, row]));

  const autoQtyByRowKey = computeAutoQuantityContributions(normalizedDraft, cellOverrides);
  const manualRowKeys = new Set<string>();

  const out: EstimateVisibleMaterialLine[] = [];

  // 1. Manual lines (in user order), augmented with autoQty.
  rawLines.forEach((line, index) => {
    const rowIndex = Number(line.rowIndex) || index + 1;
    if (line.catalogRowKey) {
      manualRowKeys.add(line.catalogRowKey);
      const catalogRow = catalogRowsByKey.get(line.catalogRowKey);
      if (!catalogRow) return;
      const autoQty = autoQtyByRowKey.get(line.catalogRowKey) ?? 0;
      const manualUnitPrice =
        typeof line.manualUnitPrice === "number" && Number.isFinite(line.manualUnitPrice)
          ? Math.max(0, line.manualUnitPrice)
          : null;
      out.push(
        buildLineFromCatalogRow({
          catalogRow,
          manualQty: line.manualQty,
          autoQty,
          manualUnitPrice,
          supplierOverride: line.supplier ?? null,
          pumpSize: line.pumpSize ?? null,
          lineKey: line.lineKey,
          rowIndex,
          autoOnly: false,
          readCell,
        }),
      );
    } else {
      // Custom (non-catalog) line.
      out.push(
        buildCustomLine({
          raw: { ...line, rowIndex },
          autoQty: 0,
          rowIndex,
          pricingLookup,
          vendorAdjustments,
        }),
      );
    }
  });

  // 2. Auto-only lines: rows with auto qty > 0 that aren't already manual.
  const autoOnlyEntries = Array.from(autoQtyByRowKey.entries())
    .filter(([rowKey]) => !manualRowKeys.has(rowKey))
    .sort(([, a], [, b]) => 0); // preserve insertion order
  let autoCursor = rawLines.length;
  autoOnlyEntries.forEach(([rowKey, autoQty]) => {
    const catalogRow = catalogRowsByKey.get(rowKey);
    if (!catalogRow) return;
    autoCursor += 1;
    out.push(
      buildLineFromCatalogRow({
        catalogRow,
        manualQty: 0,
        autoQty,
        manualUnitPrice: null,
        supplierOverride: null,
        pumpSize: null,
        lineKey: `auto-${rowKey}`,
        rowIndex: autoCursor,
        autoOnly: true,
        readCell,
      }),
    );
  });

  return out;
}

function computeSectionAdjustments(params: {
  visibleMaterialLines: EstimateVisibleMaterialLine[];
  draft: EstimateDraft;
}): EstimateSectionAdjustment[] {
  const readCell = createFormulaReader(createCellModel(params.draft));
  return SYSTEM1_SECTION_ADJUSTMENT_RULES.map((rule) => {
    const triggering = params.visibleMaterialLines.filter((line) => {
      const sheetRow = parseSheetRowFromCatalogKey(line.catalogRowKey);
      return (
        sheetRow !== null &&
        sheetRow >= rule.rangeStartSheetRow &&
        sheetRow <= rule.rangeEndSheetRow
      );
    });
    if (triggering.length === 0) return null;
    const sectionSubtotal = roundMoney(
      triggering.reduce((total, line) => total + (line.lineTotal ?? 0), 0),
    );
    const percentRaw = toNumber(readCell(rule.percentCell));
    const percent =
      percentRaw > 1 ? percentRaw / 100 : percentRaw < 0 ? 0 : percentRaw;
    const amount = ceilMoney(sectionSubtotal * percent);
    return {
      adjustmentRowKey: rule.adjustmentRowKey,
      label: rule.label,
      percentCell: rule.percentCell,
      percent,
      sectionSubtotal,
      amount,
    };
  }).filter((entry): entry is EstimateSectionAdjustment => entry !== null);
}

function buildSummary(
  draft: EstimateDraft,
  params: {
    materialLinesSubtotal: number;
    sectionAdjustmentsTotal: number;
    materialSubtotal: number;
  },
): EstimateSummarySection {
  const materialSubtotal = params.materialSubtotal;
  const materialLinesSubtotal = params.materialLinesSubtotal;
  const sectionAdjustmentsTotal = params.sectionAdjustmentsTotal;
  const cellOverrides = createCellModel(draft);
  const readCell = createFormulaReader(cellOverrides);
  const salesTaxCost = ceilMoney(materialSubtotal * (toNonNegativeNumber(draft.inputs.salesTaxPercent) / 100));
  const materialInflationCost = ceilMoney(
    (materialSubtotal + salesTaxCost) * (toNonNegativeNumber(draft.inputs.materialInflationPercent) / 100),
  );
  const totalMaterialCost = roundMoney(materialSubtotal + salesTaxCost + materialInflationCost);

  const totalFieldHours = toNumber(readCell("A72"));
  const totalShopHours = toNumber(readCell("A79"));
  const totalDesignHours = toNumber(readCell("A97"));
  const totalFieldCost = ["F66", "F67", "F68", "F69", "F70", "F71"].reduce(
    (total, address) => total + toNumber(readCell(address)),
    0,
  );
  const totalShopCost = ["F75", "F76", "F77", "F78", "F80", "F81", "F82", "F83"].reduce(
    (total, address) => total + toNumber(readCell(address)),
    0,
  );
  const totalDesignCost = ["F88", "F89", "F90", "F91", "F92", "F93", "F94", "F95", "F96"].reduce(
    (total, address) => total + toNumber(readCell(address)),
    0,
  );
  const subsSubtotal = Object.values(draft.subsAndFees?.miscellaneousCosts ?? {}).reduce<number>(
    (total, value) => total + toNumber(value),
    0,
  );
  const subsMarkupCost = ceilMoney(subsSubtotal * (toNonNegativeNumber(draft.inputs.subsMarkupPercent) / 100));
  const subsTotal = roundMoney(subsSubtotal + subsMarkupCost);
  const peStamp = toNonNegativeNumber(draft.inputs.peStamp);
  const bondCost = toNonNegativeNumber(draft.inputs.bondCost);
  const subtotal = roundMoney(totalMaterialCost + totalFieldCost + totalShopCost + totalDesignCost + subsTotal);
  const overheadCost = ceilMoney(subtotal * (toNonNegativeNumber(draft.inputs.overheadPercent) / 100));
  const subtotalWithOverhead = roundMoney(subtotal + overheadCost);
  const profitCost = ceilMoney(subtotalWithOverhead * (toNonNegativeNumber(draft.inputs.profitPercent) / 100));
  const subtotalWithProfit = roundMoney(subtotalWithOverhead + profitCost);
  const totalSprinklers = toNumber(readCell("A298"));
  const fees = calculateAutomaticFees({
    feeBase: roundMoney(subtotalWithProfit + peStamp + bondCost),
    totalSprinklers,
  });
  const feesTotal = roundMoney(fees + peStamp + bondCost);
  const totalCost = roundMoney(subtotalWithProfit + feesTotal);
  const grandTotalLaborHours = roundMoney(totalFieldHours + totalShopHours + totalDesignHours);

  return {
    materialSubtotal,
    materialLinesSubtotal,
    sectionAdjustmentsTotal,
    salesTaxCost,
    materialInflationCost,
    totalMaterialCost,
    totalFieldHours,
    totalFieldCost,
    totalShopHours,
    totalShopCost,
    totalDesignHours,
    totalDesignCost,
    subtotal,
    overheadCost,
    subtotalWithOverhead,
    profitCost,
    subtotalWithProfit,
    subsSubtotal,
    subsMarkupCost,
    subsTotal,
    fees,
    feesTotal,
    peStamp,
    bondCost,
    totalCost,
    grandTotalLaborHours,
    totalSprinklers,
    materialCostPerHead: totalSprinklers > 0 ? roundMoney(totalMaterialCost / totalSprinklers) : null,
    totalCostPerHead: totalSprinklers > 0 ? roundMoney(totalCost / totalSprinklers) : null,
    hoursPerHead: totalSprinklers > 0 ? roundMoney(grandTotalLaborHours / totalSprinklers) : null,
    totalCostPerSquareFoot:
      draft.project.squareFootage && draft.project.squareFootage > 0
        ? roundMoney(totalCost / draft.project.squareFootage)
        : null,
    travelZone: toNumber(readCell("A12")) || null,
  };
}

function buildSummaryRows(summary: EstimateSummarySection) {
  return [
    { label: "Material Lines", amount: summary.materialLinesSubtotal, cell: "" },
    { label: "Section Adjustments", amount: summary.sectionAdjustmentsTotal, cell: "" },
    { label: "Material Subtotal", amount: summary.materialSubtotal, cell: "" },
    { label: "Sales Tax", amount: summary.salesTaxCost, cell: "" },
    { label: "Material Inflation", amount: summary.materialInflationCost, cell: "" },
    { label: "Total Material", amount: summary.totalMaterialCost, cell: "" },
    { label: "Field Cost", amount: summary.totalFieldCost, cell: "" },
    { label: "Shop Cost", amount: summary.totalShopCost, cell: "" },
    { label: "Design Cost", amount: summary.totalDesignCost, cell: "" },
    { label: "Subs & Misc", amount: summary.subsTotal, cell: "" },
    { label: "Subtotal", amount: summary.subtotal, cell: "" },
    { label: "Overhead", amount: summary.overheadCost, cell: "" },
    { label: "Profit", amount: summary.profitCost, cell: "" },
    { label: "Fees / PE / Bond", amount: summary.feesTotal, cell: "" },
    { label: "Total Cost", amount: summary.totalCost, cell: "" },
  ];
}

function hydrateWorkbookRows(
  rows: EstimateWorkbookSectionRow[],
  draft: EstimateDraft,
): EstimateWorkbookSectionRow[] {
  const readCell = createFormulaReader(createCellModel(draft));
  return rows.map((row) => {
    const quantity = row.quantityCell ? toNumber(readCell(row.quantityCell)) : null;
    const rate = row.rateCell ? toNumber(readCell(row.rateCell)) : null;
    const unitRate = row.unitRateCell ? toNumber(readCell(row.unitRateCell)) : null;
    const minutes = row.minutesCell ? toNumber(readCell(row.minutesCell)) : null;
    const hours = row.hoursCell ? toNumber(readCell(row.hoursCell)) : null;
    const days = row.daysCell ? toNumber(readCell(row.daysCell)) : null;

    if (FIELD_PIPE_FOOTAGE_ROWS.has(row.rowKey)) {
      const feetPerHour =
        unitRate && unitRate > 0
          ? unitRate
          : rate && rate > 0
            ? rate / 16
            : 0;
      const calculatedHours =
        quantity && quantity > 0 && feetPerHour > 0
          ? Math.ceil(quantity / feetPerHour)
          : 0;
      const calculatedDays =
        calculatedHours > 0 ? Math.ceil(calculatedHours / 16) : 0;

      return {
        ...row,
        quantity,
        rate,
        unitRate: feetPerHour,
        minutes,
        hours: calculatedHours,
        days: calculatedDays,
        cost: row.costCell ? toNumber(readCell(row.costCell)) : null,
      };
    }

    if (FIELD_CPVC_JOINT_ROWS.has(row.rowKey)) {
      const minutesPerJoint = rate && rate > 0 ? rate : 0;
      const calculatedHours =
        quantity && quantity > 0 && minutesPerJoint > 0
          ? Math.ceil((minutesPerJoint * quantity) / 60)
          : 0;
      const calculatedDays =
        calculatedHours > 0 ? Math.ceil(calculatedHours / 16) : 0;

      return {
        ...row,
        quantity,
        rate: minutesPerJoint,
        unitRate,
        minutes,
        hours: calculatedHours,
        days: calculatedDays,
        cost: row.costCell ? toNumber(readCell(row.costCell)) : null,
      };
    }

    if (FIELD_SPRINKLER_ROWS.has(row.rowKey)) {
      const sprinklersPer16Hours = rate && rate > 0 ? rate : 0;
      const calculatedRate = sprinklersPer16Hours > 0 ? 16 / sprinklersPer16Hours : 0;
      const calculatedMinutes = calculatedRate * 60;
      const calculatedHours =
        quantity && quantity > 0 && calculatedRate > 0
          ? Math.ceil(quantity * calculatedRate)
          : 0;
      const calculatedDays =
        calculatedHours > 0 ? Math.ceil(calculatedHours / 16) : 0;

      return {
        ...row,
        quantity,
        rate: sprinklersPer16Hours,
        unitRate: calculatedRate,
        minutes: calculatedMinutes,
        hours: calculatedHours,
        days: calculatedDays,
        cost: row.costCell ? toNumber(readCell(row.costCell)) : null,
      };
    }

    if (FIELD_MISC_ROWS.has(row.rowKey)) {
      const rowNumber = Number.parseInt(row.rowKey.replace("row-", ""), 10);
      if (rowNumber === 55) {
        const hoursPerPump = rate && rate > 0 ? rate : 0;
        const calculatedHours =
          quantity && quantity > 0 && hoursPerPump > 0
            ? Math.ceil(quantity * hoursPerPump)
            : 0;
        const calculatedDays =
          calculatedHours > 0 ? Math.ceil(calculatedHours / 16) : 0;

        return {
          ...row,
          quantity,
          rate: hoursPerPump,
          unitRate: hoursPerPump,
          minutes: null,
          hours: calculatedHours,
          days: calculatedDays,
          cost: row.costCell ? toNumber(readCell(row.costCell)) : null,
        };
      }

      const minutesPerUnit = rate && rate > 0 ? rate : 0;
      const calculatedUnitRate = minutesPerUnit > 0 ? minutesPerUnit / 60 : 0;
      const calculatedHours =
        quantity && quantity > 0 && minutesPerUnit > 0
          ? Math.ceil((minutesPerUnit * quantity) / 60)
          : 0;
      const calculatedDays =
        calculatedHours > 0 ? Math.ceil(calculatedHours / 16) : 0;

      return {
        ...row,
        quantity,
        rate: minutesPerUnit,
        unitRate: calculatedUnitRate,
        minutes: minutesPerUnit,
        hours: calculatedHours,
        days: calculatedDays,
        cost: row.costCell ? toNumber(readCell(row.costCell)) : null,
      };
    }

    return {
      ...row,
      quantity,
      rate,
      unitRate,
      minutes,
      hours,
      days,
      cost: row.costCell ? toNumber(readCell(row.costCell)) : null,
    };
  });
}

function hydrateCatalogRows(draft: EstimateDraft, visibleMaterialLines: EstimateVisibleMaterialLine[]): EstimateCatalogRow[] {
  const baseRows = draft.materials?.workbookCatalog?.rows?.length
    ? draft.materials.workbookCatalog.rows
    : buildMaterialCatalogRowMetadata();
  const readCell = createFormulaReader(createCellModel(draft));
  const selectedByRowKey = new Map(
    visibleMaterialLines
      .filter((line) => line.catalogRowKey)
      .map((line) => [line.catalogRowKey!, line]),
  );
  return baseRows.map((row) => {
    const selected = selectedByRowKey.get(row.rowKey);
    const catalogUnitCost = row.unitCostCell ? toNumber(readCell(row.unitCostCell)) : row.unitCost;
    return {
      ...row,
      label: selected?.partNumber ?? row.label,
      description: selected?.description ?? row.description,
      quantity: selected ? selected.effectiveQuantity : row.quantity,
      unitCost:
        selected?.resolvedUnitPrice ??
        (typeof selected?.manualUnitPrice === "number" ? selected.manualUnitPrice : catalogUnitCost),
      lineTotal: selected?.lineTotal ?? row.lineTotal,
    };
  });
}

export function computeEstimateFromDraft(
  draft: EstimateDraft,
  pricingLookup: PricingLookup = new Map(),
): EstimateComputed {
  const vendorAdjustments = sanitizeVendorAdjustments(draft.materials.vendorAdjustments);
  const visibleMaterialLines = resolveMaterialLines(
    draft,
    pricingLookup,
    vendorAdjustments,
  );
  const materialLinesSubtotal = roundMoney(
    visibleMaterialLines.reduce((total, line) => total + (line.lineTotal ?? 0), 0),
  );
  const sectionAdjustments = computeSectionAdjustments({
    visibleMaterialLines,
    draft,
  });
  const sectionAdjustmentsTotal = roundMoney(
    sectionAdjustments.reduce((total, entry) => total + entry.amount, 0),
  );
  const materialSubtotal = roundMoney(materialLinesSubtotal + sectionAdjustmentsTotal);
  const summary = buildSummary(draft, {
    materialLinesSubtotal,
    sectionAdjustmentsTotal,
    materialSubtotal,
  });
  const issues = visibleMaterialLines
    .filter((line) => line.priceSource === "missing")
    .map((line) => ({
      code: "missing_price",
      message: line.blockingReason || "Line needs a database or manual price.",
      lineKey: line.lineKey,
    }));
  const hydratedDraft: EstimateDraft = {
    ...draft,
    materials: {
      ...draft.materials,
      visibleLines: visibleMaterialLines,
      vendorAdjustments,
    },
    summary,
    parity: {
      status: issues.length === 0 ? "pass" : "blocked",
      canExportPdf: issues.length === 0,
      checkedAt: new Date().toISOString(),
      issues,
      requiredSummaryCells: {},
    },
  };

  return {
    draft: hydratedDraft,
    summary,
    parity: hydratedDraft.parity!,
    projectDisplayRows: getProjectDefaultDisplayRows(hydratedDraft),
    fieldRows: hydrateWorkbookRows(buildFieldWorkbookRows(), hydratedDraft),
    shopRows: hydrateWorkbookRows(buildShopWorkbookRows(), hydratedDraft),
    designRows: hydrateWorkbookRows(buildDesignWorkbookRows(), hydratedDraft),
    materials: hydrateCatalogRows(hydratedDraft, visibleMaterialLines),
    visibleMaterialLines,
    sectionAdjustments,
    totalsBySection: [
      { label: "Material Subtotal", amount: summary.materialSubtotal },
      { label: "Sales Tax", amount: summary.salesTaxCost },
      { label: "Material Inflation", amount: summary.materialInflationCost },
      { label: "Field", amount: summary.totalFieldCost },
      { label: "Shop", amount: summary.totalShopCost },
      { label: "Design", amount: summary.totalDesignCost },
      { label: "Subs & Misc", amount: summary.subsTotal },
      { label: "Fees", amount: summary.fees },
      { label: "Overhead", amount: summary.overheadCost },
      { label: "Profit", amount: summary.profitCost },
      { label: "Total Estimate", amount: summary.totalCost },
    ],
    summaryRows: buildSummaryRows(summary),
  };
}

export function seedDraftWithJobLineItems(draft: EstimateDraft): EstimateDraft {
  return draft;
}

export function buildSummaryCellSnapshot() {
  return [];
}

export function buildBlankCellReferenceGrid() {
  return [];
}

export const SYSTEM1_WORKBOOK_INPUT_CELL_MAP = {};
