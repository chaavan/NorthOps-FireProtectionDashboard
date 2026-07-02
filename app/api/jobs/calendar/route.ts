import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin, resolveSessionUserRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getEffectivePermissionsForSession } from '@/lib/permissions';
import {
  canAccessJobLists,
  canViewJobType,
  getJobVisibilityPermissions,
} from '@/lib/jobVisibilityPermissions';
import {
  buildJobAccessIndex,
  canAccessJobFromIndex,
  getJobAccessRowsForJobNumbers,
} from '@/lib/jobAccess';
import { getAllDeliveryRecords } from '@/lib/deliveryDatabase';
import { toDateKeyInAppTimeZone } from '@/lib/timezone';
import { getRemainingQty } from '@/lib/quantityMath';
import { isJobPreorderEnabled } from '@/lib/featureFlags';
import { jobPreorderJobPartKey } from '@/lib/jobPreorderLines';
import {
  getCanonicalDeliveryDateMap,
  getCanonicalJobListMetadataMap,
} from '@/lib/jobListDeliveryDate';

// Force this route to be dynamic
export const dynamic = 'force-dynamic';

/**
 * Calculate job status based on job data and delivery information
 */
function calculateJobStatus(
  jobData: {
    allDelivered: boolean;
    hasUnreceivedOrders: boolean;
    hasPickupNeededUnreceivedOrders: boolean;
    hasSupplierDeliveryNeededUnreceivedOrders: boolean;
    allLookedInto: boolean;
    allOrdersReceived: boolean;
    hasOrderedItems: boolean;
    pulledCount: number;
    lineCount: number;
    hasJobPreorder: boolean;
  }
): 'white' | 'green' | 'yellow' | 'orange' | 'pink' | 'blue' | 'lime' | 'delivered' | 'not-processed' {
  // Jobs with no parts yet should be considered "Not Processed" (not delivered).
  if (jobData.lineCount === 0) {
    return 'not-processed';
  }
  if (jobData.allDelivered) {
    return 'delivered'; // Delivered jobs get special dimmed status
  } else if (!jobData.allLookedInto) {
    return 'green'; // Needs pulling - at least one part not yet looked into
  } else if (
    isJobPreorderEnabled() &&
    jobData.hasJobPreorder &&
    jobData.pulledCount < jobData.lineCount
  ) {
    return 'lime'; // All lines are pulled/ordered/pre-ordered, and at least one has pre-order material
  } else if (jobData.hasSupplierDeliveryNeededUnreceivedOrders) {
    return 'pink'; // Supplier delivery to jobsite - all outstanding ordered lines are delivery-marked
  } else if (jobData.hasPickupNeededUnreceivedOrders) {
    return 'orange'; // Supplier pickup - all outstanding ordered lines are pickup-marked
  } else if (jobData.hasUnreceivedOrders) {
    return 'yellow'; // Backorders - all looked into, at least one ordered but not received
  } else if (jobData.pulledCount === jobData.lineCount && jobData.lineCount > 0) {
    return 'blue'; // Ready for delivery (same for all jobs including service)
  } else if (jobData.pulledCount < jobData.lineCount) {
    return 'green'; // Waiting to be pulled - at least one part is not yet pulled
  } else {
    return 'white'; // Delivered
  }
}

function getJobListKey(jobNumber: string, listNumber: string | null): string {
  const normalizedList = listNumber?.trim() || '1';
  return `${jobNumber}|${normalizedList}`;
}

/**
 * GET /api/jobs/calendar
 * Returns jobs grouped by delivery date for calendar display
 */
