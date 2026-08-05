/**
 * Replace the real material descriptions and unit prices in
 * lib/estimate/system1Sheet.json with synthetic, demo-safe equivalents.
 *
 * The workbook is a 1,183-row grid feeding a hyperformula engine. Every
 * consumer (system1Template, estimateEngine, system1AutoChildRules,
 * system1AutoQuantityRows, catalogMaterialAdd) keys off row index and cell
 * address — never off description text — so the text is free to change as long
 * as the STRUCTURE the template derives from it does not. The invariants below
 * come straight from buildMaterialCatalogRowMetadata() in system1Template.ts.
 *
 * Invariants preserved:
 *   1. Array shape: row count, per-row length, and null-vs-value at every index.
 *      (`onlyHeaderText` flips a row between header and item on null-ness.)
 *   2. Any cell whose string starts with "=" is a formula and is never touched.
 *   3. Column A (index 0) is never touched — quantity formulas are parsed from it.
 *   4. MATERIAL_SECTION_ROWS / MATERIAL_HEADER_ROWS keep their column B text;
 *      it becomes the section/subcategory name and is generic industry wording.
 *   5. Only rows classified `item` are rewritten, so `subtotal` / `adjustment`
 *      classification (which reads "total "/"inflation"/"subtotal") is untouched.
 *   6. vendorPartNumber NULLABILITY is preserved per row: a row that yields a
 *      code today still yields one (a synthetic NX#### token), and a row that
 *      yields none still yields none.
 *   7. Column E stays numeric where it was numeric; prices are regenerated with
 *      the same hash helper as seed-material-catalog-demo-prices.ts so the file
 *      and the runtime price overlay agree.
 *
 * Usage:
 *   npx tsx scripts/scrub-system1-sheet.ts --snapshot   # record before-metadata
 *   npx tsx scripts/scrub-system1-sheet.ts              # rewrite the sheet
 *   npx tsx scripts/scrub-system1-sheet.ts --verify     # diff after vs snapshot
 *
 * Or all three in order: npm run scrub:system1
 */
import fs from "fs";
import path from "path";

const SHEET_PATH = path.join(process.cwd(), "lib", "estimate", "system1Sheet.json");
const SNAPSHOT_PATH = path.join(process.cwd(), ".system1-metadata-snapshot.json");

type Cell = string | number | boolean | null;

/** Mirrors MATERIAL_SECTION_ROWS in lib/estimate/system1Template.ts. */
const MATERIAL_SECTION_ROWS = new Set([
  131, 191, 200, 207, 262, 336, 422, 460, 639, 670, 708, 775, 903, 964, 975,
]);

/** Mirrors MATERIAL_HEADER_ROWS in lib/estimate/system1Template.ts. */
const MATERIAL_HEADER_ROWS = new Set([
  132, 138, 144, 157, 165, 171, 178, 208, 214, 220, 225, 231, 238, 244, 251,
  364, 375, 385, 579, 768, 896, 922, 1149,
]);

const MATERIAL_FORCED_ITEM_ROWS = new Set([454, 455, 456, 457]);

const FIRST_MATERIAL_ROW = 131;
const LAST_MATERIAL_ROW = 1154;

const VENDOR_CODE_RE = /\b[A-Z]{1,6}\d[A-Z0-9-]*\b/g;

/** Identical to demoPriceForKey in scripts/seed-material-catalog-demo-prices.ts. */
function demoPriceForKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  const min = 2.5;
  const max = 149.99;
  const ratio = (hash % 10_000) / 10_000;
  return Math.round((min + ratio * (max - min)) * 100) / 100;
}

