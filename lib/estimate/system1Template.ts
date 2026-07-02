import type {
  EstimateCatalogRow,
  EstimateDraft,
  EstimateVisibleMaterialLine,
  EstimateWorkbookSectionRow,
} from "@/lib/estimateTypes";
import { defaultEstimateProjectMetadata, percentFromTemplateCell } from "@/lib/estimate/estimateMetadata";
import {
  DEMO_ESTIMATE_PRICING_INPUTS,
  DEMO_ESTIMATE_PROJECT_PRICING,
  useDemoEstimatePricingDefaults,
} from "@/lib/estimate/demoPricingDefaults";
import {
  getEstimateWorkbookProfile,
  getWorkbookTemplateDisplayName,
  rewriteWorkDayFormula,
  scaleDefaultProductionRate,
} from "@/lib/estimate/estimateWorkbookProfile";
import type { JobDetailsResponse } from "@/lib/types";
import { normalizeListNumber } from "@/lib/jobListContext";
import system1Sheet from "@/lib/estimate/system1Sheet.json";

type SheetCellValue = string | number | null;

const SHEET = system1Sheet as SheetCellValue[][];

export const SYSTEM1_TEMPLATE_KEY = "system-1" as const;
export const SYSTEM1_TEMPLATE_VERSION = "system-1-v1";

const MATERIAL_SECTION_ROWS = new Set([
  131, 191, 200, 207, 262, 336, 422, 460, 639, 670, 708, 775, 903, 964, 975,
]);

const MATERIAL_HEADER_ROWS = new Set([
  132, 138, 144, 157, 165, 171, 178, 208, 214, 220, 225, 231, 238, 244, 251,
  364, 375, 385, 579, 768, 896, 922, 1149,
]);

const MATERIAL_FORCED_ITEM_ROWS = new Set([454, 455, 456, 457]);
const MATERIAL_VISIBLE_DERIVED_QUANTITY_ROWS = new Set([790, 900, 943, 966, 968, 969]);

const MATERIAL_ROW_PATH_OVERRIDES = new Map<number, { section: string; subcategory: string | null }>([
  [185, { section: "Exposed Sprinklers", subcategory: "General" }],
  [187, { section: "Exposed Sprinklers", subcategory: "General" }],
  [188, { section: "Exposed Sprinklers", subcategory: "General" }],
  [189, { section: "Exposed Sprinklers", subcategory: "General" }],
  ...Array.from({ length: 35 }, (_, index) => [
    301 + index,
    { section: "Escutcheons", subcategory: "General" },
  ] as const),
  ...Array.from({ length: 85 }, (_, index) => [
    337 + index,
    { section: "Pipe", subcategory: "General" },
  ] as const),
  ...Array.from({ length: 24 }, (_, index) => [
    436 + index,
    { section: "Weld Fittings", subcategory: "General" },
  ] as const),
  ...Array.from({ length: 8 }, (_, index) => [
    452 + index,
    { section: "Weld Flange", subcategory: "General" },
  ] as const),
  ...Array.from({ length: 178 }, (_, index) => [
    461 + index,
    { section: "Grooved Fittings", subcategory: "General" },
  ] as const),
  ...Array.from({ length: 66 }, (_, index) => [
    709 + index,
    { section: "Backflow Devices", subcategory: "General" },
  ] as const),
  ...Array.from({ length: 128 }, (_, index) => [
    776 + index,
    { section: "Hose Equipment", subcategory: "General" },
  ] as const),
  ...Array.from({ length: 60 }, (_, index) => [
    904 + index,
    { section: "Misc. & Devices", subcategory: "General" },
  ] as const),
  ...Array.from({ length: 179 }, (_, index) => [
    976 + index,
    { section: "CPVC", subcategory: "General" },
  ] as const),
]);

const FIELD_PIPE_FOOTAGE_ROWS = new Set([15, 16, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27, 28]);
const FIELD_SPRINKLER_ROWS = new Set([39, 40, 41, 42, 43, 44, 45, 46, 47]);
const FIELD_MISC_ROWS = new Set([49, 50, 51, 52, 53, 54, 55]);

