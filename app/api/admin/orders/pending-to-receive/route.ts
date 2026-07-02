import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions';
import { isJobFullyDelivered, isLineFullyReceived } from '@/lib/orderStatus';
import type { JobLineForStatus } from '@/lib/orderStatus';
import { buildPoLineKey, normalizeListForPoKey } from '@/lib/poLineKey';
import {
  INVENTORY_REORDER_JOB_NAME,
  INVENTORY_REORDER_JOB_NUMBER,
  isInventoryReplenishmentJobNumber,
  type InventoryPoLineItem,
} from '@/lib/inventoryReorder';

export const dynamic = 'force-dynamic';

interface PurchaseOrderInfo {
  orderNumber: string;
  vendorPoLabel: string | null;
  supplier: string | null;
  recipientTo: string[] | null;
  recipientCc: string[] | null;
  sendStatus: string;
  sentAt: Date;
  sentBy: string;
  orderId: string;
}

function itemKey(
  jobNumber: string,
  listNumber: string | null | undefined,
  partNumber: string,
): string {
  return buildPoLineKey(jobNumber, listNumber, partNumber);
}

/**
 * GET /api/admin/orders/pending-to-receive
 * Returns job items that are ordered, tied to a PurchaseOrder, and whose JOB is not yet fully delivered.
 * Items stay in this list even when fully received, until the whole job is delivered.
 * Grouped by job number. Each item includes isFullyReceived for UI badges.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const auth = await requirePermission(session, 'orders.pending.view');
    if (!auth.ok) return auth.response;

    // Get all PurchaseOrders with full data
    const allPurchaseOrders = await prisma.purchaseOrder.findMany({
      select: {
        id: true,
        orderNumber: true,
        sentAt: true,
        sentBy: true,
        items: true,
        vendorPoLabel: true,
        supplier: true,
        recipientTo: true,
        recipientCc: true,
        sendStatus: true,
        orderKind: true,
      },
      orderBy: {
        sentAt: 'desc',
      },
    }) as Array<{
      id: string;
      orderNumber: string;
      vendorPoLabel?: string | null;
      sentAt: Date;
      sentBy: string;
      items: unknown;
      supplier?: string | null;
      recipientTo?: unknown;
      recipientCc?: unknown;
      sendStatus?: string;
      orderKind?: string;
    }>;

    // Create maps of item keys -> PurchaseOrderInfo[] and quantityOrdered.
    // Also track the quantityOrdered from PurchaseOrder items (source of truth)
    const itemToPurchaseOrders = new Map<string, PurchaseOrderInfo[]>();
    const itemToQuantityOrdered = new Map<string, number>(); // Track quantity from PurchaseOrders
    
    allPurchaseOrders.forEach((po) => {
      const items = po.items as Array<{
        jobNumber: string;
        listNumber?: string | null;
        partNumber: string;
        quantityOrdered: number;
        cancelled?: boolean;
      }>;
      const poInfo: PurchaseOrderInfo = {
        orderNumber: po.orderNumber,
        vendorPoLabel: po.vendorPoLabel ?? null,
        supplier: po.supplier ?? null,
        recipientTo: Array.isArray(po.recipientTo) ? po.recipientTo.map((v) => String(v).trim()).filter(Boolean) : null,
        recipientCc: Array.isArray(po.recipientCc) ? po.recipientCc.map((v) => String(v).trim()).filter(Boolean) : null,
        sendStatus: String(po.sendStatus || 'SENT'),
        sentAt: po.sentAt,
        sentBy: po.sentBy,
        orderId: po.id,
      };
      items.forEach((item) => {
        if (item.cancelled === true) return;
        if (isInventoryReplenishmentJobNumber(item.jobNumber)) return;

        // Primary key: exact jobNumber + raw listNumber + partNumber
        const key = itemKey(item.jobNumber, item.listNumber, item.partNumber);
        if (!itemToPurchaseOrders.has(key)) {
          itemToPurchaseOrders.set(key, []);
          itemToQuantityOrdered.set(key, 0);
        }
        itemToPurchaseOrders.get(key)!.push(poInfo);
        // Sum up quantities if item is in multiple orders
        const currentQty = itemToQuantityOrdered.get(key) || 0;
        itemToQuantityOrdered.set(key, currentQty + (item.quantityOrdered || 0));

        // No legacy/all-lists bucket:
        // list normalization (blank -> "1" and "0087" -> "87") is handled by buildPoLineKey.
      });
    });

    // Fetch all items that are ordered
    const orderedItems = await prisma.job.findMany({
      where: {
        ordered: true,
      },
      orderBy: [
        { jobNumber: 'asc' },
        { listNumber: 'asc' },
        { partNumber: 'asc' },
      ],
    });

    const getQuantityOrderedFromPO = (jobNum: string, listNum: string | null, partNum: string) => {
      const k = itemKey(jobNum, listNum, partNum);
      return itemToQuantityOrdered.get(k) ?? null;
    };
    const isInPurchaseOrder = (jobNum: string, listNum: string | null, partNum: string) => {
      const k = itemKey(jobNum, listNum, partNum);
      return itemToPurchaseOrders.has(k);
    };

    // Items in a PO for a job - used to compute job-level delivered status
    const itemsInPO = orderedItems.filter((item) => {
      const key = itemKey(item.jobNumber, item.listNumber, item.partNumber);
      return itemToPurchaseOrders.has(key);
    });

    const jobNumberToLines = new Map<string, typeof itemsInPO>();
    itemsInPO.forEach((item) => {
      if (!jobNumberToLines.has(item.jobNumber)) {
        jobNumberToLines.set(item.jobNumber, []);
      }
      jobNumberToLines.get(item.jobNumber)!.push(item);
    });

    const jobFullyDeliveredMap = new Map<string, boolean>();
    jobNumberToLines.forEach((lines, jobNum) => {
      const jobLines: JobLineForStatus[] = lines.map((l) => ({
        jobNumber: l.jobNumber,
        listNumber: l.listNumber,
        partNumber: l.partNumber,
        ordered: l.ordered,
        quantityOrdered: l.quantityOrdered,
        quantityReceivedFromOrder: l.quantityReceivedFromOrder,
        receivedFromOrder: l.receivedFromOrder,
        pickupFromSupplier: l.pickupFromSupplier,
        supplierDeliveryToJobsite: l.supplierDeliveryToJobsite,
        delivered: l.delivered ?? undefined,
      }));
      const isDelivered = isJobFullyDelivered(jobLines, getQuantityOrderedFromPO, isInPurchaseOrder);
      jobFullyDeliveredMap.set(jobNum, isDelivered);
    });

    // Include all lines in PO for jobs that are NOT fully delivered (including fully-received lines)
    const pendingToReceiveItems = itemsInPO.filter((item) => {
      const jobDelivered = jobFullyDeliveredMap.get(item.jobNumber);
      return jobDelivered !== true;
    });

    // Group items by job number + list number (each list is its own bucket)
    const jobsMap = new Map<string, {
      jobNumber: string;
      jobName: string;
      area: string | null;
      items: Array<{
        listNumber: string;
        partNumber: string;
        description: string | null;
        quantityOrdered: number | null;
        quantityNeeded: number;
        quantityFab: number;
        quantityPulled: number;
        quantityReceived: number;
        quantityReceivedFromOrder: number;
        pickupFromSupplier: boolean;
        supplierDeliveryToJobsite: boolean;
        vendor: string | null;
        purchaseOrders: PurchaseOrderInfo[];
        isFullyReceived: boolean;
        jobIsFullyDelivered: boolean;
      }>;
    }>();

    pendingToReceiveItems.forEach((item) => {
      const listKey = normalizeListForPoKey(item.listNumber);
      const jobKey = `${item.jobNumber}::${listKey}`;

      if (!jobsMap.has(jobKey)) {
        jobsMap.set(jobKey, {
          jobNumber: item.jobNumber,
          jobName: item.jobName,
          area: item.area ?? null,
          items: [],
        });
      }

      const key = itemKey(item.jobNumber, item.listNumber, item.partNumber);
      const purchaseOrders = itemToPurchaseOrders.get(key) || [];
      const quantityFromPurchaseOrders = itemToQuantityOrdered.get(key);
      const quantityOrdered = quantityFromPurchaseOrders !== undefined
        ? quantityFromPurchaseOrders
        : (item.quantityOrdered ?? null);
      const qtyForStatus = quantityOrdered ?? null;

      // For jobsite delivery OR supplier pickup, we still want vendor quantity to count
      // toward progress, but we do NOT want the Pending to Receive UI to treat the line
      // as fully "Received". These flows mean the material is in transit (either being
      // picked up or delivered to jobsite), so keep isFullyReceived=false in both cases.
      const rawIsFullyReceived = isLineFullyReceived(
        {
          jobNumber: item.jobNumber,
          listNumber: item.listNumber,
          partNumber: item.partNumber,
          ordered: item.ordered,
          quantityOrdered: item.quantityOrdered,
          quantityReceivedFromOrder: item.quantityReceivedFromOrder,
          receivedFromOrder: item.receivedFromOrder,
          pickupFromSupplier: item.pickupFromSupplier,
          supplierDeliveryToJobsite: item.supplierDeliveryToJobsite,
        },
        qtyForStatus,
      );
      const isFullyReceived =
        item.supplierDeliveryToJobsite === true || item.pickupFromSupplier === true
          ? false
          : rawIsFullyReceived;
      const jobIsFullyDelivered = jobFullyDeliveredMap.get(item.jobNumber) ?? false;

      jobsMap.get(jobKey)!.items.push({
        listNumber: item.listNumber,
        partNumber: item.partNumber,
        description: item.description,
        quantityOrdered: quantityOrdered,
        quantityNeeded: item.quantityNeeded,
        quantityFab: item.quantityFab ?? 0,
        quantityPulled: item.pulled,
        quantityReceived: item.quantityReceivedFromOrder ?? 0,
        quantityReceivedFromOrder: item.quantityReceivedFromOrder ?? 0,
        pickupFromSupplier: item.pickupFromSupplier === true,
        supplierDeliveryToJobsite: item.supplierDeliveryToJobsite === true,
        vendor: item.type,
        purchaseOrders: purchaseOrders.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime()),
        isFullyReceived,
        jobIsFullyDelivered,
      });
    });

    const jobs = Array.from(jobsMap.values());

    type InventoryOnOrderRow = {
      listNumber: string;
      partNumber: string;
      description: string | null;
      quantityOrdered: number;
      quantityNeeded: number;
      quantityFab: number;
      quantityPulled: number;
      quantityReceived: number;
      quantityReceivedFromOrder: number;
      pickupFromSupplier: boolean;
      supplierDeliveryToJobsite: boolean;
      vendor: string | null;
      purchaseOrders: PurchaseOrderInfo[];
      isFullyReceived: boolean;
      jobIsFullyDelivered: boolean;
    };

    const isInventoryPoLine = (
      po: { orderKind?: string | null },
      item: InventoryPoLineItem,
    ): boolean =>
      po.orderKind === 'INVENTORY' || isInventoryReplenishmentJobNumber(item.jobNumber);

    const isLineFullyReceivedOnPo = (item: InventoryPoLineItem): boolean => {
      const ordered = Math.max(0, Number(item.quantityOrdered ?? 0));
      const received = Math.max(0, Number(item.quantityReceived ?? 0));
      if (ordered <= 0) {
        return item.fullyReceived === true;
      }
      // Quantity is the source of truth — ignore a stale fullyReceived flag when qty is still open.
      return received >= ordered;
    };

    // Keep inventory POs on On Order while any line is still outstanding — same idea as job
    // lines staying visible (including fully received ones) until the job is delivered.
    const activeInventoryPoIds = new Set<string>();
    for (const po of allPurchaseOrders) {
      const poItems = (po.items ?? []) as InventoryPoLineItem[];
      if (!Array.isArray(poItems)) continue;

      let hasInventoryLine = false;
      let hasOutstanding = false;
      for (const item of poItems) {
        if (item.cancelled === true) continue;
        if (!isInventoryPoLine(po, item)) continue;
        hasInventoryLine = true;
        if (!isLineFullyReceivedOnPo(item)) {
          hasOutstanding = true;
          break;
        }
      }
      if (hasInventoryLine && hasOutstanding) {
        activeInventoryPoIds.add(po.id);
      }
    }

    const inventoryItemsMap = new Map<string, InventoryOnOrderRow>();

    for (const po of allPurchaseOrders) {
      if (!activeInventoryPoIds.has(po.id)) continue;
      const poItems = (po.items ?? []) as InventoryPoLineItem[];
      if (!Array.isArray(poItems)) continue;

      const poInfo: PurchaseOrderInfo = {
        orderNumber: po.orderNumber,
        vendorPoLabel: po.vendorPoLabel ?? null,
        supplier: po.supplier ?? null,
        recipientTo: Array.isArray(po.recipientTo) ? po.recipientTo.map((v) => String(v).trim()).filter(Boolean) : null,
        recipientCc: Array.isArray(po.recipientCc) ? po.recipientCc.map((v) => String(v).trim()).filter(Boolean) : null,
        sendStatus: String(po.sendStatus || 'SENT'),
        sentAt: po.sentAt,
        sentBy: po.sentBy,
        orderId: po.id,
      };

      for (const item of poItems) {
        if (item.cancelled === true) continue;
        if (!isInventoryPoLine(po, item)) continue;

        const ordered = Math.max(0, Number(item.quantityOrdered ?? 0));
        const received = Math.max(0, Number(item.quantityReceived ?? 0));
        const lineKey = itemKey(
          item.jobNumber ?? INVENTORY_REORDER_JOB_NUMBER,
          item.listNumber,
          item.partNumber ?? '',
        );

        if (!inventoryItemsMap.has(lineKey)) {
          inventoryItemsMap.set(lineKey, {
            listNumber: item.listNumber ?? 'STOCK',
            partNumber: item.partNumber ?? '',
            description: item.description ?? null,
            quantityOrdered: ordered,
            quantityNeeded: 0,
            quantityFab: 0,
            quantityPulled: 0,
            quantityReceived: received,
            quantityReceivedFromOrder: received,
            pickupFromSupplier: false,
            supplierDeliveryToJobsite: false,
            vendor: po.supplier ?? null,
            purchaseOrders: [],
            isFullyReceived: false,
            jobIsFullyDelivered: false,
          });
        }
        const row = inventoryItemsMap.get(lineKey)!;
        row.quantityOrdered += ordered;
        row.quantityReceived += received;
        row.quantityReceivedFromOrder = row.quantityReceived;
        if (!row.purchaseOrders.some((existing) => existing.orderId === poInfo.orderId)) {
          row.purchaseOrders.push(poInfo);
        }
        if (item.description && !row.description) {
          row.description = item.description;
        }
        if (!row.vendor && po.supplier) {
          row.vendor = po.supplier;
        }
      }
    }

    const inventoryJob = inventoryItemsMap.size > 0
      ? {
          jobNumber: INVENTORY_REORDER_JOB_NUMBER,
          jobName: INVENTORY_REORDER_JOB_NAME,
          area: null,
          isInventoryReplenishment: true as const,
          items: Array.from(inventoryItemsMap.values()).map((item) => ({
            ...item,
            purchaseOrders: item.purchaseOrders.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime()),
            isFullyReceived: item.quantityOrdered > 0 && item.quantityReceived >= item.quantityOrdered,
          })),
        }
      : null;

    const allJobs = inventoryJob ? [inventoryJob, ...jobs] : jobs;
    const inventoryItemCount = inventoryJob?.items.length ?? 0;

    return NextResponse.json({
      jobs: allJobs,
      totalItems: pendingToReceiveItems.length + inventoryItemCount,
      totalJobs: allJobs.length,
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error in /api/admin/orders/pending-to-receive:', error);
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
