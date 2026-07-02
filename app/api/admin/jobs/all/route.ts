import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin, resolveSessionUserRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAllDeliveryRecords } from '@/lib/deliveryDatabase';
import { getRemainingQty } from '@/lib/quantityMath';
import { isJobPreorderEnabled } from '@/lib/featureFlags';
import { jobPreorderJobPartKey } from '@/lib/jobPreorderLines';
import { getEffectivePermissionsForSession } from '@/lib/permissions';
import { getJobVisibilityPermissions, canAccessJobLists, canViewJobType } from '@/lib/jobVisibilityPermissions';
import {
  buildJobAccessIndex,
  canAccessJobFromIndex,
  getJobAccessRowsForJobNumbers,
} from '@/lib/jobAccess';

// Force this route to be dynamic
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/jobs/all
 * Returns jobs with their status information, filtered by job visibility permissions.
 */
export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const permissionDetails = await getEffectivePermissionsForSession(session);
    const visibility = getJobVisibilityPermissions(permissionDetails);
    const role =
      (await resolveSessionUserRole(session)) ?? (session.user as any).role;
    const bypassJobAccess =
      isAdmin(role) ||
      permissionDetails?.isDeveloper === true ||
      permissionDetails?.isSuperAdmin === true;
    const userEmail = (session.user as any).email?.trim().toLowerCase() ?? null;
    if (!canAccessJobLists(visibility)) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to view jobs' },
        { status: 403 },
      );
    }

    // Get all jobs from database
    const NO_PARTS_PLACEHOLDER_PART_NUMBER = '__NO_PARTS__';

    const allJobs = await prisma.job.findMany({
      select: {
        jobNumber: true,
        jobName: true,
        listNumber: true,
        area: true,
        stocklistDeliveryShipDate: true,
        deliveryDate: true,
        pulled: true,
        quantityPulledFromPreorder: true,
        quantityNeeded: true,
        quantityFab: true,
        quantityOrdered: true,
        quantityReceivedFromOrder: true,
        ordered: true,
        receivedFromOrder: true,
        pickupFromSupplier: true,
        supplierDeliveryToJobsite: true,
        delivered: true,
        purchaseOrderAccountedFor: true,
        partNumber: true,
        createdAt: true,
        updatedAt: true,
        creatorTimezone: true,
      },
      orderBy: [
        { jobNumber: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    const distinctJobNumbers = Array.from(
      new Set(allJobs.map((job) => job.jobNumber)),
    );
    const jobAccessRows = bypassJobAccess
      ? []
      : await getJobAccessRowsForJobNumbers(distinctJobNumbers);
    const jobAccessIndex = buildJobAccessIndex(jobAccessRows);

    const preorderLines = await prisma.jobPreorderLine.findMany({
      where: { status: { not: 'CANCELLED' } },
      select: {
        jobNumber: true,
        partNumber: true,
        quantity: true,
        quantityReceived: true,
      },
    });
    const jobPartsWithPreorder = new Set<string>();
    const jobPartsWithOpenPreorder = new Set<string>();
    for (const line of preorderLines) {
      const partKey = jobPreorderJobPartKey(line.jobNumber, line.partNumber);
      jobPartsWithPreorder.add(partKey);
      if (line.quantity - line.quantityReceived > 0) {
        jobPartsWithOpenPreorder.add(partKey);
      }
    }

    // Get all delivery records
    let deliveryRecords: Awaited<ReturnType<typeof getAllDeliveryRecords>> = [];
    try {
      deliveryRecords = await getAllDeliveryRecords();
    } catch (error) {
      console.warn('Could not fetch delivery records:', error);
    }
    const deliveryRecordByJobList = new Map(
      deliveryRecords.map((record) => [
        `${record.jobNumber}|${record.listNumber?.trim() || '1'}`,
        record,
      ]),
    );

    // Group jobs by (jobNumber, listNumber) so each list appears as its own row
    const jobMap = new Map<string, {
      jobNumber: string;
      jobName: string;
      listNumber: string | null;
      area: string | null;
      lineCount: number;
      pulledCount: number;
      hasOrderedItems: boolean;
      hasUnreceivedOrders: boolean;
      hasPickupNeededUnreceivedOrders: boolean;
      hasSupplierDeliveryNeededUnreceivedOrders: boolean;
      unreceivedOrderedLineCount: number;
      unreceivedPickupLineCount: number;
      unreceivedDeliveryLineCount: number;
      allLookedInto: boolean;
      allOrdersReceived: boolean;
      allDelivered: boolean;
      listDate: Date | null;
      deliveryDate: Date | null;
      createdAt: Date;
      updatedAt: Date;
      creatorTimezone: string | null;
      isServiceJob: boolean;
      purchaseOrderAccountedFor: boolean;
      hasJobPreorder: boolean;
    }>();

    for (const job of allJobs) {
      const listNum = job.listNumber ?? '1';
      const key = `${job.jobNumber}|${listNum}`;
      if (!jobMap.has(key)) {
        const delivery = deliveryRecordByJobList.get(key);
        jobMap.set(key, {
          jobNumber: job.jobNumber,
          jobName: job.jobName,
          listNumber: job.listNumber,
          area: job.area,
          lineCount: 0,
          pulledCount: 0,
          hasOrderedItems: false,
          hasUnreceivedOrders: false,
          hasPickupNeededUnreceivedOrders: false,
          hasSupplierDeliveryNeededUnreceivedOrders: false,
          unreceivedOrderedLineCount: 0,
          unreceivedPickupLineCount: 0,
          unreceivedDeliveryLineCount: 0,
          allLookedInto: true,
          allOrdersReceived: true,
          allDelivered: true,
          listDate: job.stocklistDeliveryShipDate ? new Date(job.stocklistDeliveryShipDate) : null,
          deliveryDate: job.deliveryDate ? new Date(job.deliveryDate) : (delivery?.date ? new Date(delivery.date) : null),
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          creatorTimezone: job.creatorTimezone ?? null,
          // Service job flag is strictly per (jobNumber, listNumber)
          isServiceJob: delivery?.isServiceJob ?? false,
          purchaseOrderAccountedFor: false,
          hasJobPreorder: false,
        });
      }

      const jobData = jobMap.get(key)!;
      // Ignore placeholder rows used to create "no parts yet" jobs.
      if (job.partNumber === NO_PARTS_PLACEHOLDER_PART_NUMBER) {
        if (job.purchaseOrderAccountedFor === true) {
          jobData.purchaseOrderAccountedFor = true;
        }
        continue;
      }

      jobData.lineCount++;
      const partKey = jobPreorderJobPartKey(job.jobNumber, job.partNumber);
      if (isJobPreorderEnabled() && jobPartsWithPreorder.has(partKey)) {
        jobData.hasJobPreorder = true;
      }

      const preorderPulled = isJobPreorderEnabled()
        ? Math.max(0, job.quantityPulledFromPreorder ?? 0)
        : 0;
      const remaining = getRemainingQty({
        needed: job.quantityNeeded,
        fab: job.quantityFab,
        shop: job.pulled,
        preorder: preorderPulled,
        vendor: job.quantityReceivedFromOrder,
      });
      if (remaining === 0) {
        jobData.pulledCount++;
      }

      // Track if line is "looked into" (remaining is 0, or purchaser has acted by ordering it)
      const lookedInto =
        remaining <= 0 ||
        job.ordered === true ||
        (isJobPreorderEnabled() &&
          (preorderPulled > 0 || jobPartsWithOpenPreorder.has(partKey)));
      if (!lookedInto) {
        jobData.allLookedInto = false;
      }

      // Track order status
      if (job.ordered === true) {
        jobData.hasOrderedItems = true;
        if (job.receivedFromOrder !== true) {
          jobData.hasUnreceivedOrders = true;
          jobData.unreceivedOrderedLineCount += 1;
          if (job.pickupFromSupplier === true) {
            jobData.unreceivedPickupLineCount += 1;
          }
          if (job.supplierDeliveryToJobsite === true) {
            jobData.unreceivedDeliveryLineCount += 1;
          }
        }
      }

      // Track if all orders are received
      if (job.ordered === true && job.receivedFromOrder !== true) {
        jobData.allOrdersReceived = false;
      }

      // Track if all items are delivered
      if (job.delivered !== true) {
        jobData.allDelivered = false;
      }

      if (job.purchaseOrderAccountedFor === true) {
        jobData.purchaseOrderAccountedFor = true;
      }
    }

    // Convert to array and calculate status
    const jobsWithStatus = Array.from(jobMap.values()).flatMap(jobData => {
      if (!canViewJobType(visibility, jobData.isServiceJob)) {
        return [];
      }
      if (!bypassJobAccess) {
        const listNumberForAccess = jobData.listNumber ?? '1';
        if (
          !userEmail ||
          !canAccessJobFromIndex(jobAccessIndex, userEmail, jobData.jobNumber, listNumberForAccess)
        ) {
          return [];
        }
      }

      // Jobs that exist but have no real parts yet should not be treated as "Delivered".
      // They should show as "Not Processed" until real parts are added.
      if (jobData.lineCount === 0) {
        return [{
          ...jobData,
          allDelivered: false,
          status: 'not-processed',
          completionPercentage: 0,
        }];
      }

      const isAllOutstandingPickup =
        jobData.unreceivedOrderedLineCount > 0 &&
        jobData.unreceivedPickupLineCount === jobData.unreceivedOrderedLineCount;
      const isAllOutstandingSupplierDelivery =
        jobData.unreceivedOrderedLineCount > 0 &&
        jobData.unreceivedDeliveryLineCount === jobData.unreceivedOrderedLineCount;
      jobData.hasPickupNeededUnreceivedOrders = isAllOutstandingPickup;
      jobData.hasSupplierDeliveryNeededUnreceivedOrders = isAllOutstandingSupplierDelivery;

      // Determine job status
      let status:
        | 'white'
        | 'green'
        | 'yellow'
        | 'orange'
        | 'pink'
        | 'blue'
        | 'lime'
        | 'not-processed' = 'white';
      if (jobData.allDelivered) {
        status = 'white'; // Delivered jobs (will be shown as black in UI)
      } else if (!jobData.allLookedInto) {
        status = 'green'; // Needs pulling - at least one part not yet looked into
      } else if (
        isJobPreorderEnabled() &&
        jobData.hasJobPreorder &&
        jobData.pulledCount < jobData.lineCount
      ) {
        status = 'lime'; // All lines are pulled/ordered/pre-ordered, and at least one has pre-order material
      } else if (jobData.hasSupplierDeliveryNeededUnreceivedOrders) {
        status = 'pink'; // Supplier delivery to jobsite - all outstanding ordered lines are delivery-marked
      } else if (jobData.hasPickupNeededUnreceivedOrders) {
        status = 'orange'; // Supplier pickup - all outstanding ordered lines are pickup-marked
      } else if (jobData.hasUnreceivedOrders) {
        status = 'yellow'; // Backorders - all looked into, at least one ordered but not received
      } else if (jobData.pulledCount === jobData.lineCount && jobData.lineCount > 0) {
        // All parts are pulled - ready to deliver (same status for all jobs including service)
        status = 'blue';
      } else if (jobData.pulledCount < jobData.lineCount) {
        status = 'green'; // Waiting to be pulled - at least one part is not yet pulled
      } else {
        status = 'white'; // Delivered/just entered
      }

      return [{
        ...jobData,
        status,
        completionPercentage: jobData.lineCount > 0
          ? Math.round((jobData.pulledCount / jobData.lineCount) * 100)
          : 0,
      }];
    });

    // Sort by job number (descending - newest first), then by list number (descending)
    jobsWithStatus.sort((a, b) => {
      const nameA = (a.jobName ?? '').toLowerCase();
      const nameB = (b.jobName ?? '').toLowerCase();
      const nameCmp = nameA.localeCompare(nameB);
      if (nameCmp !== 0) return nameCmp;
      const jobCmp = (a.jobNumber ?? '').localeCompare(b.jobNumber ?? '');
      if (jobCmp !== 0) return jobCmp;
      const listA = (a.listNumber ?? '1').padStart(10, '0');
      const listB = (b.listNumber ?? '1').padStart(10, '0');
      return listA.localeCompare(listB);
    });

    const response = NextResponse.json({
      jobs: jobsWithStatus,
      total: jobsWithStatus.length,
    });
    // Prevent caching so service job and other delivery flags stay in sync after edits
    response.headers.set('Cache-Control', 'no-store, max-age=0');
    return response;
  } catch (error) {
    console.error('Error in /api/admin/jobs/all:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