const FIELD_RATE_ROWS = [
  { row: 15, rateCell: "H15" },
  { row: 16, rateCell: "H16" },
  { row: 17, rateCell: "H17" },
  { row: 18, rateCell: "H18" },
  { row: 19, rateCell: "H19" },
  { row: 20, rateCell: "H20" },
  { row: 22, rateCell: "H22" },
  { row: 23, rateCell: "H23" },
  { row: 24, rateCell: "H24" },
  { row: 25, rateCell: "H25" },
  { row: 26, rateCell: "H26" },
  { row: 27, rateCell: "H27" },
  { row: 28, rateCell: "H28" },
  { row: 31, rateCell: "H31" },
  { row: 32, rateCell: "H32" },
  { row: 33, rateCell: "H33" },
  { row: 34, rateCell: "H34" },
  { row: 35, rateCell: "H35" },
  { row: 36, rateCell: "H36" },
  { row: 39, rateCell: "H39" },
  { row: 40, rateCell: "H40" },
  { row: 41, rateCell: "H41" },
  { row: 42, rateCell: "H42" },
  { row: 43, rateCell: "H43" },
  { row: 44, rateCell: "H44" },
  { row: 45, rateCell: "H45" },
  { row: 46, rateCell: "H46" },
  { row: 47, rateCell: "H47" },
  { row: 49, rateCell: "J49" },
  { row: 50, rateCell: "J50" },
  { row: 51, rateCell: "J51" },
  { row: 52, rateCell: "J52" },
  { row: 53, rateCell: "J53" },
  { row: 54, rateCell: "J54" },
  { row: 55, rateCell: "D55" },
];

function buildEditableFieldRateInputs(): Record<string, number> {
  const base = Object.fromEntries(
    FIELD_RATE_ROWS.map(({ rateCell }) => [rateCell, getBaseNumber(rateCell)]).filter(
      (entry): entry is [string, number] => entry[1] !== null,
    ),
  );
  const profile = getEstimateWorkbookProfile();
  if (profile.productionRateScale === 1) {
    return base;
  }
  return Object.fromEntries(
    Object.entries(base).map(([cell, value]) => [cell, scaleDefaultProductionRate(value)]),
  );
}

const EDITABLE_FIELD_RATE_INPUTS = buildEditableFieldRateInputs();

const FIELD_MANUAL_INPUTS = {
  B58: 0,
  B59: 0,
  B60: 0,
  B61: 0,
  B62: 0,
  A68: getBaseNumber("A68"),
  A69: getBaseNumber("A69"),
  A70: getBaseNumber("A70"),
  A71: getBaseNumber("A71"),
  E66: getBaseNumber("E66"),
  E68: getBaseNumber("E68"),
  E69: getBaseNumber("E69"),
  H71: getBaseNumber("H71"),
} as const;

const SHOP_INPUTS = {
  A75: null,
  A76: null,
  A77: null,
  A78: null,
  A80: null,
  A81: null,
  A82: null,
  A83: null,
  E75: getBaseNumber("E75"),
  E80: null,
  E81: getBaseNumber("E81"),
  E82: getBaseNumber("E82"),
  H80: getBaseNumber("H80"),
  I83: getBaseNumber("I83"),
} as const;

const DESIGN_INPUTS = {
  A86: null,
  A87: null,
  A88: null,
  A89: null,
  A90: null,
  A91: null,
  A92: null,
  A93: null,
  A94: null,
  A95: null,
  A96: null,
  E86: getBaseNumber("E86"),
  E87: getBaseNumber("E87"),
  E88: getBaseNumber("E88"),
  E94: null,
  E95: getBaseNumber("E95"),
  E96: getBaseNumber("E96"),
  H94: getBaseNumber("H94"),
  I93: getBaseNumber("I93"),
} as const;