function hashOf(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Vocabularies are strictly alphabetic (plus quotes/slashes in SIZES) so that no
// generated word can accidentally match VENDOR_CODE_RE. The only code token in a
// scrubbed row is the one this script deliberately appends.
const STYLES = [
  "Standard Response", "Quick Response", "Concealed", "Recessed Pendent",
  "Upright", "Sidewall", "Extended Coverage", "Institutional", "Dry Type",
  "Residential", "Horizontal", "Vertical",
];
const FINISHES = [
  "Brass", "Chrome", "Black", "Galvanized", "White", "Painted", "Stainless", "Bronze",
];
const TYPES = [
  "Sprinkler Head", "Pipe Nipple", "Grooved Coupling", "Threaded Elbow",
  "Threaded Tee", "Reducing Bushing", "Pipe Hanger", "Hanger Rod", "Beam Clamp",
  "Escutcheon Ring", "Butterfly Valve", "Check Valve", "Ball Valve",
  "Pressure Gauge", "Flow Switch", "Test Assembly", "Flexible Drop", "Pipe Cap",
  "Floor Flange", "Wall Sleeve", "Riser Nipple", "Drain Valve", "Sprinkler Guard",
  "Escutcheon Plate", "Inspector Test Valve", "Pipe Coupling", "Retainer Strap",
];
const SIZES = [
  '1/2"', '3/4"', '1"', '1-1/4"', '1-1/2"', '2"', '2-1/2"', '3"', '4"', '6"', '8"',
];
/** Column 7 holds a supplier name; column 13 holds free-text estimator notes. */
const SUPPLIERS = [
  "Acme Supply", "Northline Distribution", "Cardinal Wholesale",
  "Bluewater Supply", "Ridgeway Distribution",
];
const NOTES = [
  "Confirm finish before ordering.",
  "Standard lead time applies.",
  "Substitute equivalents allowed.",
  "Verify size against submittals.",
  "Priced per each unless noted.",
];

function pick<T>(pool: T[], key: string, salt: string): T {
  return pool[hashOf(`${key}:${salt}`) % pool.length];
}

function syntheticCode(key: string): string {
  return `NX${1000 + (hashOf(`${key}:code`) % 9000)}`;
}

// ---- Local mirrors of the template's derivation, so the script can check its
// ---- own output in-process rather than guessing.

function materialText(value: Cell): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed && !trimmed.startsWith("=") ? trimmed : null;
  }
  return value != null ? String(value) : null;
}

function buildRowLabel(parts: Array<string | null>) {
  const [a, b, c, d] = parts;
  if (b && c) return { label: b, description: c, detail: d };
  if (a && b) return { label: a, description: b, detail: c ?? d };
  if (c && d) return { label: c, description: d, detail: null };
  return {
    label: b ?? a ?? c ?? d ?? null,
    description: c && (b || a) ? c : d,
    detail: null,
  };
}

function extractVendorPartNumber(parts: Array<string | null>): string | null {
  const candidates = parts
    .filter((part): part is string => Boolean(part))
    .flatMap((part) => part.toUpperCase().match(VENDOR_CODE_RE) || []);
  return candidates.length === 0 ? null : candidates[candidates.length - 1];
}

function vendorPartNumberFor(values: Cell[]): string | null {
  const { label, description, detail } = buildRowLabel([
    materialText(values[0]),
    materialText(values[1]),
    materialText(values[2]),
    materialText(values[3]),
  ]);
  return extractVendorPartNumber([
    label,
    description,
    detail,
    typeof values[18] === "string" ? values[18] : null,
    typeof values[19] === "string" ? values[19] : null,
  ]);
}

/** True when the row would be classified `item` by buildMaterialCatalogRowMetadata. */
function isItemRow(rowNumber: number, values: Cell[]): boolean {
  if (rowNumber === 965) return false; // replaced by the synthetic Pump Bundle row
  const [a, b, c, d, e, f] = values;
  if (![a, b, c, d, e, f].some((v) => v !== null && v !== "")) return false;

  const bText = typeof b === "string" ? b.trim() : "";
  const cText = typeof c === "string" ? c.trim() : "";
  const onlyHeaderText = !a && !c && !d && !e && !f && Boolean(bText);

  if (MATERIAL_SECTION_ROWS.has(rowNumber) && bText) return false;
  if (
    (MATERIAL_HEADER_ROWS.has(rowNumber) || onlyHeaderText) &&
    bText &&
    !MATERIAL_FORCED_ITEM_ROWS.has(rowNumber)
  ) {
    return false;
  }

  const isSubtotal =
    bText.toLowerCase().startsWith("total ") || cText.toLowerCase().startsWith("total ");
  const isAdjustment =
    bText.toLowerCase().includes("inflation") ||
    bText.toLowerCase().includes("price increase") ||
    bText.toLowerCase().includes("subtotal");
  return !isSubtotal && !isAdjustment;
}

