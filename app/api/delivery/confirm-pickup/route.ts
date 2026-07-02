import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, isAdmin } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { cache, cacheKeys } from "@/lib/cache";
import {
  canAccessJob,
  jobHasAccessRecords,
} from "@/lib/jobAccess";
import { getRemainingQty } from "@/lib/quantityMath";

export const dynamic = "force-dynamic";

interface PickupItem {
  jobNumber: string;
  listNumber: string;
  partNumber: string;
}

/**
 * POST /api/delivery/confirm-pickup
 * Marks selected pickup-from-supplier lines as received (sets quantityReceivedFromOrder
 * and receivedFromOrder). Uses job-level access checks so non-admin users with edit
 * permissions can also confirm pickups from the Delivery tab.
 *
 * Body: { jobNumber: string, listNumberContext?: string, items: PickupItem[] }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized - Please sign in" },
        { status: 401 },
      );
    }

    const role = (session.user as any).role;
    const userEmail = (session.user as any).email;
    const isUserAdmin = isAdmin(role);

    const body = await request.json();
    const jobNumber = body?.jobNumber?.trim();
    const listNumberContext =
      typeof body?.listNumberContext === "string"
        ? body.listNumberContext
        : null;
    const items: PickupItem[] = body?.items;

    if (!jobNumber) {
      return NextResponse.json(
        { error: "jobNumber is required" },
        { status: 400 },
      );
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "No items provided" },
        { status: 400 },
      );
    }

    if (
      !(await hasPermission(session, "job.delivery.mark_pickup", {
        jobNumber,
        listNumber: listNumberContext,
      }))
    ) {
      return NextResponse.json(
        {
          error:
            "Forbidden - You do not have permission to confirm supplier pickup",
        },
        { status: 403 },
      );
    }

    // Check job access (gatekeeping only).
    if (!isUserAdmin) {
      // Scoped to the list being acted on - a job can have access records
      // on one list but not another.
      const hasRecords = await jobHasAccessRecords(jobNumber, listNumberContext);
      if (hasRecords) {
        const hasAccess = await canAccessJob(userEmail, jobNumber, listNumberContext);
        if (!hasAccess) {
          return NextResponse.json(
            { error: "Forbidden - You do not have access to this job" },
            { status: 403 },
          );
        }
      }
      // No access records means the job is open - fall through and allow.
    }

    const normalizedItems = items.map((item) => ({
      jobNumber: item.jobNumber.trim(),
      listNumber: item.listNumber?.trim() || "1",
      partNumber: item.partNumber.trim(),
    }));

    const currentRecords = await prisma.job.findMany({
      where: {
        OR: normalizedItems.map((item) => ({
          jobNumber: item.jobNumber,
          listNumber: item.listNumber,
          partNumber: item.partNumber,
        })),
      },
    });

    const recordMap = new Map<string, (typeof currentRecords)[number]>();
    currentRecords.forEach((record) => {
      const key = `${record.jobNumber}::${record.listNumber}::${record.partNumber}`;
      recordMap.set(key, record);
    });
    const updatePromises = normalizedItems.map((item) => {
      const key = `${item.jobNumber}::${item.listNumber}::${item.partNumber}`;
      const currentRecord = recordMap.get(key);

      if (!currentRecord) {
        throw new Error(
          `Job line not found: ${item.jobNumber} (list ${item.listNumber}) ${item.partNumber}`,
        );
      }

      const quantityNeeded = currentRecord.quantityNeeded ?? 0;
      const quantityFab = currentRecord.quantityFab ?? 0;
      const quantityPulled = currentRecord.pulled ?? 0;
      const currentReceived = currentRecord.quantityReceivedFromOrder ?? 0;
      const remaining = getRemainingQty({
        needed: quantityNeeded,
        fab: quantityFab,
        shop: quantityPulled,
        preorder: Math.max(0, currentRecord.quantityPulledFromPreorder ?? 0),
        vendor: currentReceived,
      });
      const quantityReceivedFromOrder = currentReceived + remaining;

      const quantityOrdered = currentRecord.quantityOrdered ?? null;
      const isFullyReceived =
        quantityOrdered === null
          ? true
          : quantityReceivedFromOrder >= quantityOrdered;

      return prisma.job.update({
        where: {
          jobNumber_listNumber_partNumber: {
            jobNumber: currentRecord.jobNumber,
            listNumber: currentRecord.listNumber,
            partNumber: currentRecord.partNumber,
          },
        },
        data: {
          receivedFromOrder: isFullyReceived,
          quantityReceivedFromOrder,
          pickupFromSupplier: isFullyReceived
            ? false
            : currentRecord.pickupFromSupplier,
          supplierDeliveryToJobsite: isFullyReceived
            ? false
            : currentRecord.supplierDeliveryToJobsite,
          updatedAt: new Date(),
        },
      });
    });

    const results = await Promise.all(updatePromises);

    const uniqueJobNumbers = [
      ...new Set(normalizedItems.map((item) => item.jobNumber)),
    ];
    uniqueJobNumbers.forEach((jn) => {
      cache.delete(cacheKeys.jobDetails(jn));
    });
    cache.delete(cacheKeys.jobsList());
    cache.delete(cacheKeys.calendar());

    return NextResponse.json({
      success: true,
      updatedCount: results.length,
      itemCount: normalizedItems.length,
    });
  } catch (error) {
    console.error("Error in /api/delivery/confirm-pickup:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