const SUMMARY_INPUTS = {
  A11: getBaseNumber("A11"),
  E8: getBaseNumber("E8"),
  E9: getBaseNumber("E9"),
  A99: getBaseNumber("A99"),
  A101: getBaseNumber("A101"),
  A117: getBaseNumber("A117"),
  A119: null,
  A121: 0,
  A122: 0,
  A128: 0,
} as const;

const SUBS_MISC_INPUTS = {
  A103: 0,
  A104: 0,
  A105: 0,
  A106: 0,
  A107: 0,
  A108: 0,
  A109: 0,
  A110: 0,
  A111: 0,
  A112: 0,
  A113: 0,
  A114: 0,
  A115: 0,
} as const;

export const SUBS_MISC_FIXED_LABELS: Record<string, string> = {
  A103: "Lift",
  A104: "Tools",
  A105: "Service Truck",
  A106: "Fire Pump",
  A107: "Underground Sub",
  A108: "Chemical System",
  A109: "Electrical Cost",
  A110: "Core Drilling",
  A111: "Painting",
  A112: "Nitrogen System",
};

export const SUBS_MISC_CUSTOM_CELLS = ["A113", "A114", "A115"] as const;

const SUMMARY_CELL_MAP = {
  materialSubtotal: "F7",
  totalMaterialCost: "F10",
  totalFieldHours: "A72",
  totalShopHours: "A79",
  totalDesignHours: "A97",
  subtotal: "F98",
  overheadCost: "F99",
  profitCost: "F101",
  totalCost: "F123",
  grandTotalLaborHours: "A124",
  totalSprinklers: "A125",
  materialCostPerHead: "F125",
  totalCostPerHead: "F126",
  hoursPerHead: "F127",
  totalCostPerSquareFoot: "F128",
  travelZone: "A12",
} as const;

function columnNumberToLetter(columnNumber: number): string {
  let result = "";
  let current = columnNumber;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

export function cellAddress(row: number, column: number): string {
  return `${columnNumberToLetter(column)}${row}`;
}

export function parseCellAddress(address: string): { row: number; column: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(address.toUpperCase().trim());
  if (!match) {
    throw new Error(`Invalid cell address: ${address}`);
  }

  const [, letters, rowString] = match;
  let column = 0;
  for (const letter of letters) {
    column = column * 26 + (letter.charCodeAt(0) - 64);
  }

  return {
    row: Number(rowString),
    column,
  };
}

export function getBaseCell(address: string): SheetCellValue {
  const { row, column } = parseCellAddress(address);
  const value = SHEET[row - 1]?.[column - 1] ?? null;
  if (typeof value === "string" && value.startsWith("=")) {
    return rewriteWorkDayFormula(value);
  }
  return value;
}

export function getBaseNumber(address: string): number | null {
  const value = getBaseCell(address);
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getBaseString(address: string): string {
  const value = getBaseCell(address);
  return typeof value === "string" ? value : "";
}

function toDraftValueMap(source: Record<string, number | null>) {
  return Object.fromEntries(Object.entries(source));
}

function extractVendorPartNumber(parts: Array<string | null>): string | null {
  const candidates = parts
    .filter((part): part is string => Boolean(part))
    .flatMap((part) => part.toUpperCase().match(/\b[A-Z]{1,6}\d[A-Z0-9-]*\b/g) || []);

  if (candidates.length === 0) {
    return null;
  }

  return candidates[candidates.length - 1];
}

function determineQuantityCell(rowNumber: number, values: SheetCellValue[]): {
  quantityCell: string | null;
  isQuantityDerived: boolean;
} {
  const firstCell = values[0];
  if (typeof firstCell === "string" && firstCell.startsWith("=")) {
    if (MATERIAL_VISIBLE_DERIVED_QUANTITY_ROWS.has(rowNumber)) {
      return { quantityCell: `A${rowNumber}`, isQuantityDerived: true };
    }
    if (firstCell.includes(`B${rowNumber}`)) {
      return { quantityCell: `B${rowNumber}`, isQuantityDerived: false };
    }
    return { quantityCell: null, isQuantityDerived: true };
  }
  return { quantityCell: `A${rowNumber}`, isQuantityDerived: false };
}

function buildRowLabel(parts: Array<string | null>): {
  label: string | null;
  description: string | null;
  detail: string | null;
} {
  const [a, b, c, d] = parts;

  if (b && c) {
    return {
      label: b,
      description: c,
      detail: d,
    };
  }

  if (a && b) {
    return {
      label: a,
      description: b,
      detail: c ?? d,
    };
  }

  if (c && d) {
    return {
      label: c,
      description: d,
      detail: null,
    };
  }

  return {
    label: b ?? a ?? c ?? d ?? null,
    description: c && (b || a) ? c : d,
    detail: null,
  };
}

function materialText(value: SheetCellValue): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed && !trimmed.startsWith("=") ? trimmed : null;
  }
  return value != null ? String(value) : null;
}