function isPlainString(cell: Cell): cell is string {
  return typeof cell === "string" && cell.trim() !== "" && !cell.trim().startsWith("=");
}

// ---- Modes

function loadSheet(): Cell[][] {
  return JSON.parse(fs.readFileSync(SHEET_PATH, "utf8")) as Cell[][];
}

async function snapshot() {
  const { buildMaterialCatalogRowMetadata } = await import("../lib/estimate/system1Template");
  const rows = buildMaterialCatalogRowMetadata();
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(rows, null, 0));
  console.log(`Snapshot written: ${rows.length} rows -> ${SNAPSHOT_PATH}`);
}

function scrub() {
  const sheet = loadSheet();
  let rewritten = 0;
  let pricesChanged = 0;
  let codesKept = 0;
  let sideColumns = 0;

  for (let rowNumber = FIRST_MATERIAL_ROW; rowNumber <= LAST_MATERIAL_ROW; rowNumber += 1) {
    const values = sheet[rowNumber - 1];
    if (!values) continue;

    // Columns 7 (supplier) and 13 (estimator notes) are read by nothing — not by
    // buildMaterialCatalogRowMetadata, not by the engine — but they carry real
    // vendor names and shop commentary, so scrub them on every row in the band,
    // headers included. Null-ness is preserved; only indices 0-5 affect
    // classification, and these are outside that range regardless.
    const noteKey = `row-${rowNumber}`;
    if (isPlainString(values[7])) {
      values[7] = pick(SUPPLIERS, noteKey, "supplier");
      sideColumns += 1;
    }
    if (isPlainString(values[13])) {
      values[13] = pick(NOTES, noteKey, "note13");
      sideColumns += 1;
    }

    if (!isItemRow(rowNumber, values as Cell[])) continue;

    const key = `row-${rowNumber}`;
    const hadCode = vendorPartNumberFor(values as Cell[]) !== null;

    // Columns B, C, D — rewrite plain strings only, preserving null-ness.
    if (isPlainString(values[1])) {
      values[1] = pick(SIZES, key, "b");
    }
    if (isPlainString(values[2])) {
      values[2] = `${pick(STYLES, key, "style")} ${pick(FINISHES, key, "finish")} ${pick(TYPES, key, "type")}`;
    }
    if (isPlainString(values[3])) {
      values[3] = pick(FINISHES, key, "detail");
    }
    // Free-text note columns carry real catalog wording too.
    if (isPlainString(values[18])) {
      values[18] = pick(TYPES, key, "note");
    }
    if (isPlainString(values[19])) {
      values[19] = pick(FINISHES, key, "note2");
    }

    // Re-attach a synthetic code only where the original produced one. Append to
    // the last rewritten text cell so it survives buildRowLabel's branching.
    if (hadCode) {
      const code = syntheticCode(key);
      const target = [3, 2, 1].find((idx) => isPlainString(values[idx]));
      if (target !== undefined) {
        values[target] = `${values[target] as string} ${code}`;
      } else if (isPlainString(values[18])) {
        values[18] = `${values[18] as string} ${code}`;
      }
      codesKept += 1;
    }

    // Column E — regenerate numeric prices; leave formulas and blanks alone.
    if (typeof values[4] === "number") {
      values[4] = demoPriceForKey(key);
      pricesChanged += 1;
    }

    rewritten += 1;
  }

  // Final sweep: real vendor/company names appear in scattered label columns
  // outside the ones above (e.g. column 12), which otherwise hold generic
  // structural labels worth keeping. Swap just the names, leave the rest.
  const REAL_NAMES =
    /\b(ETNA|GALLOUP|VIKING|CORE\s*MAIN|ARGCO|HILTI|TYCO|GENERAL\s*AIR)\b/gi;
  let namesSwapped = 0;
  sheet.forEach((row, rowIdx) => {
    row.forEach((cell, colIdx) => {
      if (!isPlainString(cell) || !REAL_NAMES.test(cell)) return;
      REAL_NAMES.lastIndex = 0;
      row[colIdx] = cell.replace(REAL_NAMES, () =>
        pick(SUPPLIERS, `cell-${rowIdx}-${colIdx}`, "vendorName"),
      );
      namesSwapped += 1;
    });
  });

  fs.writeFileSync(SHEET_PATH, JSON.stringify(sheet, null, 2) + "\n");
  if (namesSwapped > 0) {
    console.log(`Replaced ${namesSwapped} cell(s) naming a real vendor.`);
  }
  console.log(
    `Scrubbed ${rewritten} item rows (${pricesChanged} prices, ${codesKept} vendor codes re-attached), ` +
      `plus ${sideColumns} supplier/note cells.`,
  );
  console.log("Now run: npx tsx scripts/scrub-system1-sheet.ts --verify");
}

