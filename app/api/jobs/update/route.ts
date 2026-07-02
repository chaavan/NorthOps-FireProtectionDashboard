import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import {
  authOptions,
  isAdmin,
  resolveSessionUserIdForAudit,
  resolveSessionUserRole,
} from '@/lib/auth';
import { getEffectivePermissionsForSession, hasPermission } from '@/lib/permissions';
import { updateJobLinesFromDatabase, getJobLinesFromDatabase } from '@/lib/jobsDatabase';
import { canAccessJob } from '@/lib/jobAccess';
import { normalizeListContextForLookup } from '@/lib/jobListContext';
import {
  canViewJobByNumber,
  getJobVisibilityPermissions,
} from '@/lib/jobVisibilityPermissions';
import { checkAndUpdateSmartsheetIfComplete } from '@/lib/smartsheet';
import { cache, cacheKeys } from '@/lib/cache';
import {
  adjustPartQuantitiesForJobBatch,
  findPartRowByLookupVariants,
} from '@/lib/partsDatabase';
import { sendBackorderEmail } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';
import { getRemainingQty } from '@/lib/quantityMath';
import type { BatchUpdateRequest, UpdateJobResponse } from '@/lib/types';
import { partNumberLookupVariants } from '@/lib/inventoryQuantity';

// Force this route to be dynamic (not statically generated at build time)
export const dynamic = 'force-dynamic';