export function buildMaterialCatalogRowMetadata(): EstimateCatalogRow[] {
  const rows: EstimateCatalogRow[] = [];
  let currentSection = "Materials";
  let currentSubcategory: string | null = null;

  for (let rowNumber = 131; rowNumber <= 1154; rowNumber += 1) {
    // Sheet row 965 ("Enter Pump Size") is replaced by the synthetic
    // "Pump Bundle" row appended below; skip the raw workbook entry.
    if (rowNumber === 965) {
      continue;
    }
    const values = SHEET[rowNumber - 1] ?? [];
    const [a, b, c, d, e, f] = values as SheetCellValue[];
    const hasMeaningfulData = [a, b, c, d, e, f].some(
      (value) => value !== null && value !== "",
    );

    if (!hasMeaningfulData) {
      continue;
    }

    const bText = typeof b === "string" ? b.trim() : "";
    const cText = typeof c === "string" ? c.trim() : "";
    const onlyHeaderText =
      !a &&
      !c &&
      !d &&
      !e &&
      !f &&
      Boolean(bText);

    if (MATERIAL_SECTION_ROWS.has(rowNumber) && bText) {
      currentSection = bText;
      currentSubcategory = null;
      rows.push({
        rowKey: `row-${rowNumber}`,
        sheetRow: rowNumber,
        section: currentSection,
        subcategory: null,
        label: bText,
        description: null,
        detail: null,
        vendorPartNumber: null,
        quantityCell: null,
        unitCostCell: null,
        defaultUnitCost: null,
        pricingMode: "template_default",
        rowType: "section_header",
        formulaKey: null,
        isQuantityDerived: true,
        quantity: null,
        unitCost: null,
        lineTotal: null,
      });
      continue;
    }

    if ((MATERIAL_HEADER_ROWS.has(rowNumber) || onlyHeaderText) && bText && !MATERIAL_FORCED_ITEM_ROWS.has(rowNumber)) {
      currentSubcategory = bText;
      rows.push({
        rowKey: `row-${rowNumber}`,
        sheetRow: rowNumber,
        section: currentSection,
        subcategory: currentSubcategory,
        label: bText,
        description: null,
        detail: null,
        vendorPartNumber: null,
        quantityCell: null,
        unitCostCell: null,
        defaultUnitCost: null,
        pricingMode: "template_default",
        rowType: "section_header",
        formulaKey: null,
        isQuantityDerived: true,
        quantity: null,
        unitCost: null,
        lineTotal: null,
      });
      continue;
    }

    const isSubtotal =
      bText.toLowerCase().startsWith("total ") ||
      cText.toLowerCase().startsWith("total ");
    const isAdjustment =
      bText.toLowerCase().includes("inflation") ||
      bText.toLowerCase().includes("price increase") ||
      bText.toLowerCase().includes("subtotal");

    const { quantityCell, isQuantityDerived } = determineQuantityCell(
      rowNumber,
      values,
    );
    const { label, description, detail } = buildRowLabel([
      materialText(a),
      materialText(b),
      materialText(c),
      materialText(d),
    ]);
    const defaultUnitCost =
      typeof e === "number"
        ? e
        : typeof e === "string" && !e.startsWith("=")
          ? Number(e) || null
          : null;

    const pathOverride = MATERIAL_ROW_PATH_OVERRIDES.get(rowNumber);

    rows.push({
      rowKey: `row-${rowNumber}`,
      sheetRow: rowNumber,
      section: pathOverride?.section ?? currentSection,
      subcategory: pathOverride ? pathOverride.subcategory : currentSubcategory,
      label,
      description,
      detail,
      vendorPartNumber: extractVendorPartNumber([
        label,
        description,
        detail,
        typeof values[18] === "string" ? values[18] : null,
        typeof values[19] === "string" ? values[19] : null,
      ]),
      quantityCell,
      unitCostCell: `E${rowNumber}`,
      defaultUnitCost,
      pricingMode: "template_default",
      rowType: isSubtotal ? "subtotal" : isAdjustment ? "adjustment" : "item",
      formulaKey:
        typeof e === "string" && e.startsWith("=") ? `row-${rowNumber}` : null,
      isQuantityDerived,
      quantity: null,
      unitCost: null,
      lineTotal: null,
    });
  }

  rows.push({
    rowKey: "synthetic-pump-bundle",
    sheetRow: 965,
    section: "Pump Equipment",
    subcategory: "Bundles",
    label: "Pump Bundle",
    description: "Auto-expands the full pump header materials for 4\"/6\"/8\"/10\"",
    detail: "Pick size on the line; children populate automatically",
    vendorPartNumber: null,
    quantityCell: null,
    unitCostCell: null,
    defaultUnitCost: null,
    pricingMode: "template_default",
    rowType: "item",
    formulaKey: "pump-bundle",
    isQuantityDerived: true,
    quantity: null,
    unitCost: null,
    lineTotal: null,
  });

  return rows;
}