export async function GET() {
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
      return NextResponse.json({ calendarData: {} });
    }

    // Skip server-side cache for calendar - delivery date edits must reflect immediately.
    // In-memory cache is not shared across serverless instances, causing stale data
    // when update runs on a different instance than the one serving the calendar.

    // Get all jobs with delivery dates from database
    // Using raw SQL for better performance with large datasets
    const jobsRaw = await prisma.$queryRaw<Array<{
      job_number: string;
      job_name: string;
      list_number: string | null;
      area: string | null;
      part_number: string;
      delivery_date: Date;
      pulled: number;
      quantity_pulled_from_preorder: number;
      quantity_needed: number;
      quantity_fab: number;
      quantity_ordered: number | null;
      quantity_received_from_order: number;
      ordered: boolean | null;
      received_from_order: boolean | null;
      pickup_from_supplier: boolean | null;
      supplier_delivery_to_jobsite: boolean | null;
      delivered: boolean | null;
      purchase_order_accounted_for: boolean;
    }>>`
      SELECT 
        job_number,
        job_name,
        list_number,
        area,
        part_number,
        delivery_date,
        pulled,
        quantity_pulled_from_preorder,
        quantity_needed,
        quantity_fab,
        quantity_ordered,
        quantity_received_from_order,
        ordered,
        received_from_order,
        pickup_from_supplier,
        supplier_delivery_to_jobsite,
        delivered,
        purchase_order_accounted_for
      FROM jobs
      WHERE delivery_date IS NOT NULL
      ORDER BY delivery_date ASC, job_number ASC, list_number ASC
    `;

    // Transform to match expected format
    const jobs = jobsRaw.map(job => ({
      jobNumber: job.job_number,
      jobName: job.job_name,
      listNumber: job.list_number,
      area: job.area,
      partNumber: job.part_number,
      deliveryDate: job.delivery_date,
      pulled: job.pulled,
      quantityPulledFromPreorder: job.quantity_pulled_from_preorder ?? 0,
      quantityNeeded: job.quantity_needed,
      quantityFab: job.quantity_fab || 0,
      quantityOrdered: job.quantity_ordered ?? 0,
      quantityReceivedFromOrder: job.quantity_received_from_order || 0,
      ordered: job.ordered,
      receivedFromOrder: job.received_from_order,
      pickupFromSupplier: job.pickup_from_supplier,
      supplierDeliveryToJobsite: job.supplier_delivery_to_jobsite,
      delivered: job.delivered,
      purchaseOrderAccountedFor: job.purchase_order_accounted_for,
    }));

    // Job type visibility is enforced when cards are built, after delivery metadata
    // has identified contract vs service lists.
    const filteredJobs = jobs;

    // Get all delivery records from database
    let deliveryRecords: Awaited<ReturnType<typeof getAllDeliveryRecords>> = [];
    try {
      deliveryRecords = await getAllDeliveryRecords();
      if (process.env.NODE_ENV === 'development') {
        console.log(`📅 Found ${deliveryRecords.length} delivery records`);
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('Could not fetch delivery records:', error);
      }
      // Continue without delivery records
    }
    const deliveryRecordByJobList = new Map(
      deliveryRecords.map((record) => [
        getJobListKey(record.jobNumber, record.listNumber),
        record,
      ]),
    );

    // All authenticated users see all delivery records

    const preorderLines = await prisma.jobPreorderLine.findMany({
      where: { status: { not: "CANCELLED" } },
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

    // Group by (job number + list number) so each list entry appears independently.
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
      purchaseOrderAccountedFor: boolean;
      hasJobPreorder: boolean;
    }>();

    const NO_PARTS_PLACEHOLDER_PART_NUMBER = '__NO_PARTS__';
    for (const job of filteredJobs) {
      if (!job.deliveryDate) continue;

      const key = getJobListKey(job.jobNumber, job.listNumber);
      if (!jobMap.has(key)) {
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
          purchaseOrderAccountedFor: false,
          hasJobPreorder: false,
        });
      }

      const jobData = jobMap.get(key)!;
      if (!jobData.listNumber && job.listNumber) {
        jobData.listNumber = job.listNumber;
      }
      if (!jobData.area && job.area) {
        jobData.area = job.area;
      }
      // Ignore placeholder rows used to represent "no parts yet" jobs.
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

    // Create a map of dates to jobs
    const jobsByDate = new Map<string, Array<{
      jobNumber: string;
      jobName: string;
      listNumber: string | null;
      area: string | null;
      date: string;
      lineCount: number;
      pulledCount: number;
      dateType: 'ship' | 'delivery';
      status: 'white' | 'green' | 'yellow' | 'orange' | 'pink' | 'blue' | 'lime' | 'delivered' | 'not-processed';
      allDelivered: boolean;
      isServiceJob: boolean;
      purchaseOrderAccountedFor: boolean;
    }>>();

    const distinctJobNumbers = Array.from(
      new Set(Array.from(jobMap.values()).map((j) => j.jobNumber)),
    );
    const [
      canonicalDeliveryDateByJobList,
      canonicalMetadataByJobList,
      jobAccessRows,
    ] = await Promise.all([
      getCanonicalDeliveryDateMap(),
      getCanonicalJobListMetadataMap(),
      bypassJobAccess ? Promise.resolve([]) : getJobAccessRowsForJobNumbers(distinctJobNumbers),
    ]);
    const jobAccessIndex = buildJobAccessIndex(jobAccessRows);

    // Add one calendar card per job/list using the same delivery date shown in Edit Job.
    for (const [jobKey, jobData] of jobMap.entries()) {
      const canonicalDeliveryDate = canonicalDeliveryDateByJobList.get(jobKey);
      if (!canonicalDeliveryDate) continue;
      const canonicalMetadata = canonicalMetadataByJobList.get(jobKey);

      const dateStr = toDateKeyInAppTimeZone(canonicalDeliveryDate);
      if (!jobsByDate.has(dateStr)) {
        jobsByDate.set(dateStr, []);
      }

      const isAllOutstandingPickup =
        jobData.unreceivedOrderedLineCount > 0 &&
        jobData.unreceivedPickupLineCount === jobData.unreceivedOrderedLineCount;
      const isAllOutstandingSupplierDelivery =
        jobData.unreceivedOrderedLineCount > 0 &&
        jobData.unreceivedDeliveryLineCount === jobData.unreceivedOrderedLineCount;
      jobData.hasPickupNeededUnreceivedOrders = isAllOutstandingPickup;
      jobData.hasSupplierDeliveryNeededUnreceivedOrders = isAllOutstandingSupplierDelivery;
      const deliveryRecord = deliveryRecordByJobList.get(jobKey);
      const status = calculateJobStatus({
        ...jobData,
        lineCount: jobData.lineCount,
      });
      const isServiceJob = deliveryRecord?.isServiceJob ?? false;
      if (!canViewJobType(visibility, isServiceJob)) {
        continue;
      }
      if (!bypassJobAccess) {
        const listNumberForAccess = jobData.listNumber ?? '1';
        if (
          !userEmail ||
          !canAccessJobFromIndex(jobAccessIndex, userEmail, jobData.jobNumber, listNumberForAccess)
        ) {
          continue;
        }
      }
      const isNotProcessed = jobData.lineCount === 0;

      jobsByDate.get(dateStr)!.push({
        jobNumber: jobData.jobNumber,
        jobName: canonicalMetadata?.jobName ?? jobData.jobName,
        listNumber: jobData.listNumber,
        area: canonicalMetadata?.area ?? jobData.area,
        date: dateStr,
        lineCount: jobData.lineCount,
        pulledCount: jobData.pulledCount,
        dateType: 'delivery',
        status,
        // Empty jobs (placeholder-only) should be treated as not delivered in calendar UI.
        allDelivered: isNotProcessed ? false : jobData.allDelivered,
        isServiceJob,
        purchaseOrderAccountedFor: jobData.purchaseOrderAccountedFor,
      });
    }

    // Convert to object for JSON response
    const calendarData: Record<string, Array<{
      jobNumber: string;
      jobName: string;
      listNumber: string | null;
      area: string | null;
      date: string;
      lineCount: number;
      pulledCount: number;
      dateType: 'ship' | 'delivery';
      status: 'white' | 'green' | 'yellow' | 'orange' | 'pink' | 'blue' | 'lime' | 'delivered' | 'not-processed';
      allDelivered: boolean;
      isServiceJob: boolean;
      purchaseOrderAccountedFor: boolean;
    }>> = {};

    for (const [date, jobs] of jobsByDate.entries()) {
      calendarData[date] = jobs;
    }

    const response = { calendarData };

    return NextResponse.json(response);
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error in /api/jobs/calendar:', error);
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
