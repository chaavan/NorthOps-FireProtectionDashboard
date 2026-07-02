export type SectionAdjustmentRule = {
  adjustmentRowKey: string;
  label: string;
  percentCell: string;
  dollarCell: string;
  rangeStartSheetRow: number;
  rangeEndSheetRow: number;
};

export const SYSTEM1_SECTION_ADJUSTMENT_RULES: SectionAdjustmentRule[] = [
  {
    adjustmentRowKey: "row-323",
    label: "Sprinklers & Accessories",
    percentCell: "A323",
    dollarCell: "F323",
    rangeStartSheetRow: 133,
    rangeEndSheetRow: 322,
  },
  {
    adjustmentRowKey: "row-395",
    label: "Pipe",
    percentCell: "A395",
    dollarCell: "F395",
    rangeStartSheetRow: 337,
    rangeEndSheetRow: 392,
  },
  {
    adjustmentRowKey: "row-600",
    label: "Groove Fittings",
    percentCell: "A600",
    dollarCell: "F600",
    rangeStartSheetRow: 461,
    rangeEndSheetRow: 599,
  },
  {
    adjustmentRowKey: "row-669",
    label: "Screwed Fittings",
    percentCell: "A669",
    dollarCell: "F669",
    rangeStartSheetRow: 640,
    rangeEndSheetRow: 668,
  },
  {
    adjustmentRowKey: "row-774",
    label: "Backflow Devices",
    percentCell: "A774",
    dollarCell: "F774",
    rangeStartSheetRow: 709,
    rangeEndSheetRow: 773,
  },
  {
    adjustmentRowKey: "row-1154",
    label: "CPVC",
    percentCell: "A1154",
    dollarCell: "F1154",
    rangeStartSheetRow: 976,
    rangeEndSheetRow: 1153,
  },
];

export function findAdjustmentRuleForSheetRow(
  sheetRow: number,
): SectionAdjustmentRule | null {
  return (
    SYSTEM1_SECTION_ADJUSTMENT_RULES.find(
      (rule) =>
        sheetRow >= rule.rangeStartSheetRow && sheetRow <= rule.rangeEndSheetRow,
    ) ?? null
  );
}

export function parseSheetRowFromCatalogKey(catalogRowKey: string | null | undefined): number | null {
  if (!catalogRowKey) return null;
  const match = /^row-(\d+)$/.exec(catalogRowKey);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}
