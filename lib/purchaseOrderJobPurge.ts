import type { Prisma } from '@prisma/client';

type PoTx = {
  purchaseOrder: {
    findMany: (args: {
      select: { id: true; items: true };
    }) => Promise<Array<{ id: string; items: Prisma.JsonValue }>>;
    update: (args: {
      where: { id: string };
      data: { items: Prisma.InputJsonValue };
    }) => Promise<unknown>;
    delete: (args: { where: { id: string } }) => Promise<unknown>;
  };
};

/**
 * Remove or trim purchase order JSON line items that reference a job (and optionally one list).
 * When listScope is null, every line for jobNumber is removed. Otherwise only lines matching
 * that list (missing listNumber on an item is treated as "1").
 */
export async function purgePurchaseOrderLinesForJob(
  tx: PoTx,
  jobNumber: string,
  listScope: string | null,
): Promise<{ purchaseOrdersUpdated: number; purchaseOrdersDeleted: number }> {
  const jn = jobNumber.trim();
  const listTrim = listScope?.trim() || null;

  const orders = await tx.purchaseOrder.findMany({
    select: { id: true, items: true },
  });

  let purchaseOrdersUpdated = 0;
  let purchaseOrdersDeleted = 0;

  for (const po of orders) {
    const raw = po.items;
    if (!Array.isArray(raw)) continue;

    const filtered = raw.filter((item: unknown) => {
      if (!item || typeof item !== 'object') return true;
      const rec = item as Record<string, unknown>;
      const itemJob = String(rec.jobNumber ?? '').trim();
      if (itemJob !== jn) return true;
      if (!listTrim) return false;
      const itemListRaw = rec.listNumber;
      const itemList =
        itemListRaw != null && String(itemListRaw).trim() !== ''
          ? String(itemListRaw).trim()
          : '1';
      return itemList !== listTrim;
    });

    if (filtered.length === raw.length) continue;

    if (filtered.length === 0) {
      await tx.purchaseOrder.delete({ where: { id: po.id } });
      purchaseOrdersDeleted += 1;
    } else {
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { items: filtered as Prisma.InputJsonValue },
      });
      purchaseOrdersUpdated += 1;
    }
  }

  return { purchaseOrdersUpdated, purchaseOrdersDeleted };
}