function buildWorkbookRows(
  defs: Array<{ row: number; rateCell?: string | null }>,
): EstimateWorkbookSectionRow[] {
  return defs.map((definition) => {
    const row = definition.row;
    const values = SHEET[row - 1] ?? [];
    const label =
      (typeof values[1] === "string" && values[1].trim()) ||
      (typeof values[2] === "string" && values[2].trim()) ||
      `Row ${row}`;

    return {
      rowKey: `row-${row}`,
      label,
      quantityCell: `A${row}`,
      rateCell: definition.rateCell ?? null,
      unitRateCell:
        FIELD_PIPE_FOOTAGE_ROWS.has(row) ||
        FIELD_SPRINKLER_ROWS.has(row) ||
        (FIELD_MISC_ROWS.has(row) && row !== 55)
          ? `I${row}`
          : row === 55
            ? "D55"
            : null,
      minutesCell:
        FIELD_SPRINKLER_ROWS.has(row) || (FIELD_MISC_ROWS.has(row) && row !== 55) ? `J${row}` : null,
      hoursCell: `E${row}`,
      daysCell: FIELD_PIPE_FOOTAGE_ROWS.has(row) ? `G${row}` : `F${row}`,
      costCell: null,
    };
  });
}

export function buildFieldWorkbookRows(): EstimateWorkbookSectionRow[] {
  return buildWorkbookRows(FIELD_RATE_ROWS).concat([
    { rowKey: "row-58", label: "Setup & Testing", quantityCell: "B58", hoursCell: "A58", daysCell: "G58", costCell: null },
    { rowKey: "row-59", label: "Install Mains", quantityCell: "B59", hoursCell: "A59", daysCell: "G59", costCell: null },
    { rowKey: "row-60", label: "Install Lines", quantityCell: "B60", hoursCell: "A60", daysCell: "G60", costCell: null },
    { rowKey: "row-61", label: "Demo and Tie", quantityCell: "B61", hoursCell: "A61", daysCell: "G61", costCell: null },
    { rowKey: "row-62", label: "Install Cutbacks", quantityCell: "B62", hoursCell: "A62", daysCell: "G62", costCell: null },
    { rowKey: "row-66", label: "Field Labor", quantityCell: "A66", rateCell: "E66", hoursCell: "A66", costCell: "F66" },
    { rowKey: "row-67", label: "Mileage Reimbursement", quantityCell: "A67", rateCell: "E67", hoursCell: "A67", costCell: "F67" },
    { rowKey: "row-68", label: "# Field Hotel Nights", quantityCell: "A68", rateCell: "E68", hoursCell: "A68", costCell: "F68" },
    { rowKey: "row-69", label: "Field Meals", quantityCell: "A69", rateCell: "E69", hoursCell: "A69", costCell: "F69" },
    { rowKey: "row-70", label: "Field Travel Time", quantityCell: "A70", rateCell: "E70", hoursCell: "A70", costCell: "F70" },
    { rowKey: "row-71", label: "Field Truck", quantityCell: "A71", rateCell: "E71", hoursCell: "A71", costCell: "F71" },
  ]);
}

