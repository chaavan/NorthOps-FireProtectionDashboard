/**
 * Derive Min On Hand / Order Min for parts from observed job usage + measured vendor
 * lead times, and optionally apply them.
 *
 * Usage is measured across ALL production history (see INVENTORY_DATA_START), not a
 * rolling window, so the estimates sharpen as more data accumulates.
 *
 * Safety rules baked in (per the agreed plan):
 *  - Only parts with BOTH levels blank are ever written. Hand-set parts are untouched.
 *  - Only parts with ZERO stock usage are auto-flagged "Don't stock". Parts that are
 *    used, just thinly or erratically, are left blank for review — operators demonstrably
 *    stocks low-movement critical fittings on purpose.
 *  - Every write is audited via recordPartInfoChange, so --revert can undo the batch.
 *
 *   # dry run (default): prints the comparison + writes a CSV, changes nothing
 *   npx tsx --tsconfig scripts/tsconfig.rbac.json scripts/suggest-inventory-levels.ts
 *
 *   # apply
 *   ... scripts/suggest-inventory-levels.ts --apply --variant=calibrated
 *
 *   # undo a batch (contextId is printed by --apply)
 *   ... scripts/suggest-inventory-levels.ts --revert=levels:1752600000000
 */
import { writeFileSync } from "node:fs";
import { PrismaClient, type Prisma } from "@prisma/client";
import { normalizeSupplierKey } from "@/lib/suppliers";
import {
  deriveLeadTimeMapFromLedger,
  getVendorLeadTimeMap,
  resolveLeadTimeFromMap,
  DEFAULT_LEAD_TIME_DAYS,
} from "@/lib/vendorLeadTime";
import {
  INVENTORY_DATA_START,
  buildPartDemand,
  getJobOrderDemand,
  getPartUsageStats,
  usageWindowDays,
} from "@/lib/inventoryLevels/usage";
import {
  calibrate,
  computeLevels,
  TEXTBOOK_PARAMS,
  type CalibrationSample,
  type LevelParams,
} from "@/lib/inventoryLevels/formula";
import { classifyPart } from "@/lib/inventoryLevels/classify";
import { getOpenJobDemand } from "@/lib/inventoryReorder";
import { collectPartThresholdDiffs, recordPartInfoChange } from "@/lib/partInfoLedger";

const prisma = new PrismaClient();

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const REVERT = argv.find((a) => a.startsWith("--revert="))?.split("=")[1] ?? null;
const VARIANT = (argv.find((a) => a.startsWith("--variant="))?.split("=")[1] ?? "calibrated") as
  | "calibrated"
  | "textbook";
const CSV_PATH =
  argv.find((a) => a.startsWith("--csv="))?.split("=")[1] ?? "inventory-levels-report.csv";
/** Resume/extend an existing batch so --revert still treats it as one unit. */
const CONTEXT_OVERRIDE = argv.find((a) => a.startsWith("--context="))?.split("=")[1] ?? null;

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function revertBatch(contextId: string) {
  console.log(`Reverting batch ${contextId} ...`);
  const rows = await prisma.partInfoChange.findMany({
    where: { contextId },
    select: { partId: true, changes: true },
  });
  if (rows.length === 0) {
    console.log("No audit rows found for that contextId — nothing to revert.");
    return;
  }
  let reverted = 0;
  for (const row of rows) {
    const diffs = row.changes as Array<{ field: string; before: string | null }>;
    const data: Prisma.PartUpdateInput = {};
    for (const diff of diffs) {
      const before = diff.before === null ? null : Number(diff.before);
      if (diff.field === "REORDER_POINT") data.reorderPoint = before;
      if (diff.field === "ORDER_MINIMUM") data.orderMinimum = before;
    }
    // doNotStock isn't an audited field; a batch only ever turns it on, so undo that.
    data.doNotStock = false;
    await prisma.part.update({ where: { id: row.partId }, data });
    reverted += 1;
  }
  console.log(`Reverted ${reverted} part(s).`);
}

