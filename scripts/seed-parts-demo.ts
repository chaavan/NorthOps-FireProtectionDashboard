/**
 * Seed a synthetic parts catalog plus enough movement and purchase-order history
 * for the inventory levels engine to have something to work with.
 *
 * Without demand history, lib/inventoryLevels/usage.ts sees zero usage and every
 * part classifies as DON'T STOCK, which makes the Inventory page look broken in a
 * demo. This generates ~300 parts and roughly six months of JOB-context pulls so
 * Min On Hand / Order Min suggestions, the vendor lead-time clock, and the
 * On Order badges all have real inputs.
 *
 * Everything is invented: part numbers, descriptions, costs, and supplier names.
 * All values derive from a deterministic string hash, so re-running produces the
 * same catalog rather than drifting.
 *
 *   PARTS_DEMO_SEED_CONFIRM=I_UNDERSTAND npm run db:seed-parts-demo
 *   PARTS_DEMO_SEED_CONFIRM=I_UNDERSTAND npm run db:seed-parts-demo -- --clean
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { MovementType } from "@prisma/client";
import { INVENTORY_DATA_START } from "../lib/inventoryLevels/usage";

/** Marks every row this script creates, so --clean never touches real data. */
const SEED_MARK = "DEMO-SEED";
const PART_COUNT = 300;
/** Company/warehouse codes the rest of the app filters on. */
const COMPANY = 1;
const WAREHOUSE = 1;

const SUPPLIERS = [
  "Acme Supply",
  "Northline Distribution",
  "Cardinal Wholesale",
  "Bluewater Supply",
  "Ridgeway Distribution",
];

const CATEGORIES = [
  { prefix: "SPR", noun: "Sprinkler Head", units: "EA", type: 45 },
  { prefix: "FIT", noun: "Pipe Fitting", units: "EA", type: 13 },
  { prefix: "CPL", noun: "Grooved Coupling", units: "EA", type: 28 },
  { prefix: "HGR", noun: "Pipe Hanger", units: "EA", type: 31 },
  { prefix: "VLV", noun: "Valve", units: "EA", type: 22 },
  { prefix: "PIP", noun: "Black Pipe", units: "FT", type: 10 },
  { prefix: "ESC", noun: "Escutcheon", units: "EA", type: 46 },
  { prefix: "GAU", noun: "Pressure Gauge", units: "EA", type: 24 },
];

const STYLES = [
  "Standard Response", "Quick Response", "Concealed", "Recessed",
  "Upright", "Sidewall", "Extended Coverage", "Threaded", "Grooved", "Plain End",
];
const FINISHES = ["Brass", "Chrome", "Black", "Galvanized", "White", "Bronze"];
const SIZES = ['1/2"', '3/4"', '1"', '1-1/4"', '1-1/2"', '2"', '2-1/2"', '3"', '4"', '6"'];