export function buildShopWorkbookRows(): EstimateWorkbookSectionRow[] {
  const shopLabels = getEstimateWorkbookProfile().shopRowLabels;
  return [
    {
      rowKey: "row-75",
      label: shopLabels[75] ?? "Line & Main Fab",
      quantityCell: "A75",
      rateCell: "E75",
      hoursCell: "A75",
      costCell: "F75",
    },
    {
      rowKey: "row-76",
      label: shopLabels[76] ?? "Riser Fab",
      quantityCell: "A76",
      rateCell: "E76",
      hoursCell: "A76",
      costCell: "F76",
    },
    {
      rowKey: "row-77",
      label: shopLabels[77] ?? "Pump Fab",
      quantityCell: "A77",
      rateCell: "E77",
      hoursCell: "A77",
      costCell: "F77",
    },
    {
      rowKey: "row-78",
      label: shopLabels[78] ?? "General Fab",
      quantityCell: "A78",
      rateCell: "E78",
      hoursCell: "A78",
      costCell: "F78",
    },
    { rowKey: "row-79", label: "TOTAL SHOP HOURS", quantityCell: null, rateCell: null, hoursCell: "A79", costCell: null },
    { rowKey: "row-80", label: "Trucking Trips", quantityCell: "A80", rateCell: "E80", hoursCell: "A80", costCell: "F80" },
    { rowKey: "row-81", label: "Truck Hotel Per Night", quantityCell: "A81", rateCell: "E81", hoursCell: "A81", costCell: "F81" },
    { rowKey: "row-82", label: "Truck Meals", quantityCell: "A82", rateCell: "E82", hoursCell: "A82", costCell: "F82" },
    { rowKey: "row-83", label: "Truck Time", quantityCell: "A83", rateCell: "E83", hoursCell: "A83", costCell: "F83" },
  ];
}

export function buildDesignWorkbookRows(): EstimateWorkbookSectionRow[] {
  return [
    { rowKey: "row-86", label: "Calculated Design Hours / Spr", quantityCell: "A86", rateCell: "E86", hoursCell: "A86", daysCell: "I86", costCell: null },
    { rowKey: "row-87", label: "Calculated Design Hours / Field", quantityCell: "A87", rateCell: "E87", hoursCell: "A87", daysCell: "I87", costCell: null },
    { rowKey: "row-88", label: "Design (Hrs)", quantityCell: "A88", rateCell: "E88", hoursCell: "A88", daysCell: "I88", costCell: "F88" },
    { rowKey: "row-89", label: "Design Standpipe (Hrs)", quantityCell: "A89", rateCell: "E89", hoursCell: "A89", costCell: "F89" },
    { rowKey: "row-90", label: "Design Pump (Hrs)", quantityCell: "A90", rateCell: "E90", hoursCell: "A90", costCell: "F90" },
    { rowKey: "row-91", label: "Design Survey Time (Hrs)", quantityCell: "A91", rateCell: "E91", hoursCell: "A91", costCell: "F91" },
    { rowKey: "row-92", label: "Design Meeting Time / BIM (Hrs)", quantityCell: "A92", rateCell: "E92", hoursCell: "A92", costCell: "F92" },
    { rowKey: "row-93", label: "Design Travel Time (Hrs)", quantityCell: "A93", rateCell: "E93", hoursCell: "A93", costCell: "F93" },
    { rowKey: "row-94", label: "# Design Trips To Site", quantityCell: "A94", rateCell: "E94", hoursCell: "A94", costCell: "F94" },
    { rowKey: "row-95", label: "# Design Hotel Nights", quantityCell: "A95", rateCell: "E95", hoursCell: "A95", costCell: "F95" },
    { rowKey: "row-96", label: "Design Meals", quantityCell: "A96", rateCell: "E96", hoursCell: "A96", costCell: "F96" },
    { rowKey: "row-97", label: "TOTAL DESIGN HOURS", quantityCell: null, rateCell: null, hoursCell: "A97", costCell: null },
  ];
}

