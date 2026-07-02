import { buildMaterialCatalogRowMetadata, getBaseCell } from "@/lib/estimate/system1Template";

export type AutoQuantityRow = {
  childRowKey: string;       // e.g. "row-436"
  childSheetRow: number;     // e.g. 436
  quantityCell: string;      // e.g. "A436"
  formula: string;           // raw column-A formula
  directTriggerRowKeys: Set<string>;     // immediate A_M refs (e.g. row-133)
  expandedTriggerRowKeys: Set<string>;   // recursively expanded through subtotal rows
};

const CATALOG_START_ROW = 131;
const CATALOG_END_ROW = 1154;

function extractAllCellRefs(formula: string): string[] {
  const refs: string[] = [];
  const rangeRegex = /([A-Z]+)(\d+)\s*:\s*([A-Z]+)(\d+)/g;
  let match: RegExpExecArray | null;
  const consumed: Array<[number, number]> = [];
  while ((match = rangeRegex.exec(formula)) !== null) {
    if (match[1] === match[3]) {
      const start = Math.min(Number(match[2]), Number(match[4]));
      const end = Math.max(Number(match[2]), Number(match[4]));
      for (let r = start; r <= end; r += 1) refs.push(`${match[1]}${r}`);
    }
    consumed.push([match.index, match.index + match[0].length]);
  }
  let masked = formula;
  consumed.sort((a, b) => b[0] - a[0]).forEach(([s, e]) => {
    masked = masked.slice(0, s) + " ".repeat(e - s) + masked.slice(e);
  });
  const singleRegex = /([A-Z]+)(\d+)/g;
  while ((match = singleRegex.exec(masked)) !== null) {
    refs.push(`${match[1]}${match[2]}`);
  }
  return refs;
}

/**
 * Walks the formula dependency tree starting from `cellAddress`, collecting
 * every A-column cell reference reachable. The starting cell's own A-row is
 * excluded so a row never lists itself as its own trigger.
 */
function collectATriggerSheetRows(
  cellAddress: string,
  excludeSheetRow: number,
): Set<number> {
  const visited = new Set<string>();
  const out = new Set<number>();
  const stack: string[] = [cellAddress];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const value = getBaseCell(current);
    if (typeof value === "string" && value.startsWith("=")) {
      extractAllCellRefs(value).forEach((ref) => {
        if (!visited.has(ref)) stack.push(ref);
        const colMatch = /^([A-Z]+)(\d+)$/.exec(ref);
        if (colMatch && colMatch[1] === "A") {
          const r = Number(colMatch[2]);
          if (r !== excludeSheetRow) out.add(r);
        }
      });
    } else {
      // leaf — if it's an A_M cell that's already an existing trigger we
      // captured above, the formula path counts. Non-formula non-A leaves
      // (unit costs, blanks) don't matter.
    }
  }
  return out;
}

function buildRegistry(): {
  rows: AutoQuantityRow[];
  byChildRowKey: Map<string, AutoQuantityRow>;
  byTriggerRowKey: Map<string, AutoQuantityRow[]>;
  autoQuantityRowKeySet: Set<string>;
} {
  const catalogRowTypeByKey = new Map(
    buildMaterialCatalogRowMetadata().map((row) => [row.rowKey, row.rowType] as const),
  );

  const rawScan: AutoQuantityRow[] = [];
  for (let sheetRow = CATALOG_START_ROW; sheetRow <= CATALOG_END_ROW; sheetRow += 1) {
    const cell = getBaseCell(`A${sheetRow}`);
    if (typeof cell !== "string" || !cell.startsWith("=")) continue;
    const directSheetRows = collectATriggerSheetRows(`A${sheetRow}`, sheetRow);
    if (directSheetRows.size === 0) continue;
    rawScan.push({
      childRowKey: `row-${sheetRow}`,
      childSheetRow: sheetRow,
      quantityCell: `A${sheetRow}`,
      formula: cell,
      directTriggerRowKeys: new Set(
        Array.from(directSheetRows).map((r) => `row-${r}`),
      ),
      expandedTriggerRowKeys: new Set(),
    });
  }

  const byChildRowKey = new Map<string, AutoQuantityRow>(
    rawScan.map((row) => [row.childRowKey, row] as const),
  );

  // Recursively expand: if a direct trigger is itself an auto-quantity row
  // (e.g. a "Total Dry Sprinklers" subtotal), walk into its triggers too.
  const expand = (rowKey: string, seen: Set<string>): Set<string> => {
    if (seen.has(rowKey)) return new Set();
    seen.add(rowKey);
    const node = byChildRowKey.get(rowKey);
    if (!node) return new Set([rowKey]);
    const out = new Set<string>();
    node.directTriggerRowKeys.forEach((trigger) => {
      const sub = expand(trigger, seen);
      sub.forEach((s) => out.add(s));
    });
    return out;
  };

  rawScan.forEach((row) => {
    const expanded = new Set<string>();
    row.directTriggerRowKeys.forEach((trigger) => {
      const triggerNode = byChildRowKey.get(trigger);
      if (triggerNode) {
        expand(trigger, new Set()).forEach((s) => expanded.add(s));
      } else {
        expanded.add(trigger);
      }
    });
    row.expandedTriggerRowKeys = expanded;
  });

  // Emit only rows whose own rowType is "item" — subtotal rows
  // (e.g. row-297 "Total Dry Sprinklers") are formula-only roll-ups and must
  // never appear as visible auto-children themselves; they only contribute via
  // the recursive expansion above.
  const rows = rawScan.filter((row) => {
    const rowType = catalogRowTypeByKey.get(row.childRowKey);
    return rowType === "item";
  });

  const byTriggerRowKey = new Map<string, AutoQuantityRow[]>();
  rows.forEach((row) => {
    row.expandedTriggerRowKeys.forEach((trigger) => {
      const existing = byTriggerRowKey.get(trigger);
      if (existing) existing.push(row);
      else byTriggerRowKey.set(trigger, [row]);
    });
  });

  // Set of every auto-quantity row's own key (item OR subtotal) so callers can
  // filter both kinds out of the part picker — none of them should ever be
  // user-selectable since their qty is workbook-derived.
  const autoQuantityRowKeySet = new Set(rawScan.map((row) => row.childRowKey));

  return { rows, byChildRowKey, byTriggerRowKey, autoQuantityRowKeySet };
}

const REGISTRY = buildRegistry();

export const SYSTEM1_AUTO_QUANTITY_ROWS = REGISTRY.rows;
export const SYSTEM1_AUTO_QUANTITY_BY_TRIGGER = REGISTRY.byTriggerRowKey;
export const SYSTEM1_AUTO_QUANTITY_BY_CHILD = REGISTRY.byChildRowKey;
export const SYSTEM1_AUTO_QUANTITY_ROW_KEYS = REGISTRY.autoQuantityRowKeySet;

/**
 * Given the set of currently-selected catalog row keys (parents + manual
 * children), returns the list of auto-quantity rows that should be emitted as
 * auto-children, deduplicated.
 */
export function findActiveAutoQuantityRows(
  selectedRowKeys: Set<string>,
): AutoQuantityRow[] {
  const out = new Set<AutoQuantityRow>();
  selectedRowKeys.forEach((rowKey) => {
    const matches = SYSTEM1_AUTO_QUANTITY_BY_TRIGGER.get(rowKey);
    if (matches) matches.forEach((row) => out.add(row));
  });
  return Array.from(out);
}