/**
 * POST /api/jobs/update
 * Updates multiple line items in batch
 * 
 * Request body:
 * {
 *   jobNumber: string,
 *   updates: [
 *     { rowIndex: number, quantityPulled: number, pulledBy?: string, pulledDate?: string }
 *   ]
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication and permissions
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const role =
      (await resolveSessionUserRole(session)) ?? (session.user as any).role;
    const userEmail = (session.user as any).email;
    const permissionDetails = await getEffectivePermissionsForSession(session);
    const isUserAdmin =
      isAdmin(role) ||
      permissionDetails?.isDeveloper === true ||
      permissionDetails?.isSuperAdmin === true;
    
    const body = (await request.json()) as BatchUpdateRequest & {
      listNumberContext?: string | null;
      listNumber?: string | null;
    };
    const resolvedListNumber = normalizeListContextForLookup(
      body.listNumberContext?.trim() || body.listNumber?.trim() || null,
    );

    // Debug: log the received body
    console.log('[API /jobs/update] Received request body:', JSON.stringify(body, null, 2));

    if (!body.jobNumber) {
      return NextResponse.json(
        { error: 'jobNumber is required' },
        { status: 400 }
      );
    }

    if (!body.updates || !Array.isArray(body.updates) || body.updates.length === 0) {
      return NextResponse.json(
        { error: 'updates array is required and must not be empty' },
        { status: 400 }
      );
    }

    const permissionContext = {
      jobNumber: body.jobNumber,
      listNumber: resolvedListNumber,
    };

    const visibility = getJobVisibilityPermissions(permissionDetails);
    const canViewRequestedJob = await canViewJobByNumber({
      jobNumber: body.jobNumber,
      listNumber: resolvedListNumber,
      visibility,
    });
    if (!canViewRequestedJob) {
      return NextResponse.json(
        {
          error: 'JOB_TYPE_VISIBILITY_REQUIRED',
          message: 'Forbidden - You do not have permission to view this job type',
        },
        { status: 403 },
      );
    }

    if (!isUserAdmin) {
      const normalizedEmail = userEmail?.trim().toLowerCase() ?? null;
      const hasAccess =
        !!normalizedEmail &&
        (await canAccessJob(normalizedEmail, body.jobNumber, resolvedListNumber));

      if (!hasAccess) {
        return NextResponse.json(
          {
            error: 'JOB_ACCESS_REQUIRED',
            message: 'Forbidden - You do not have access to this job/list',
          },
          { status: 403 },
        );
      }
    }

    const canPullFromShop = await hasPermission(
      session,
      'job.puller.pull_from_shop',
      permissionContext,
    );
    const canOrderLineItems = await hasPermission(
      session,
      'job.puller.order',
      permissionContext,
    );
    const canEditLineItems = await hasPermission(
      session,
      'job.puller.edit_line',
      permissionContext,
    );
    const canEditUnitCost = await hasPermission(
      session,
      'job.purchase_order.edit_unit_cost',
      permissionContext,
    );

    const hasPullUpdates = body.updates.some(
      (update) =>
        update.quantityPulled !== undefined ||
        update.pulledBy !== undefined ||
        update.pulledDate !== undefined,
    );
    const hasOrderUpdates = body.updates.some(
      (update) =>
        update.ordered !== undefined ||
        update.quantityOrdered !== undefined ||
        update.receivedFromOrder !== undefined ||
        update.quantityReceivedFromOrder !== undefined,
    );
    const hasLineItemUpdates = body.updates.some(
      (update) =>
        update.quantityPulledFromPreorder !== undefined ||
        update.quantityFab !== undefined ||
        update.type !== undefined ||
        update.partNumber !== undefined ||
        update.description !== undefined ||
        update.uom !== undefined ||
        update.quantityNeeded !== undefined ||
        update.supplier !== undefined ||
        update.lineOrder !== undefined,
    );
    const hasUnitCostUpdates = body.updates.some(
      (update) => update.manualCost !== undefined,
    );

    if (
      (hasPullUpdates && !canPullFromShop) ||
      (hasOrderUpdates && !canOrderLineItems) ||
      (hasLineItemUpdates && !canEditLineItems) ||
      (hasUnitCostUpdates && !canEditUnitCost)
    ) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to make one or more of these changes' },
        { status: 403 },
      );
    }

    // Validate each update
    for (const update of body.updates) {
      if (typeof update.rowIndex !== 'number' || update.rowIndex < 2) {
        return NextResponse.json(
          { error: 'Each update must have a valid rowIndex (>= 2)' },
          { status: 400 }
        );
      }
      // Only validate quantityPulled if it's provided
      if (
        update.quantityPulled !== undefined &&
        (
          typeof update.quantityPulled !== 'number' ||
          Number.isNaN(update.quantityPulled) ||
          !Number.isInteger(update.quantityPulled) ||
          update.quantityPulled < 0
        )
      ) {
        return NextResponse.json(
          { error: 'Each update must have a valid integer quantityPulled (>= 0)' },
          { status: 400 }
        );
      }
      if (
        update.quantityPulledFromPreorder !== undefined &&
        (
          typeof update.quantityPulledFromPreorder !== 'number' ||
          Number.isNaN(update.quantityPulledFromPreorder) ||
          !Number.isInteger(update.quantityPulledFromPreorder) ||
          update.quantityPulledFromPreorder < 0
        )
      ) {
        return NextResponse.json(
          { error: 'Each update must have a valid integer quantityPulledFromPreorder (>= 0)' },
          { status: 400 }
        );
      }
      if (
        update.quantityFab !== undefined &&
        (
          typeof update.quantityFab !== 'number' ||
          Number.isNaN(update.quantityFab) ||
          !Number.isInteger(update.quantityFab) ||
          update.quantityFab < 0
        )
      ) {
        return NextResponse.json(
          { error: 'Each update must have a valid integer quantityFab (>= 0) when provided' },
          { status: 400 },
        );
      }
      if (
        update.lineOrder !== undefined &&
        (
          typeof update.lineOrder !== 'number' ||
          Number.isNaN(update.lineOrder) ||
          !Number.isInteger(update.lineOrder) ||
          update.lineOrder < 1
        )
      ) {
        return NextResponse.json(
          { error: 'Each update must have a valid lineOrder (>= 1) when provided' },
          { status: 400 },
        );
      }
      if (
        update.manualCost !== undefined &&
        update.manualCost !== null &&
        (
          typeof update.manualCost !== 'number' ||
          Number.isNaN(update.manualCost) ||
          !Number.isFinite(update.manualCost) ||
          update.manualCost < 0
        )
      ) {
        return NextResponse.json(
          { error: 'Each update must have a valid manualCost (>= 0) when provided' },
          { status: 400 },
        );
      }
    }

    // Get "before" state to detect newly ordered items and inventory deltas
    const beforeState = await getJobLinesFromDatabase(body.jobNumber);
    const reorderUpdates = body.updates.filter(
      (update) => update.lineOrder !== undefined && update.lineOrder !== null,
    );
    if (reorderUpdates.length > 0) {
      const listRows = beforeState.lineItems.filter(
        (item) => (item.listNumber ?? '1') === resolvedListNumber,
      );
      if (listRows.length !== reorderUpdates.length) {
        return NextResponse.json(
          { error: 'lineOrder updates must include every row in the current list' },
          { status: 400 },
        );
      }
      const includedRows = new Set(reorderUpdates.map((update) => update.rowIndex));
      for (const item of listRows) {
        if (!includedRows.has(item.rowIndex)) {
          return NextResponse.json(
            { error: 'lineOrder updates must include every row in the current list' },
            { status: 400 },
          );
        }
      }
      const normalizedOrders = reorderUpdates.map((update) => Number(update.lineOrder));
      const uniqueOrders = new Set(normalizedOrders);
      if (uniqueOrders.size !== normalizedOrders.length) {
        return NextResponse.json(
          { error: 'lineOrder updates must be unique within the current list' },
          { status: 400 },
        );
      }
      for (let expected = 1; expected <= normalizedOrders.length; expected += 1) {
        if (!uniqueOrders.has(expected)) {
          return NextResponse.json(
            { error: 'lineOrder updates must be contiguous starting at 1' },
            { status: 400 },
          );
        }
      }
    }

    // Compute pulled deltas from requested updates before mutating anything.
    const beforeMap = new Map<number, any>();
    beforeState.lineItems.forEach(item => beforeMap.set(item.rowIndex, item));

    const fulfillmentViolations: Array<{
      rowIndex: number;
      partNumber: string | null;
      reason: string;
    }> = [];

    for (const update of body.updates) {
      const before = beforeMap.get(update.rowIndex);
      if (!before) continue;

      const beforeNeeded = Math.max(0, Math.trunc(Number(before.quantityNeeded || 0)));
      const beforeFab = Math.max(0, Math.trunc(Number(before.quantityFab || 0)));
      const beforeShop = Math.max(0, Math.trunc(Number(before.quantityPulled || 0)));
      const beforePreorder = Math.max(
        0,
        Math.trunc(
          Number(
            before.quantityPulledFromPreorder ??
              before.quantityPreordered ??
              0,
          ),
        ),
      );
      const beforeReceived = Math.max(0, Math.trunc(Number(before.quantityReceivedFromOrder || 0)));
      const beforeOrderedQty = Math.max(0, Math.trunc(Number(before.quantityOrdered || 0)));
      const beforeOrdered = before.ordered?.toString().toLowerCase() === 'yes';
      const beforeVendor = beforeOrdered
        ? Math.max(beforeReceived, beforeOrderedQty)
        : beforeReceived;

      const nextNeeded = update.quantityNeeded !== undefined
        ? Math.max(0, Math.trunc(Number(update.quantityNeeded || 0)))
        : beforeNeeded;
      const nextFab = update.quantityFab !== undefined
        ? Math.max(0, Math.trunc(Number(update.quantityFab || 0)))
        : beforeFab;
      const nextShop = update.quantityPulled !== undefined
        ? Math.max(0, Math.trunc(Number(update.quantityPulled || 0)))
        : beforeShop;
      const nextPreorder =
        update.quantityPulledFromPreorder !== undefined
          ? Math.max(0, Math.trunc(Number(update.quantityPulledFromPreorder || 0)))
          : beforePreorder;

      const fabChanged = update.quantityFab !== undefined && nextFab !== beforeFab;
      const shopChanged = update.quantityPulled !== undefined && nextShop !== beforeShop;
      const preorderChanged =
        update.quantityPulledFromPreorder !== undefined &&
        nextPreorder !== beforePreorder;

      if (fabChanged || shopChanged || preorderChanged) {
        const nextFulfillmentTotal =
          nextFab + nextShop + nextPreorder + beforeVendor;
        if (nextFulfillmentTotal > nextNeeded) {
          fulfillmentViolations.push({
            rowIndex: update.rowIndex,
            partNumber: before.partNumber || null,
            reason:
              'FAB, Shop, Pre-order, and Vendor cannot exceed Needed. When moving quantity between FAB and Shop, lower one before raising the other (or change both in one save).',
          });
        }
      }
    }

    if (fulfillmentViolations.length > 0) {
      return NextResponse.json(
        {
          error: 'FULFILLMENT_PATH_BLOCKED',
          message: fulfillmentViolations[0].reason,
          violations: fulfillmentViolations,
        },
        { status: 409 },
      );
    }

    const requestedPulledByRow = new Map<number, number>();
    for (const update of body.updates) {
      if (update.quantityPulled !== undefined) {
        requestedPulledByRow.set(update.rowIndex, update.quantityPulled);
      }
    }

    // Collect all shop pull changes for validation
    const shopPullChanges: Array<{ partNumber: string; deltaPulled: number; rowIndex: number }> = [];
    for (const before of beforeState.lineItems) {
      const requestedPulled = requestedPulledByRow.get(before.rowIndex);
      if (requestedPulled === undefined) continue;
      const beforePulled = before.quantityPulled || 0;
      const deltaPulled = requestedPulled - beforePulled;
      if (deltaPulled > 0 && before.partNumber) {
        shopPullChanges.push({
          partNumber: before.partNumber,
          deltaPulled,
          rowIndex: before.rowIndex,
        });
      }
    }

    // Validate inventory for all pull increases
    // Aggregate by part number (multiple line items might share same part)
    const pullDeltasByPart = new Map<string, number>();
    const rowIndicesByPart = new Map<string, number[]>();
    
    shopPullChanges.forEach(change => {
      const existing = pullDeltasByPart.get(change.partNumber) || 0;
      pullDeltasByPart.set(change.partNumber, existing + change.deltaPulled);
      
      const existingIndices = rowIndicesByPart.get(change.partNumber) || [];
      existingIndices.push(change.rowIndex);
      rowIndicesByPart.set(change.partNumber, existingIndices);
    });

    // Validate each part's total pull delta against inventory
    const insufficientStockItems: Array<{ partNumber: string; rowIndices: number[]; deltaPulled: number }> = [];
    
    for (const [partNumber, totalDeltaPulled] of pullDeltasByPart.entries()) {
      try {
        const variants = partNumberLookupVariants(partNumber);
        const partRow = await findPartRowByLookupVariants(variants);
        const part = partRow
          ? { quantity: partRow.quantity }
          : null;

        if (!part) {
          console.warn(`[updateJob] Part not found for PN ${partNumber} - skipping inventory validation`);
          continue;
        }

        const currentInventory = part.quantity ? Number(part.quantity) : 0;
        
        if (currentInventory < totalDeltaPulled) {
          insufficientStockItems.push({
            partNumber,
            rowIndices: rowIndicesByPart.get(partNumber) || [],
            deltaPulled: totalDeltaPulled,
          });
        }
      } catch (err) {
        console.error(`[updateJob] Error validating inventory for part ${partNumber}:`, err);
        return NextResponse.json(
          {
            error: 'INVENTORY_VALIDATION_FAILED',
            message: `Failed inventory validation for part ${partNumber}`,
          },
          { status: 500 }
        );
      }
    }

    // If any parts have insufficient stock, return error
    if (insufficientStockItems.length > 0) {
      return NextResponse.json(
        {
          error: 'INSUFFICIENT_STOCK',
          message: 'Insufficient inventory for one or more parts',
          insufficientStockItems: insufficientStockItems.map(item => ({
            partNumber: item.partNumber,
            requested: item.deltaPulled,
          })),
        },
        { status: 409 }
      );
    }

    // Perform the update after inventory feasibility has been proven.
    const result = await updateJobLinesFromDatabase(body.jobNumber, body.updates);

    const actorUserId = await resolveSessionUserIdForAudit(session);
    if (!actorUserId) {
      return NextResponse.json(
        {
          error: 'Unable to resolve audit user for inventory updates. Please sign out and sign back in.',
        },
        { status: 401 },
      );
    }

    // Compute pulled deltas and adjust inventory on-hand
    const restorePulledUpdates: Array<{
      rowIndex: number;
      quantityPulled: number;
      pulledBy?: string;
      pulledDate?: string;
    }> = [];
    const inventoryAdjustments: Array<{ partNumber: string; deltaQuantity: number }> = [];
    for (const item of result.lineItems) {
      const before = beforeMap.get(item.rowIndex);
      if (!before) continue;

      const beforePulled = before.quantityPulled || 0;
      const afterPulled = item.quantityPulled || 0;
      const deltaPulled = afterPulled - beforePulled;

      if (deltaPulled !== 0) {
        restorePulledUpdates.push({
          rowIndex: item.rowIndex,
          quantityPulled: beforePulled,
          pulledBy: before.pulledBy ?? undefined,
          pulledDate: before.pulledDate ?? undefined,
        });
      }

      if (deltaPulled !== 0 && item.partNumber) {
        // On-hand change is negative when pulling more from stock
        inventoryAdjustments.push({
          partNumber: item.partNumber,
          deltaQuantity: -deltaPulled,
        });
      }
    }

    // All validations passed - apply inventory adjustments in one transaction.
    let inventoryError: Error | null = null;
    if (inventoryAdjustments.length > 0) {
      try {
        await adjustPartQuantitiesForJobBatch(
          inventoryAdjustments,
          body.jobNumber,
          actorUserId,
        );
      } catch (err) {
        inventoryError = err as Error;
      }
    }

    if (inventoryError) {
      if (restorePulledUpdates.length > 0) {
        try {
          await updateJobLinesFromDatabase(body.jobNumber, restorePulledUpdates);
        } catch (restoreErr) {
          console.error('[updateJob] Failed to restore pulled values after inventory error:', restoreErr);
        }
      }

      const errorMessage = inventoryError.message;
      if (errorMessage === 'INSUFFICIENT_STOCK') {
        return NextResponse.json(
          {
            error: 'INSUFFICIENT_STOCK',
            message: 'Insufficient inventory - inventory changed during save',
          },
          { status: 409 }
        );
      }

      console.error('[updateJob] Inventory adjustment failed:', inventoryError);
      return NextResponse.json(
        { error: 'INVENTORY_ADJUSTMENT_FAILED', message: inventoryError.message || 'Inventory adjustment failed' },
        { status: 500 }
      );
    }

    // Send backorder email to purchasing for any ordered-but-not-received items
    try {
      const backorderItems = result.lineItems
        .filter(item => item.ordered?.toString().toLowerCase() === 'yes' && item.receivedFromOrder?.toString().toLowerCase() !== 'yes')
        .map(item => {
          const remainingNeeded = getRemainingQty({
            needed: item.quantityNeeded,
            fab: item.quantityFab,
            shop: item.quantityPulled,
            preorder: item.quantityPulledFromPreorder ?? item.quantityPreordered ?? 0,
            vendor: item.quantityReceivedFromOrder,
          });
          return {
            partNumber: item.partNumber,
            description: item.description,
            remainingNeeded,
            supplier: item.type || item.supplierFromDatabase || null,
          };
        })
        .filter(item => item.remainingNeeded > 0);

      if (backorderItems.length > 0) {
        const createdBy = (session.user as any).name || (session.user as any).email || 'System';
        await sendBackorderEmail(
          body.jobNumber,
          result.lineItems[0]?.jobName || null,
          backorderItems,
          createdBy
        );
      }
    } catch (err) {
      console.error('Backorder email send failed (non-blocking):', err);
    }

    // Check if all ordered items are now received
    // If so, update Smartsheet to set the boolean column to false
    const smartsheetId = process.env.SMARTSHEET_ID;
    if (smartsheetId) {
      checkAndUpdateSmartsheetIfComplete(
        smartsheetId,
        body.jobNumber,
        result.lineItems
      ).catch(err => {
        console.error('Smartsheet update error (non-blocking):', err);
      });
    }

    // Invalidate cache for this job and related data
    cache.delete(cacheKeys.jobDetails(body.jobNumber, resolvedListNumber));
    cache.delete(cacheKeys.jobsList());
    cache.delete(cacheKeys.calendar());

    const response: UpdateJobResponse = {
      success: true,
      updatedCount: body.updates.length,
      lineItems: result.lineItems,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error in /api/jobs/update:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