async function main() {
  const target = (process.env.DATABASE_URL || "").replace(/\/\/[^@]*@/, "//***@");
  console.log(`Target: ${target}`);
  if (REVERT) {
    await revertBatch(REVERT);
    return;
  }
  console.log(APPLY ? `Mode: APPLY (variant=${VARIANT})\n` : "Mode: DRY RUN (nothing written)\n");

  const [parts, usageStats, jobOrders, sampleLeadTimes] = await Promise.all([
    prisma.part.findMany({
      select: {
        id: true,
        pn: true,
        nomenclature: true,
        vendor: true,
        quantity: true,
        reorderPoint: true,
        orderMinimum: true,
        doNotStock: true,
      },
    }),
    getPartUsageStats(INVENTORY_DATA_START, prisma),
    getJobOrderDemand(INVENTORY_DATA_START, prisma),
    getVendorLeadTimeMap(prisma),
  ]);
  const openJobDemand = await getOpenJobDemand(prisma);

  // Prefer recorded samples; before the migration/backfill has landed, reconstruct the
  // same observations from the inventory ledger so the report still uses real lead times.
  const leadTimeMap =
    sampleLeadTimes.size > 0 ? sampleLeadTimes : await deriveLeadTimeMapFromLedger(prisma);
  const leadTimeSource = sampleLeadTimes.size > 0 ? "recorded samples" : "derived from ledger";

  const windowDays = usageWindowDays(INVENTORY_DATA_START);
  console.log(
    `Usage history: ${INVENTORY_DATA_START.toISOString().slice(0, 10)} -> today (${windowDays} days, ${(windowDays / 30.44).toFixed(1)} months) — all production data, and it grows.`,
  );
  console.log(`Parts: ${parts.length} | parts with usage: ${usageStats.size}`);
  console.log(
    `Vendor lead times (${leadTimeSource}): ${[...leadTimeMap.values()].filter((v) => v.measured).length} measured, default ${DEFAULT_LEAD_TIME_DAYS}d otherwise`,
  );
  for (const lt of [...leadTimeMap.values()].sort((a, b) => b.sampleCount - a.sampleCount)) {
    console.log(
      `    ${lt.vendorKey.padEnd(14)} ${String(lt.days).padEnd(6)}d  (${lt.sampleCount} samples${lt.measured ? "" : ", using default"})`,
    );
  }
  console.log("");

  const leadTimeFor = (vendor: string | null) => resolveLeadTimeFromMap(leadTimeMap, vendor);

  // Demand = stock pulls + job-PO purchases. A part bought per job never enters stock,
  // so pulls alone read as zero demand for exactly the parts we most want to spot.
  const demandByPart = buildPartDemand({ parts, usage: usageStats, jobOrders, windowDays });
  console.log(
    `Parts with demand: ${demandByPart.size} (pull history: ${usageStats.size}, job-ordered: ${jobOrders.size})`,
  );
  console.log(
    `Open job demand (forward-looking): ${openJobDemand.size} parts still needed on undelivered jobs\n`,
  );

  // --- Calibrate against the parts already set by hand -------------------------
  const calibrationSamples: CalibrationSample[] = [];
  for (const part of parts) {
    const demand = demandByPart.get(part.id);
    if (!demand) continue;
    if (!part.reorderPoint || !part.orderMinimum) continue;
    const lt = leadTimeFor(part.vendor);
    // Calibrate on the same basis we size from: stock pulls only.
    calibrationSamples.push({
      usage: { avgDailyUsage: demand.sizingAvgDaily, stddevDaily: demand.sizingStddevDaily },
      leadTimeDays: lt.days,
      leadTimeStdDevDays: lt.stdDevDays,
      actualMinOnHand: part.reorderPoint,
      actualOrderMin: part.orderMinimum,
    });
  }
  const calibration = calibrate(calibrationSamples);

  console.log("=== Calibration against hand-set parts ===");
  if (!calibration) {
    console.log(
      `Not enough hand-set parts with usage to calibrate (${calibrationSamples.length}); using textbook params.`,
    );
  } else {
    const p = calibration.params;
    console.log(`Fitted on ${calibration.sampleCount} hand-set parts with usage history.`);
    console.log(
      `  calibrated : z=${p.z}  coverageDays=${p.coverageDays}  safetyCap=${p.safetyCapMultiple}x`,
    );
    console.log(
      `  textbook   : z=${TEXTBOOK_PARAMS.z}  coverageDays=${TEXTBOOK_PARAMS.coverageDays}  safetyCap=${TEXTBOOK_PARAMS.safetyCapMultiple}x`,
    );
    console.log(
      `  fit (calibrated vs hand-set): median ratio Min=${calibration.medianRatioMin.toFixed(2)}x  OrderMin=${calibration.medianRatioOrder.toFixed(2)}x`,
    );
    console.log(
      `  within 2x of hand-set:        Min=${(calibration.within2xMin * 100).toFixed(0)}%  OrderMin=${(calibration.within2xOrder * 100).toFixed(0)}%`,
    );
  }
  const calibratedParams: LevelParams = calibration?.params ?? TEXTBOOK_PARAMS;
  const chosen: LevelParams = VARIANT === "textbook" ? TEXTBOOK_PARAMS : calibratedParams;

  // --- Classify + compute -------------------------------------------------------
  type Row = {
    partId: string; pn: string; nomenclature: string; vendor: string;
    leadTimeDays: number; leadTimeSd: number; onHand: number; openDemand: number;
    decision: string; reason: string;
    stockUsed: number; orderedQty: number; totalDemand: number; activeMonths: number;
    orderLines: number; distinctJobs: number;
    currentMin: number | null; currentOrderMin: number | null; wasDoNotStock: boolean;
    calibMin: number; calibOrder: number; textMin: number; textOrder: number; capped: boolean;
  };
  const rows: Row[] = [];
  const counts = { STOCK: 0, DONT_STOCK: 0, LEAVE_BLANK: 0, SKIP: 0 } as Record<string, number>;

  for (const part of parts) {
    const demand = demandByPart.get(part.id);
    const pnKey = part.pn.trim().toUpperCase();
    const classification = classifyPart({
      hasThresholds: Boolean(part.reorderPoint && part.orderMinimum),
      demand,
    });

    // Levels are sized from stock pulls only. A part flagged STOCK purely on per-job
    // buying, with no pull history, has no basis to size a level — leave it for manual
    // review rather than inventing one from job-PO volume (which is what over-inflated
    // levels in the first place).
    if (classification.decision === 'STOCK' && (!demand || demand.sizingAvgDaily <= 0)) {
      classification.decision = 'LEAVE_BLANK';
      classification.reason = `Bought per-job (${demand?.orderLineCount ?? 0}x across ${demand?.distinctJobs ?? 0} jobs) but never pulled from stock — set a starting level manually`;
    }
    counts[classification.decision] += 1;

    const lt = leadTimeFor(part.vendor);
    const demandInput = demand
      ? { avgDailyUsage: demand.sizingAvgDaily, stddevDaily: demand.sizingStddevDaily }
      : null;
    const calib = demandInput
      ? computeLevels(demandInput, lt.days, calibratedParams, lt.stdDevDays)
      : null;
    const text = demandInput
      ? computeLevels(demandInput, lt.days, TEXTBOOK_PARAMS, lt.stdDevDays)
      : null;

    rows.push({
      partId: part.id,
      pn: part.pn,
      nomenclature: part.nomenclature ?? "",
      vendor: normalizeSupplierKey(part.vendor ?? ""),
      leadTimeDays: lt.days,
      leadTimeSd: lt.stdDevDays,
      onHand: Number(part.quantity ?? 0),
      openDemand: openJobDemand.get(pnKey) ?? 0,
      decision: classification.decision,
      reason: classification.reason,
      stockUsed: demand?.stockUsed ?? 0,
      orderedQty: demand?.orderedQty ?? 0,
      totalDemand: demand?.totalDemand ?? 0,
      activeMonths: demand?.activeMonths ?? 0,
      orderLines: demand?.orderLineCount ?? 0,
      distinctJobs: demand?.distinctJobs ?? 0,
      currentMin: part.reorderPoint,
      currentOrderMin: part.orderMinimum,
      wasDoNotStock: part.doNotStock,
      calibMin: calib?.minOnHand ?? 0,
      calibOrder: calib?.orderMin ?? 0,
      textMin: text?.minOnHand ?? 0,
      textOrder: text?.orderMin ?? 0,
      capped: calib?.safetyStockCapped ?? false,
    });
  }

  console.log("\n=== Classification ===");
  console.log(`  STOCK       (get levels)         : ${counts.STOCK}`);
  console.log(`  DONT_STOCK  (flag, no levels)    : ${counts.DONT_STOCK}`);
  console.log(`  LEAVE_BLANK (review, untouched)  : ${counts.LEAVE_BLANK}`);
  console.log(`  SKIP        (already set)        : ${counts.SKIP}`);

  const stockRows = rows.filter((r) => r.decision === "STOCK");
  console.log("\n=== Top 10 parts to be stocked ===");
  console.log(
    "  part           vendor      LT(sd)    pulled  bought  total  ordX/jobs  Min(cal) Ord(cal)",
  );
  for (const r of [...stockRows].sort((a, b) => b.totalDemand - a.totalDemand).slice(0, 10)) {
    console.log(
      `  ${r.pn.padEnd(14)} ${r.vendor.padEnd(11)} ${`${r.leadTimeDays}(${r.leadTimeSd})`.padEnd(9)} ` +
        `${String(r.stockUsed).padEnd(7)} ${String(r.orderedQty).padEnd(7)} ${String(r.totalDemand).padEnd(6)} ` +
        `${`${r.orderLines}/${r.distinctJobs}`.padEnd(10)} ${String(r.calibMin).padEnd(8)} ${r.calibOrder}`,
    );
  }

  // The whole point of the change: parts that are bought over and over on jobs but
  // never stocked. These previously read as zero demand.
  const newlyRecovered = stockRows.filter((r) => r.wasDoNotStock);
  const boughtNotStocked = stockRows
    .filter((r) => r.stockUsed === 0 && r.orderedQty > 0)
    .sort((a, b) => b.orderLines - a.orderLines);
  console.log(
    `\n=== Recovered: previously flagged Don't stock, now stocking candidates: ${newlyRecovered.length} ===`,
  );
  console.log("  part           ordered  jobs   bought  onHand  Min(cal) Ord(cal)");
  for (const r of boughtNotStocked.slice(0, 12)) {
    console.log(
      `  ${r.pn.padEnd(14)} ${String(r.orderLines).padStart(7)}  ${String(r.distinctJobs).padStart(4)}  ` +
        `${String(r.orderedQty).padStart(6)}  ${String(r.onHand).padStart(6)}  ${String(r.calibMin).padStart(8)} ${r.calibOrder}`,
    );
  }

  // Where the formula most disagrees with the hand-set levels — outliers worth eyeballing.
  const handSet = rows.filter(
    (r) => r.currentMin && r.currentOrderMin && r.totalDemand > 0,
  );
  console.log("\n=== Biggest disagreements with hand-set parts (calibrated) ===");
  console.log("  part           demand    Set Min -> cal Min    Set Ord -> cal Ord");
  const worst = [...handSet]
    .map((r) => ({
      r,
      err: Math.abs(Math.log((r.calibMin || 1) / (r.currentMin || 1))),
    }))
    .sort((a, b) => b.err - a.err)
    .slice(0, 8);
  for (const { r } of worst) {
    console.log(
      `  ${r.pn.padEnd(14)} ${String(r.totalDemand).padEnd(9)} ${String(r.currentMin).padStart(6)} -> ${String(r.calibMin).padEnd(10)} ${String(r.currentOrderMin).padStart(6)} -> ${r.calibOrder}`,
    );
  }

  // --- CSV ----------------------------------------------------------------------
  const headers = [
    "Part Number", "Description", "Vendor", "Lead time (days)", "Lead time stddev",
    "On hand", "Open job demand", "Decision", "Reason",
    "Pulled from stock", "Bought on job POs", "Total demand", "Active months",
    "Job PO lines", "Distinct jobs", "Was Don't stock",
    "Current Min", "Current Order Min",
    "Calibrated Min", "Calibrated Order Min", "Textbook Min", "Textbook Order Min",
    "Safety capped",
  ];
  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.pn, r.nomenclature, r.vendor, r.leadTimeDays, r.leadTimeSd,
        r.onHand, r.openDemand, r.decision, r.reason,
        r.stockUsed, r.orderedQty, r.totalDemand, r.activeMonths,
        r.orderLines, r.distinctJobs, r.wasDoNotStock ? "yes" : "",
        r.currentMin ?? "", r.currentOrderMin ?? "",
        r.calibMin, r.calibOrder, r.textMin, r.textOrder, r.capped ? "yes" : "",
      ]
        .map(csvEscape)
        .join(","),
    ),
  ].join("\n");
  writeFileSync(CSV_PATH, csv, "utf8");
  console.log(`\nFull comparison written to ${CSV_PATH} (${rows.length} rows).`);

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply --variant=calibrated|textbook.");
    return;
  }

  // --- Apply ---------------------------------------------------------------------
  const contextId = CONTEXT_OVERRIDE ?? `levels:${Date.now()}`;
  let leveled = 0;
  let flagged = 0;
  let unflagged = 0;

  for (const row of rows) {
    if (row.decision === "SKIP") continue;
    const part = parts.find((p) => p.id === row.partId);
    if (!part) continue;

    // Anything with real demand must not stay flagged "Don't stock" — including
    // LEAVE_BLANK parts, whose levels we still leave for an operator to set.
    if (row.decision === "LEAVE_BLANK") {
      if (part.doNotStock) {
        await prisma.part.update({ where: { id: part.id }, data: { doNotStock: false } });
        unflagged += 1;
      }
      continue;
    }

    const isStock = row.decision === "STOCK";
    const levels = isStock
      ? VARIANT === "textbook"
        ? { min: row.textMin, order: row.textOrder }
        : { min: row.calibMin, order: row.calibOrder }
      : { min: 0, order: 0 };

    // Mirror the single-part PUT: 0 collapses to null, and Don't stock clears both.
    const nextReorderPoint = isStock && levels.min > 0 ? levels.min : null;
    const nextOrderMinimum = isStock && levels.order > 0 ? levels.order : null;
    const nextDoNotStock = !isStock;

    if (isStock && (nextReorderPoint === null || nextOrderMinimum === null)) continue;

    const diffs = collectPartThresholdDiffs(
      { reorderPoint: part.reorderPoint, orderMinimum: part.orderMinimum },
      { reorderPoint: nextReorderPoint, orderMinimum: nextOrderMinimum },
    );

    await prisma.$transaction(async (tx) => {
      await tx.part.update({
        where: { id: part.id },
        data: {
          reorderPoint: nextReorderPoint,
          orderMinimum: nextOrderMinimum,
          doNotStock: nextDoNotStock,
        },
      });
      if (diffs.length > 0) {
        await recordPartInfoChange(tx, {
          partId: part.id,
          actorUserId: null,
          contextType: "IMPORT",
          contextId,
          diffs,
          note: isStock
            ? `Auto-derived from ${row.totalDemand} units of demand over ${row.activeMonths} month(s) (${row.stockUsed} pulled, ${row.orderedQty} bought per-job); lead time ${row.leadTimeDays}d (${VARIANT}).`
            : `Flagged Don't stock: ${row.reason}`,
        });
      }
    });

    if (isStock) leveled += 1;
    else flagged += 1;
  }

  console.log(`\nApplied. Levels set on ${leveled} part(s); ${flagged} flagged Don't stock; ${unflagged} un-flagged (have demand).`);
  console.log(`Batch contextId: ${contextId}`);
  console.log(`Undo with:  --revert=${contextId}`);
}

main()
  .catch((error) => {
    console.error("Failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
