import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { getRemainingQty } from '@/lib/quantityMath';
import { buildPoLineKey, normalizeListForPoKey } from '@/lib/poLineKey';
import {
  buildInventoryPendingToOrderGroup,
  isInventoryReplenishmentJobNumber,
  listPartsNeedingReorder,
} from '@/lib/inventoryReorder';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/orders/pending-to-order
 * Returns all job items with ordered=true that need more parts
 * Allows items that are already in PurchaseOrders to appear again if more parts are needed
 * 
 * Includes items that:
 * - Are ordered but not yet received, OR
 * - Were fully received but quantityNeeded increased (reordering scenario)
 * - Are already in purchase orders but need additional quantities
 * 
 * An item appears if:
 * remaining(Needed - FAB - Shop - Vendor) > totalQuantityOrderedFromPOs
 * 
 * Grouped by job number
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

    const auth = await requirePermission(session, 'orders.to_order.view');
    if (!auth.ok) return auth.response;

    // Get all PurchaseOrders to calculate total quantities already ordered
    const allPurchaseOrders = await prisma.purchaseOrder.findMany({
      select: {
        items: true,
      },
    });

    // Create a Map of (jobNumber, listNumber, partNumber) -> total quantity ordered from all PurchaseOrders
    // NOTE: list-scoped key (no all-lists fallback).
    const itemToQuantityOrderedFromPOs = new Map<string, number>();
    allPurchaseOrders.forEach((po) => {
      const items = po.items as Array<{
        jobNumber: string;
        listNumber?: string | null;
        partNumber: string;
        quantityOrdered: number;
        cancelled?: boolean;
      }>;
      items.forEach((item) => {
        if (item.cancelled === true) return;
        if (isInventoryReplenishmentJobNumber(item.jobNumber)) return;
        const key = buildPoLineKey(item.jobNumber, item.listNumber, item.partNumber);
        // Sum up quantities if item is in multiple orders
        const currentQty = itemToQuantityOrderedFromPOs.get(key) || 0;
        itemToQuantityOrderedFromPOs.set(key, currentQty + (item.quantityOrdered || 0));
      });
    });

    // Fetch all items that are ordered
    // Include items that need more parts even if already received (for reordering scenarios)
    // Query for items where ordered = true OR (quantityOrdered > 0 AND ordered is not false)
    // This handles edge cases where ordered might be null but quantityOrdered is set
    const orderedItems = await prisma.job.findMany({
      where: {
        OR: [
          { ordered: true },
          // Edge case: quantityOrdered is set but ordered is null
          {
            quantityOrdered: { gt: 0 },
            ordered: { not: false }, // This matches null or true
          },
        ],
      },
      orderBy: [
        { jobNumber: 'asc' },
        { listNumber: 'asc' },
        { partNumber: 'asc' },
      ],
    });
    const getPreorderPulled = (item: { quantityPulledFromPreorder?: number | null }) =>
      Math.max(0, item.quantityPulledFromPreorder ?? 0);

    if (process.env.NODE_ENV === 'development') {
      console.log('[pending-to-order] ===== DATABASE QUERY RESULTS =====');
      console.log('[pending-to-order] Query: WHERE ordered = true');
      console.log('[pending-to-order] Found ordered items:', orderedItems.length);
      console.log('[pending-to-order] PurchaseOrders found:', allPurchaseOrders.length);
      console.log('[pending-to-order] Items in PurchaseOrders map:', itemToQuantityOrderedFromPOs.size);
      
      if (orderedItems.length === 0) {
        console.log('[pending-to-order] ⚠️ WARNING: No items found with ordered=true');
        // Check if there are any items at all
        const totalItems = await prisma.job.count();
        const orderedCount = await prisma.job.count({ where: { ordered: true } });
        const orderedNullCount = await prisma.job.count({ where: { ordered: null } });
        const orderedFalseCount = await prisma.job.count({ where: { ordered: false } });
        console.log('[pending-to-order] Total items in jobs table:', totalItems);
        console.log('[pending-to-order] Items with ordered=true:', orderedCount);
        console.log('[pending-to-order] Items with ordered=null:', orderedNullCount);
        console.log('[pending-to-order] Items with ordered=false:', orderedFalseCount);
      }
      
      console.log('[pending-to-order] Sample ordered items:', orderedItems.slice(0, 10).map(item => ({
        jobNumber: item.jobNumber,
        partNumber: item.partNumber,
        ordered: item.ordered,
        quantityOrdered: item.quantityOrdered,
        receivedFromOrder: item.receivedFromOrder,
        quantityNeeded: item.quantityNeeded,
        quantityPulled: item.pulled,
        quantityReceivedFromOrder: item.quantityReceivedFromOrder,
        inPO: itemToQuantityOrderedFromPOs.has(buildPoLineKey(item.jobNumber, item.listNumber, item.partNumber)),
        poQuantity: itemToQuantityOrderedFromPOs.get(buildPoLineKey(item.jobNumber, item.listNumber, item.partNumber)) || 0,
      })));
    }

    // Filter to items that still need more parts (even if already in PurchaseOrders)
    if (process.env.NODE_ENV === 'development') {
      console.log('[pending-to-order] ===== FILTERING ITEMS =====');
      console.log('[pending-to-order] Total ordered items to filter:', orderedItems.length);
    }
    
    const pendingToOrderItems = orderedItems.filter((item) => {
      // Skip items with invalid part numbers
      if (!item.partNumber || item.partNumber.trim() === '') {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[pending-to-order] Item filtered out: invalid partNumber (jobNumber=${item.jobNumber})`);
        }
        return false;
      }

      const key = buildPoLineKey(item.jobNumber, item.listNumber, item.partNumber);
      
      // Calculate what we have: pulled + received from orders
      const quantityPulled = item.pulled ?? 0;
      const quantityReceivedFromOrder = item.quantityReceivedFromOrder ?? 0;
      const quantityNeeded = item.quantityNeeded ?? 0;
      const quantityFab = item.quantityFab ?? 0;
      const quantityPreordered = getPreorderPulled(item);
      
      // Get total quantity already ordered from all PurchaseOrders (already sent to vendors)
      const totalQuantityOrderedFromPOs = itemToQuantityOrderedFromPOs.get(key) || 0;
      
      // Get quantityOrdered from the item itself (for items that were just ordered but not yet in a PO)
      // This represents what the user wants to order, not what's already been sent
      const quantityOrderedFromItem = item.quantityOrdered ?? 0;
      
      // Check if item is already in a PurchaseOrder
      const isInPurchaseOrder = totalQuantityOrderedFromPOs > 0;

      const remainingBaseline = getRemainingQty({
        needed: quantityNeeded,
        fab: quantityFab,
        shop: quantityPulled,
        preorder: quantityPreordered,
        vendor: quantityReceivedFromOrder,
      });
      
      // CRITICAL: Items with ordered=true and quantityOrdered > 0 that are NOT in any PO should ALWAYS show
      // This is what we're trying to order, so it must appear in the pending list
      const hasPendingOrder =
        item.ordered === true &&
        quantityOrderedFromItem > 0 &&
        !isInPurchaseOrder &&
        remainingBaseline > 0;
      
      if (hasPendingOrder) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[pending-to-order] Item ${key} included: hasPendingOrder=true (quantityOrdered=${quantityOrderedFromItem}, not in PO)`);
        }
        return true;
      }
      
      // For items already in PurchaseOrders, only show them again if the user has
      // explicitly increased the quantity to order beyond what is already in POs.
      // Example: PO has 20, user later sets quantityOrdered=34 on the job -> we should
      // surface the extra 14 in Pending to Order.
      const hasAdditionalToOrder =
        isInPurchaseOrder &&
        quantityOrderedFromItem > totalQuantityOrderedFromPOs &&
        remainingBaseline > 0;

      if (process.env.NODE_ENV === 'development') {
        if (hasAdditionalToOrder) {
          console.log(
            `[pending-to-order] Item ${key} included: hasAdditionalToOrder=true (quantityOrderedFromItem=${quantityOrderedFromItem}, totalQuantityOrderedFromPOs=${totalQuantityOrderedFromPOs}, remainingBaseline=${remainingBaseline})`,
          );
        } else {
          console.log(
            `[pending-to-order] Item ${key} filtered out: no additional quantity explicitly ordered (quantityOrderedFromItem=${quantityOrderedFromItem}, totalQuantityOrderedFromPOs=${totalQuantityOrderedFromPOs}, remainingBaseline=${remainingBaseline}, ordered=${item.ordered}, receivedFromOrder=${item.receivedFromOrder})`,
          );
        }
      }

      return hasAdditionalToOrder;
    });

    if (process.env.NODE_ENV === 'development') {
      console.log('[pending-to-order] After filtering, pending items:', pendingToOrderItems.length);
      console.log('[pending-to-order] Filtered out:', orderedItems.length - pendingToOrderItems.length);
      console.log('[pending-to-order] Pending items:', pendingToOrderItems.map(item => ({
        jobNumber: item.jobNumber,
        partNumber: item.partNumber,
        ordered: item.ordered,
        quantityOrdered: item.quantityOrdered,
        receivedFromOrder: item.receivedFromOrder,
        quantityNeeded: item.quantityNeeded,
        quantityPulled: item.pulled,
        quantityReceivedFromOrder: item.quantityReceivedFromOrder,
        inPO: itemToQuantityOrderedFromPOs.has(buildPoLineKey(item.jobNumber, item.listNumber, item.partNumber)),
        poQuantity: itemToQuantityOrderedFromPOs.get(buildPoLineKey(item.jobNumber, item.listNumber, item.partNumber)) || 0,
      })));
    }

    // Group items by job number + list number (treat each list as its own job bucket)
    const jobsMap = new Map<string, {
      jobNumber: string;
      jobName: string;
      area: string | null;
      items: Array<{
        listNumber: string;
        partNumber: string;
        description: string | null;
        uom: string | null;
        quantityOrdered: number | null;
        quantityNeeded: number;
        quantityFab: number;
        quantityPulled: number;
        quantityPreordered: number;
        quantityReceivedFromOrder: number;
        remainingToOrder: number;
        vendor: string | null;
        isInPurchaseOrder: boolean;
        canCancel: boolean;
        cancelBlockReason?: string;
      }>;
    }>();

    pendingToOrderItems.forEach((item) => {
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

      const key = buildPoLineKey(item.jobNumber, item.listNumber, item.partNumber);
      const quantityPulled = item.pulled ?? 0;
      const quantityReceivedFromOrder = item.quantityReceivedFromOrder ?? 0;
      const quantityNeeded = item.quantityNeeded ?? 0;
      const quantityFab = item.quantityFab ?? 0;
      const quantityPreordered = getPreorderPulled(item);
      const totalQuantityOrderedFromPOs = itemToQuantityOrderedFromPOs.get(key) || 0;
      const remainingBaseline = getRemainingQty({
        needed: quantityNeeded,
        fab: quantityFab,
        shop: quantityPulled,
        preorder: quantityPreordered,
        vendor: quantityReceivedFromOrder,
      });
      const stillNeeded = Math.max(0, remainingBaseline - totalQuantityOrderedFromPOs);
      const quantityOrderedFromItem = item.quantityOrdered ?? 0;
      const isInPurchaseOrder = totalQuantityOrderedFromPOs > 0;
      const remainingToOrder = isInPurchaseOrder
        ? stillNeeded
        : (quantityOrderedFromItem > 0 ? quantityOrderedFromItem : stillNeeded);
      const canCancel = !isInPurchaseOrder;
      const cancelBlockReason = canCancel ? undefined : 'Already sent in Purchase Order';

      jobsMap.get(jobKey)!.items.push({
        listNumber: item.listNumber,
        partNumber: item.partNumber,
        description: item.description,
        uom: item.unitOfMeasurement,
        quantityOrdered: item.quantityOrdered,
        quantityNeeded: item.quantityNeeded,
        quantityFab: quantityFab,
        quantityPulled: item.pulled,
        quantityPreordered,
        quantityReceivedFromOrder: quantityReceivedFromOrder,
        remainingToOrder,
        vendor: item.type,
        isInPurchaseOrder,
        canCancel,
        cancelBlockReason,
      });
    });

    const jobs = Array.from(jobsMap.values());
    const inventoryGroup = buildInventoryPendingToOrderGroup(await listPartsNeedingReorder());
    const allJobs = inventoryGroup ? [inventoryGroup, ...jobs] : jobs;
    const inventoryItemCount = inventoryGroup?.items.length ?? 0;

    return NextResponse.json(
      {
        jobs: allJobs,
        totalItems: pendingToOrderItems.length + inventoryItemCount,
        totalJobs: allJobs.length,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      }
    );
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error in /api/admin/orders/pending-to-order:', error);
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
