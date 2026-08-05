/**
 * Backfill VendorLeadTimeSample from history so vendor averages start warm instead
 * of cold.
 *
 * The only historical receipt clock that exists is the inventory ledger: receiving an
 * inventory PO writes an InventoryMovement with contextType='ORDER' and
 * contextId=<purchaseOrder.id>. Pairing the earliest such movement per (PO, part)
 * with PurchaseOrder.sentAt gives one observed order->receipt duration.
 *
 * Job POs have no historical receipt timestamp (mark-received only ever set a
 * boolean), so they cannot be backfilled — they start producing samples from now on
 * via the hook in app/api/admin/orders/mark-received/route.ts.
 *
 * Read-only unless --apply is passed.
 *
 *   npx tsx --tsconfig scripts/tsconfig.rbac.json scripts/backfill-vendor-lead-times.ts
 *   npx tsx --tsconfig scripts/tsconfig.rbac.json scripts/backfill-vendor-lead-times.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { normalizeSupplierKey } from "@/lib/suppliers";
import {
  isPlausibleLeadTime,
  recomputeVendorLeadTimeRollup,
  trimmedMean,
} from "@/lib/vendorLeadTime";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

type Row = {
  purchase_order_id: string;
  part_id: string;
  received_at: Date;
};

async function main() {
  const target = (process.env.DATABASE_URL || "").replace(/\/\/[^@]*@/, "//***@");
  console.log(`Target: ${target}`);
  console.log(APPLY ? "Mode: APPLY\n" : "Mode: DRY RUN (pass --apply to write)\n");

  // Earliest ORDER-context receipt per (PO, part) — first arrival stops the clock.
  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT context_id AS purchase_order_id, part_id, MIN(created_at) AS received_at
    FROM inventory_movements
    WHERE context_type = 'ORDER' AND quantity_delta > 0 AND context_id IS NOT NULL
    GROUP BY context_id, part_id
  `);
  console.log(`Candidate (PO, part) receipts from the ledger: ${rows.length}`);

  const orders = await prisma.purchaseOrder.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.purchase_order_id))] } },
    select: { id: true, orderNumber: true, sentAt: true, supplier: true, orderKind: true },
  });
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const parts = await prisma.part.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.part_id))] } },
    select: { id: true, pn: true },
  });
  const partById = new Map(parts.map((p) => [p.id, p]));

  const drafts: Array<{
    vendorKey: string;
    purchaseOrderId: string;
    orderNumber: string | null;
    partNumber: string;
    partId: string;
    orderKind: string;
    sentAt: Date;
    receivedAt: Date;
    leadTimeDays: number;
  }> = [];
  let skipped = 0;

  for (const row of rows) {
    const order = orderById.get(row.purchase_order_id);
    const part = partById.get(row.part_id);
    if (!order || !part) {
      skipped += 1;
      continue;
    }
    const vendorKey = normalizeSupplierKey(order.supplier ?? "");
    if (!vendorKey || vendorKey === "UNASSIGNED") {
      skipped += 1;
      continue;
    }
    const receivedAt = new Date(row.received_at);
    const leadTimeDays = (receivedAt.getTime() - order.sentAt.getTime()) / 86_400_000;
    if (!isPlausibleLeadTime(leadTimeDays)) {
      skipped += 1;
      continue;
    }
    drafts.push({
      vendorKey,
      purchaseOrderId: order.id,
      orderNumber: order.orderNumber,
      partNumber: part.pn,
      partId: part.id,
      orderKind: order.orderKind,
      sentAt: order.sentAt,
      receivedAt,
      leadTimeDays,
    });
  }

  console.log(`Usable samples: ${drafts.length} (skipped ${skipped})\n`);

  const byVendor = new Map<string, number[]>();
  for (const d of drafts) {
    const list = byVendor.get(d.vendorKey);
    if (list) list.push(d.leadTimeDays);
    else byVendor.set(d.vendorKey, [d.leadTimeDays]);
  }

  console.log("Derived lead time by vendor:");
  console.log("  vendor           samples  trimmed avg (days)");
  for (const [vendor, values] of [...byVendor.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const avg = trimmedMean(values);
    console.log(
      `  ${vendor.padEnd(16)} ${String(values.length).padEnd(8)} ${avg === null ? "-" : avg.toFixed(1)}`,
    );
  }

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to persist.");
    return;
  }

  let written = 0;
  for (const d of drafts) {
    await prisma.vendorLeadTimeSample.upsert({
      where: {
        purchaseOrderId_partNumber: {
          purchaseOrderId: d.purchaseOrderId,
          partNumber: d.partNumber,
        },
      },
      update: { receivedAt: d.receivedAt, leadTimeDays: d.leadTimeDays },
      create: d,
    });
    written += 1;
  }
  for (const vendor of byVendor.keys()) {
    await recomputeVendorLeadTimeRollup(vendor);
  }
  console.log(`\nWrote ${written} sample(s); recomputed ${byVendor.size} vendor rollup(s).`);
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