function hashOf(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pick<T>(pool: T[], key: string, salt: string): T {
  return pool[hashOf(`${key}:${salt}`) % pool.length];
}

/** Deterministic float in [0,1) from a key. */
function ratio(key: string, salt: string): number {
  return (hashOf(`${key}:${salt}`) % 10_000) / 10_000;
}

type SeedPart = {
  pn: string;
  nomenclature: string;
  cost: number;
  vendor: string;
  units: string;
  type: number;
  reorderPoint: number | null;
  orderMinimum: number | null;
  doNotStock: boolean;
  quantity: number;
  /** Average units pulled per week — drives the generated movement history. */
  weeklyDemand: number;
};

function buildParts(): SeedPart[] {
  const parts: SeedPart[] = [];
  for (let i = 0; i < PART_COUNT; i++) {
    const key = `part-${i}`;
    const cat = CATEGORIES[i % CATEGORIES.length];
    const size = pick(SIZES, key, "size");
    const style = pick(STYLES, key, "style");
    const finish = pick(FINISHES, key, "finish");
    const pn = `${cat.prefix}${String(1000 + i).padStart(5, "0")}`;
    const cost = Math.round((2.5 + ratio(key, "cost") * 147.5) * 100) / 100;

    // A long tail of slow movers plus a smaller set of true stock items — the
    // shape the levels engine is designed to tell apart.
    const demandRoll = ratio(key, "demand");
    const weeklyDemand =
      demandRoll < 0.35 ? 0 :
      demandRoll < 0.6 ? 1 + Math.floor(ratio(key, "d2") * 4) :
      demandRoll < 0.85 ? 5 + Math.floor(ratio(key, "d3") * 25) :
      40 + Math.floor(ratio(key, "d4") * 160);

    // Leave most levels blank so `npm run db:suggest-levels` has work to do; a
    // minority are "hand-set" so its calibration pass has something to fit against.
    const handSet = ratio(key, "handset") < 0.3 && weeklyDemand > 0;

    parts.push({
      pn,
      nomenclature: `${size} ${style} ${finish} ${cat.noun}`,
      cost,
      vendor: pick(SUPPLIERS, key, "vendor"),
      units: cat.units,
      type: cat.type,
      reorderPoint: handSet ? Math.max(1, Math.round(weeklyDemand * 2)) : null,
      orderMinimum: handSet ? Math.max(1, Math.round(weeklyDemand * 8)) : null,
      doNotStock: weeklyDemand === 0 && ratio(key, "dns") < 0.4,
      quantity: weeklyDemand === 0
        ? Math.floor(ratio(key, "qty") * 20)
        : Math.round(weeklyDemand * (1 + ratio(key, "qty") * 6)),
      weeklyDemand,
    });
  }
  return parts;
}

async function clean(): Promise<number> {
  const demoParts = await prisma.part.findMany({
    where: { status: SEED_MARK },
    select: { id: true },
  });
  if (demoParts.length > 0) {
    // Movements cascade with the part.
    await prisma.part.deleteMany({ where: { id: { in: demoParts.map((p) => p.id) } } });
  }
  await prisma.purchaseOrder.deleteMany({ where: { sentBy: SEED_MARK } });
  await prisma.vendorLeadTimeSample.deleteMany({ where: { orderNumber: { startsWith: "DEMO-" } } });
  return demoParts.length;
}

async function seed() {
  const removed = await clean();
  if (removed > 0) console.log(`Removed ${removed} prior demo part(s) before reseeding.`);

  const specs = buildParts();
  const now = Date.now();
  const startMs = Math.max(INVENTORY_DATA_START.getTime(), now - 182 * 86_400_000);
  const weeks = Math.max(1, Math.floor((now - startMs) / (7 * 86_400_000)));

  let movementCount = 0;
  let poCount = 0;

  // Parts first, in batches — 300 individual round-trips is needlessly slow.
  const BATCH = 50;
  for (let i = 0; i < specs.length; i += BATCH) {
    const batch = specs.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((p) =>
        prisma.part.create({
          data: {
            company: COMPANY,
            pn: p.pn,
            whse: WAREHOUSE,
            nomenclature: p.nomenclature,
            cost: p.cost,
            type: p.type,
            units: p.units,
            vendor: p.vendor,
            status: SEED_MARK,
            quantity: BigInt(p.quantity),
            reorderPoint: p.reorderPoint,
            orderMinimum: p.orderMinimum,
            doNotStock: p.doNotStock,
            priceUpdatedAt: new Date(now - Math.floor(ratio(p.pn, "priced") * 120) * 86_400_000),
          },
        }),
      ),
    );
  }
  console.log(`  ✓ ${specs.length} parts`);

  const created = await prisma.part.findMany({
    where: { status: SEED_MARK },
    select: { id: true, pn: true, quantity: true },
  });
  const idByPn = new Map(created.map((p) => [p.pn, p.id]));

  // Weekly JOB-context pulls. The levels engine reads signed deltas on
  // context_type='JOB', so this is what produces observable demand.
  for (const p of specs) {
    if (p.weeklyDemand === 0) continue;
    const partId = idByPn.get(p.pn);
    if (!partId) continue;

    const rows: Array<{
      partId: string;
      type: MovementType;
      quantityDelta: number;
      quantityBefore: bigint;
      quantityAfter: bigint;
      contextType: string;
      contextId: string;
      note: string;
      createdAt: Date;
    }> = [];

    // Walk the balance backwards from today's quantity so before/after stay coherent.
    let running = BigInt(p.quantity);
    for (let w = 0; w < weeks; w++) {
      // Vary week to week around the mean, so stddev (and therefore safety stock)
      // is non-trivial rather than a flat line.
      const jitter = 0.4 + ratio(`${p.pn}:w${w}`, "jitter") * 1.2;
      const qty = Math.max(1, Math.round(p.weeklyDemand * jitter));
      const before = running + BigInt(qty);
      rows.push({
        partId,
        type: MovementType.PULL,
        quantityDelta: -qty,
        quantityBefore: before,
        quantityAfter: running,
        contextType: "JOB",
        contextId: `DEMO-JOB-${1000 + (w % 40)}`,
        note: `Demo pull | week ${w + 1}`,
        createdAt: new Date(startMs + w * 7 * 86_400_000),
      });
      running = before;
      movementCount++;
    }
    await prisma.inventoryMovement.createMany({ data: rows });
  }
  console.log(`  ✓ ${movementCount} inventory movements`);

  // A handful of inventory POs, some fully received and some still outstanding,
  // so the On Order badges and the lead-time clock have inputs.
  const orderable = specs.filter((p) => p.weeklyDemand > 0).slice(0, 24);
  for (let i = 0; i < orderable.length; i++) {
    const p = orderable[i];
    const sentDaysAgo = 5 + Math.floor(ratio(p.pn, "sent") * 60);
    const ordered = Math.max(1, Math.round(p.weeklyDemand * 4));
    // Two thirds settled, one third still open.
    const received = i % 3 === 0 ? 0 : ordered;
    await prisma.purchaseOrder.create({
      data: {
        orderNumber: `DEMO-${String(9000 + i)}`,
        vendorPoLabel: `Inventory Replenishment`,
        supplier: p.vendor,
        orderKind: "INVENTORY",
        sentBy: SEED_MARK,
        sentAt: new Date(now - sentDaysAgo * 86_400_000),
        sendStatus: "SENT",
        items: [
          {
            jobNumber: "INVENTORY",
            jobName: "Inventory Replenishment",
            listNumber: "STOCK",
            partNumber: p.pn,
            description: p.nomenclature,
            quantityOrdered: ordered,
            quantityReceived: received,
            fullyReceived: received >= ordered,
            vendor: p.vendor,
          },
        ],
      },
    });
    poCount++;
  }
  console.log(`  ✓ ${poCount} purchase orders`);

  const stocked = specs.filter((p) => p.weeklyDemand > 0).length;
  console.log("\nDemo parts data seeded:");
  console.log(`  parts:        ${specs.length} (${stocked} with demand history)`);
  console.log(`  movements:    ${movementCount} across ~${weeks} weeks`);
  console.log(`  purchase POs: ${poCount} (a third still outstanding)`);
  console.log(`  hand-set levels: ${specs.filter((p) => p.reorderPoint !== null).length}`);
  console.log("\nNext: npm run db:suggest-levels   (dry run — reports suggested Min/Order Min)");
}

async function main() {
  if (process.env.PARTS_DEMO_SEED_CONFIRM !== "I_UNDERSTAND") {
    throw new Error(
      "Refusing to run: set PARTS_DEMO_SEED_CONFIRM=I_UNDERSTAND (this writes to the database in DATABASE_URL)",
    );
  }

  if (process.argv.includes("--clean")) {
    const removed = await clean();
    console.log(`Removed ${removed} demo part(s), their movements, and demo POs.`);
  } else {
    await seed();
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