async function verify() {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error(`No snapshot at ${SNAPSHOT_PATH}. Run --snapshot before scrubbing.`);
  }
  const before = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as any[];
  const { buildMaterialCatalogRowMetadata } = await import("../lib/estimate/system1Template");
  const after = buildMaterialCatalogRowMetadata() as any[];

  const problems: string[] = [];
  if (before.length !== after.length) {
    problems.push(`row count changed: ${before.length} -> ${after.length}`);
  }

  // Fields that define the workbook's structure. Any drift here is a real break.
  const STRUCTURAL = [
    "rowKey", "sheetRow", "section", "subcategory", "rowType",
    "quantityCell", "unitCostCell", "formulaKey", "isQuantityDerived", "pricingMode",
  ];

  const n = Math.min(before.length, after.length);
  for (let i = 0; i < n; i += 1) {
    for (const field of STRUCTURAL) {
      if (JSON.stringify(before[i][field]) !== JSON.stringify(after[i][field])) {
        problems.push(
          `[${before[i].rowKey}] ${field}: ${JSON.stringify(before[i][field])} -> ${JSON.stringify(after[i][field])}`,
        );
      }
    }
    const hadVpn = before[i].vendorPartNumber != null;
    const hasVpn = after[i].vendorPartNumber != null;
    if (hadVpn !== hasVpn) {
      problems.push(
        `[${before[i].rowKey}] vendorPartNumber nullability: ${hadVpn} -> ${hasVpn}`,
      );
    }
    const hadCost = before[i].defaultUnitCost != null;
    const hasCost = after[i].defaultUnitCost != null;
    if (hadCost !== hasCost) {
      problems.push(
        `[${before[i].rowKey}] defaultUnitCost nullability: ${hadCost} -> ${hasCost}`,
      );
    }
  }

  if (problems.length > 0) {
    console.error(`❌ ${problems.length} structural difference(s):`);
    problems.slice(0, 40).forEach((p) => console.error("   " + p));
    if (problems.length > 40) console.error(`   ... and ${problems.length - 40} more`);
    process.exitCode = 1;
    return;
  }

  const textChanged = after.filter(
    (r, i) =>
      r.description !== before[i].description ||
      r.label !== before[i].label ||
      r.defaultUnitCost !== before[i].defaultUnitCost,
  ).length;
  console.log(
    `✅ Structure identical across ${n} rows. ${textChanged} rows have new text/pricing.`,
  );
}

async function main() {
  const mode = process.argv[2];
  if (mode === "--snapshot") return snapshot();
  if (mode === "--verify") return verify();
  return scrub();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