function normalizePartKey(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/[\s\t\r\n]+/g, "").toUpperCase().trim();
  return normalized || null;
}

export function buildAutoCandidateRowKeysForPart(
  partNumber: string | null | undefined,
): string[] {
  const normalized = normalizePartKey(partNumber);
  if (!normalized) {
    return [];
  }

  return buildMaterialCatalogRowMetadata()
    .filter(
      (row) =>
        row.rowType !== "section_header" &&
        Boolean(row.quantityCell) &&
        !row.isQuantityDerived &&
        normalizePartKey(row.vendorPartNumber) === normalized,
    )
    .map((row) => row.rowKey);
}

export function buildEstimateVisibleMaterialLinesFromJob(
  jobDetails: JobDetailsResponse,
  existingLines: EstimateVisibleMaterialLine[] = [],
): EstimateVisibleMaterialLine[] {
  const existingByKey = new Map(existingLines.map((line) => [line.lineKey, line]));

  return jobDetails.lineItems.map((item) => {
    const lineKey = `job-row-${item.rowIndex}`;
    const existing = existingByKey.get(lineKey);
    const manualQty =
      existing && typeof existing.manualQty === "number"
        ? Math.max(0, existing.manualQty)
        : typeof item.quantityNeeded === "number" && Number.isFinite(item.quantityNeeded)
          ? Math.max(0, item.quantityNeeded)
          : 0;
    return {
      lineKey,
      autoSource: null,
      rowIndex: item.rowIndex,
      partNumber: item.partNumber ?? null,
      description: item.description ?? null,
      manualQty,
      autoQty: 0,
      effectiveQuantity: manualQty,
      supplier: existing?.supplier ?? null,
      databaseUnitPrice: null,
      manualUnitPrice:
        existing && typeof existing.manualUnitPrice === "number"
          ? existing.manualUnitPrice
          : null,
      baseUnitPrice: null,
      vendorAdjustmentPercent: null,
      adjustedUnitPrice: null,
      resolvedUnitPrice: null,
      priceSource: "missing",
      blockingReason: null,
      lineTotal: null,
    } satisfies EstimateVisibleMaterialLine;
  });
}

export function createDefaultEstimateDraft(
  jobDetails: JobDetailsResponse,
): EstimateDraft {
  const listNumber = normalizeListNumber(jobDetails.jobMeta?.listNumber ?? "1");
  const listedBy =
    jobDetails.jobMeta?.listedByName ||
    jobDetails.jobMeta?.listedBy ||
    "";

  return {
    meta: {
      jobNumber: jobDetails.jobNumber,
      listNumber,
      jobName: jobDetails.jobName,
      templateKey: SYSTEM1_TEMPLATE_KEY,
      templateVersion: SYSTEM1_TEMPLATE_VERSION,
      status: "DRAFT",
    },
    project: {
      date: new Date().toISOString().split("T")[0],
      estimator: listedBy,
      projectName: jobDetails.jobName,
      systemLabel: listNumber,
      projectLocationLine1: jobDetails.jobMeta?.locationShipTo ?? "",
      projectLocationLine2: jobDetails.jobMeta?.area ?? "",
      bidDueDate: jobDetails.jobMeta?.stocklistDeliveryShipDate ?? "",
      squareFootage: useDemoEstimatePricingDefaults()
        ? DEMO_ESTIMATE_PROJECT_PRICING.squareFootage
        : SUMMARY_INPUTS.A128,
      ...defaultEstimateProjectMetadata(),
    },
    inputs: useDemoEstimatePricingDefaults()
      ? { ...DEMO_ESTIMATE_PRICING_INPUTS }
      : {
      milesToJobSite: SUMMARY_INPUTS.A11 ?? 0,
      salesTaxPercent: percentFromTemplateCell(SUMMARY_INPUTS.E8),
      materialInflationPercent: percentFromTemplateCell(SUMMARY_INPUTS.E9),
      overheadPercent: percentFromTemplateCell(SUMMARY_INPUTS.A99),
      profitPercent: percentFromTemplateCell(SUMMARY_INPUTS.A101),
      subsMarkupPercent: percentFromTemplateCell(SUMMARY_INPUTS.A117),
      fees: SUMMARY_INPUTS.A119,
      peStamp: SUMMARY_INPUTS.A121 ?? 0,
      bondCost: SUMMARY_INPUTS.A122 ?? 0,
    },
    rates: {
      adjustedRates: {
        ...EDITABLE_FIELD_RATE_INPUTS,
      },
    },
    field: {
      manualHours: toDraftValueMap(FIELD_MANUAL_INPUTS),
      costs: {},
    },
    shop: {
      inputs: toDraftValueMap(SHOP_INPUTS),
    },
    design: {
      inputs: toDraftValueMap(DESIGN_INPUTS),
    },
    materials: {
      visibleLines: buildEstimateVisibleMaterialLinesFromJob(jobDetails),
      vendorAdjustments: [],
      workbookCatalog: {
        rows: buildMaterialCatalogRowMetadata(),
        cellOverrides: {},
      },
    },
    subsAndFees: {
      miscellaneousCosts: toDraftValueMap(SUBS_MISC_INPUTS),
      miscellaneousLabels: {},
    },
    summary: null,
    parity: null,
    changeOrders: [],
  };
}

export const SYSTEM1_INPUT_CELL_MAP = SUMMARY_INPUTS;
export const SYSTEM1_RATE_INPUT_CELL_MAP = EDITABLE_FIELD_RATE_INPUTS;
export const SYSTEM1_FIELD_INPUT_CELL_MAP = FIELD_MANUAL_INPUTS;
export const SYSTEM1_SHOP_INPUT_CELL_MAP = SHOP_INPUTS;
export const SYSTEM1_DESIGN_INPUT_CELL_MAP = DESIGN_INPUTS;
export const SYSTEM1_SUBS_MISC_INPUT_CELL_MAP = SUBS_MISC_INPUTS;
export const SYSTEM1_SUMMARY_CELL_MAP = SUMMARY_CELL_MAP;

export function getProjectDefaultDisplayRows(draft: EstimateDraft) {
  return [
    { label: "Project", value: draft.project.projectName || draft.meta.jobName },
    { label: "Job Number", value: draft.meta.jobNumber },
    { label: "List", value: draft.meta.listNumber },
    { label: "Estimator", value: draft.project.estimator || "Not set" },
    {
      label: "Location",
      value:
        [draft.project.projectLocationLine1, draft.project.projectLocationLine2]
          .filter(Boolean)
          .join(", ") || "Not set",
    },
    { label: "Bid Due", value: draft.project.bidDueDate || "Not set" },
  ];
}

export function getSystem1SheetData(): SheetCellValue[][] {
  return SHEET.map((row) => [...row]);
}

export function getSystem1TemplateDisplayName(): string {
  return getWorkbookTemplateDisplayName(getBaseString("H2") || "System 1");
}
