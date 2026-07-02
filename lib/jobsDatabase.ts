import { prisma } from "./prisma";
import { getSuppliersForParts, updatePartPriceToZero } from "./partsDatabase";
import type {
  JobLineItem,
  JobInfo,
  JobDetailsResponse,
  JobListResponse,
  LineItemUpdate,
} from "./types";
import { getRemainingQty, MAX_JOB_LINE_QUANTITY, normalizeJobLineQuantity } from "./quantityMath";
import { NO_PARTS_PLACEHOLDER_PART_NUMBER } from "./jobImportConstants";
import { validatePreorderPullForJob } from "./jobPreorderLines";

/**
 * Create a unique rowIndex from jobNumber, listNumber, and partNumber
 * This ensures each line item has a unique identifier for React keys and state management,
 * including when the same job has multiple lists with the same part number.
 */
function createUniqueRowIndex(
  jobNumber: string,
  listNumber: string,
  partNumber: string
): number {
  const list = listNumber ?? "1";
  const combined = `${jobNumber}|${list}|${partNumber}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Make it positive and add 2 to ensure it's >= 2 (matching Google Sheets row numbers)
  return Math.abs(hash) + 2;
}

function deriveDisplayNameFromEmail(email: string): string {
  const local = email.split("@")[0] || email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeNonNegativeQuantity(value: number | null | undefined): number {
  return normalizeJobLineQuantity(value);
}

function normalizeFabQuantity(
  quantityFab: number | null | undefined,
  quantityNeeded: number | null | undefined,
): number {
  const needed = normalizeNonNegativeQuantity(quantityNeeded);
  const fab = normalizeNonNegativeQuantity(quantityFab);
  return Math.min(fab, needed);
}

function compareJobsByStoredOrder(
  a: { lineOrder: number | null; partNumber: string },
  b: { lineOrder: number | null; partNumber: string },
): number {
  const aHasOrder = a.lineOrder !== null && a.lineOrder !== undefined;
  const bHasOrder = b.lineOrder !== null && b.lineOrder !== undefined;
  if (aHasOrder && bHasOrder) {
    if ((a.lineOrder ?? 0) !== (b.lineOrder ?? 0)) {
      return (a.lineOrder ?? 0) - (b.lineOrder ?? 0);
    }
    return a.partNumber.localeCompare(b.partNumber);
  }
  if (aHasOrder !== bHasOrder) {
    return aHasOrder ? -1 : 1;
  }
  return a.partNumber.localeCompare(b.partNumber);
}

async function isManualOrderLocked(
  jobNumber: string,
  listNumber: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ manual_line_order_locked: boolean }>>`
    SELECT manual_line_order_locked
    FROM jobs
    WHERE job_number = ${jobNumber.trim()}
      AND list_number = ${listNumber}
      AND manual_line_order_locked = true
    LIMIT 1
  `;
  return rows.length > 0;
}

async function setManualOrderLockedForList(
  jobNumber: string,
  listNumber: string,
  locked: boolean,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE jobs
    SET manual_line_order_locked = ${locked}
    WHERE job_number = ${jobNumber.trim()}
      AND list_number = ${listNumber}
  `;
}

/**
 * Convert a database Job record to a JobLineItem
 */
function dbJobToLineItem(job: any, listedByName?: string | null): JobLineItem {
  return {
    rowIndex: createUniqueRowIndex(
      job.jobNumber,
      job.listNumber ?? "1",
      job.partNumber
    ),
    jobNumber: job.jobNumber,
    jobName: job.jobName,
    contractNumber: job.contractNumber,
    listNumber: job.listNumber,
    area: job.area,
    location: job.locationShipTo,
    stocklistDate: job.stocklistDeliveryShipDate
      ? new Date(job.stocklistDeliveryShipDate).toISOString().split("T")[0]
      : null,
    uom: job.unitOfMeasurement,
    quantityNeeded: job.quantityNeeded,
    quantityFab: job.quantityFab ?? 0,
    quantityOrdered: job.quantityOrdered,
    quantityPulled: job.pulled,
    quantityPulledFromPreorder: job.quantityPulledFromPreorder ?? 0,
    quantityPreordered: job.quantityPulledFromPreorder ?? 0,
    quantityReceivedFromOrder: job.quantityReceivedFromOrder ?? 0,
    lineOrder: job.lineOrder ?? null,
    pickupFromSupplier: job.pickupFromSupplier ?? false,
    supplierDeliveryToJobsite: job.supplierDeliveryToJobsite ?? false,
    partNumber: job.partNumber,
    description: job.description,
    pulledBy: job.pulledBy,
    pulledDate: job.pulledDate
      ? new Date(job.pulledDate).toISOString().split("T")[0]
      : null,
    ordered: job.ordered ? "Yes" : job.ordered === false ? "" : null,
    receivedFromOrder: job.receivedFromOrder
      ? "Yes"
      : job.receivedFromOrder === false
        ? ""
        : null,
    delivered: job.delivered ? "Yes" : job.delivered === false ? "" : null,
    type: job.type,
    manualCost:
      job.manualCost === null || job.manualCost === undefined
        ? null
        : Number(job.manualCost),
    listedBy: job.listedBy || null,
    listedByName: listedByName ?? null,
  };
}

/**
 * Get all jobs from the database
 */
export async function getAllJobsFromDatabase(): Promise<JobLineItem[]> {
  const jobs = await prisma.job.findMany({
    orderBy: [{ jobNumber: "desc" }, { partNumber: "asc" }],
  });
  return jobs.map((job) => dbJobToLineItem(job));
}

/**
 * Get a list of all unique jobs with summary information (paginated for performance)
 */
export async function getJobListFromDatabase(): Promise<JobListResponse> {
  // Limit to 100 jobs initially to prevent loading thousands of jobs on mobile
  // This significantly improves load time on iPad (10-20ms vs 100-200ms for full dataset)
  const allJobs = await prisma.job.findMany({
    orderBy: [{ jobNumber: "desc" }, { partNumber: "asc" }],
    take: 100, // Fetch first 100 jobs for initial load
  });
  // Group by job number.
  // Include listNumbers from all rows (including the placeholder row),
  // but exclude the placeholder row from items so lineCount/pulledCount stay accurate.
  const jobMap = new Map<
    string,
    { name: string; items: JobLineItem[]; listNumbers: Set<string> }
  >();

  for (const job of allJobs) {
    if (!jobMap.has(job.jobNumber)) {
      jobMap.set(job.jobNumber, {
        name: job.jobName,
        items: [],
        listNumbers: new Set<string>(),
      });
    }

    const bucket = jobMap.get(job.jobNumber)!;
    bucket.listNumbers.add(job.listNumber ?? "1");

    if (job.partNumber !== NO_PARTS_PLACEHOLDER_PART_NUMBER) {
      bucket.items.push(dbJobToLineItem(job));
    }
  }

  // Convert to JobInfo array
  const jobs: JobInfo[] = Array.from(jobMap.entries()).map(
    ([jobNumber, data]) => {
      const pulledCount = data.items.filter((item) => {
        return (
          getRemainingQty({
            needed: item.quantityNeeded,
            fab: item.quantityFab,
            shop: item.quantityPulled,
            preorder: item.quantityPulledFromPreorder,
            vendor: item.quantityReceivedFromOrder,
          }) === 0
        );
      }).length;

      return {
        jobNumber,
        jobName: data.name,
        lineCount: data.items.length,
        pulledCount,
        listNumbers: Array.from(data.listNumbers).sort(),
      };
    },
  );

  // Sort by job number (descending, so newest jobs appear first)
  jobs.sort((a, b) => b.jobNumber.localeCompare(a.jobNumber));

  return { jobs };
}

export type JobListSummary = {
  listNumber: string;
  area: string | null;
};

/**
 * Distinct list numbers for a job with the first non-empty area per list.
 */
export async function getJobListSummariesForJob(
  jobNumber: string,
): Promise<JobListSummary[]> {
  const rows = await prisma.job.findMany({
    where: { jobNumber: jobNumber.trim() },
    select: { listNumber: true, area: true },
    orderBy: { listNumber: "asc" },
  });

  const byList = new Map<string, string | null>();
  for (const row of rows) {
    const listNumber = row.listNumber?.trim() || "1";
    const area = row.area?.trim() || null;
    if (!byList.has(listNumber)) {
      byList.set(listNumber, area);
    } else if (!byList.get(listNumber) && area) {
      byList.set(listNumber, area);
    }
  }

  return Array.from(byList.entries())
    .map(([listNumber, area]) => ({ listNumber, area }))
    .sort((a, b) => a.listNumber.localeCompare(b.listNumber));
}

/**
 * Get all line items for a specific job
 */
export async function getJobLinesFromDatabase(
  jobNumber: string,
  listNumber?: string | null,
): Promise<JobDetailsResponse> {
  const normalizedListNumber = listNumber?.trim() || null;
  const jobs = await prisma.job.findMany({
    where: {
      jobNumber: jobNumber.trim(),
      ...(normalizedListNumber ? { listNumber: normalizedListNumber } : {}),
    },
    orderBy: [
      { listNumber: "asc" },
      { lineOrder: "asc" },
      { partNumber: "asc" },
    ],
  });

  if (jobs.length === 0) {
    throw new Error(`No line items found for job number: ${jobNumber}`);
  }

  const realJobs = jobs.filter(
    (job) => job.partNumber !== NO_PARTS_PLACEHOLDER_PART_NUMBER,
  );

  if (realJobs.length === 0) {
    const firstRow = jobs[0];
    return {
      jobNumber: firstRow.jobNumber,
      jobName: firstRow.jobName,
      lineItems: [],
      jobMeta: {
        listNumber: firstRow.listNumber ?? "1",
        area: firstRow.area ?? null,
        locationShipTo: firstRow.locationShipTo ?? null,
        stocklistDeliveryShipDate: firstRow.stocklistDeliveryShipDate
          ? new Date(firstRow.stocklistDeliveryShipDate).toISOString().split("T")[0]
          : null,
        listedBy: firstRow.listedBy?.trim() || null,
        listedByName: null,
        purchaseOrderAccountedFor: firstRow.purchaseOrderAccountedFor ?? false,
      },
    };
  }

  const listedByEmails = Array.from(
    new Set(
      realJobs
        .map((job) => job.listedBy?.trim())
        .filter((email): email is string => !!email)
        .map((email) => email.toLowerCase()),
    ),
  );

  const listedByNameMap = new Map<string, string>();
  if (listedByEmails.length > 0) {
    const users = await prisma.user.findMany({
      where: {
        email: { in: listedByEmails },
      },
      select: {
        email: true,
        name: true,
      },
    });

    users.forEach((user) => {
      const key = user.email.toLowerCase();
      const displayName = user.name?.trim() || deriveDisplayNameFromEmail(user.email);
      listedByNameMap.set(key, displayName);
    });
  }

  const lineItems = realJobs.map((job) => {
    const listedByEmail = job.listedBy?.trim() || null;
    const listedByName = listedByEmail
      ? listedByNameMap.get(listedByEmail.toLowerCase()) || deriveDisplayNameFromEmail(listedByEmail)
      : null;
    return dbJobToLineItem(job, listedByName);
  });

  const firstRealRow = realJobs[0];
  const listedByEmail = firstRealRow.listedBy?.trim() || null;
  const listedByName = listedByEmail
    ? listedByNameMap.get(listedByEmail.toLowerCase()) ||
      deriveDisplayNameFromEmail(listedByEmail)
    : null;

  return {
    jobNumber: jobs[0].jobNumber,
    jobName: jobs[0].jobName,
    lineItems,
    jobMeta: {
      listNumber: firstRealRow.listNumber ?? "1",
      area: firstRealRow.area ?? null,
      locationShipTo: firstRealRow.locationShipTo ?? null,
      stocklistDeliveryShipDate: firstRealRow.stocklistDeliveryShipDate
        ? new Date(firstRealRow.stocklistDeliveryShipDate).toISOString().split("T")[0]
        : null,
      listedBy: listedByEmail,
      listedByName,
      purchaseOrderAccountedFor: firstRealRow.purchaseOrderAccountedFor ?? false,
    },
  };
}

/**
 * Update multiple line items in batch
 * Maps rowIndex (unique hash from jobNumber + partNumber) to partNumber for database updates
 */
export async function updateJobLinesFromDatabase(
  jobNumber: string,
  updates: LineItemUpdate[],
): Promise<JobDetailsResponse> {
  if (updates.length === 0) {
    throw new Error("No updates provided");
  }

  // First, get current job lines to map rowIndex to partNumber and listNumber
  const currentJob = await getJobLinesFromDatabase(jobNumber);
  const lineOrderUpdates = updates.filter(
    (update) => update.lineOrder !== undefined && update.lineOrder !== null,
  );

  if (lineOrderUpdates.length > 0) {
    const rowToItem = new Map(
      currentJob.lineItems.map((item) => [item.rowIndex, item]),
    );
    const targetLists = new Set<string>();
    const targetRowIndices = new Set<number>();
    const requestedLineOrders = new Set<number>();

    for (const update of lineOrderUpdates) {
      const item = rowToItem.get(update.rowIndex);
      if (!item) {
        throw new Error(`Could not find line item for rowIndex ${update.rowIndex}`);
      }
      targetLists.add(item.listNumber || "1");
      targetRowIndices.add(update.rowIndex);

      const normalizedLineOrder = normalizeNonNegativeQuantity(update.lineOrder);
      if (normalizedLineOrder < 1) {
        throw new Error("lineOrder values must be >= 1.");
      }
      requestedLineOrders.add(normalizedLineOrder);
    }

    if (targetLists.size !== 1) {
      throw new Error("lineOrder updates must target exactly one list.");
    }

    const targetListNumber = Array.from(targetLists)[0];
    const targetListRows = currentJob.lineItems.filter(
      (item) => (item.listNumber || "1") === targetListNumber,
    );

    if (targetListRows.length !== lineOrderUpdates.length) {
      throw new Error("lineOrder updates must include every row in the current list.");
    }

    for (const item of targetListRows) {
      if (!targetRowIndices.has(item.rowIndex)) {
        throw new Error("lineOrder updates must include every row in the current list.");
      }
    }

    if (requestedLineOrders.size !== targetListRows.length) {
      throw new Error("lineOrder updates must be unique within the current list.");
    }

    for (let expected = 1; expected <= targetListRows.length; expected += 1) {
      if (!requestedLineOrders.has(expected)) {
        throw new Error("lineOrder updates must be contiguous starting at 1.");
      }
    }
  }

  // Create a mapping from rowIndex to partNumber and listNumber
  // rowIndex is now a unique hash generated from jobNumber + partNumber
  const rowIndexToItem = new Map<
    number,
    {
      partNumber: string;
      listNumber: string;
      quantityNeeded: number;
      quantityFab: number;
    }
  >();
  currentJob.lineItems.forEach((item) => {
    if (item.partNumber && item.rowIndex > 0) {
      // Map the unique rowIndex to partNumber and listNumber
      rowIndexToItem.set(item.rowIndex, {
        partNumber: item.partNumber,
        listNumber: item.listNumber || "1",
        quantityNeeded: normalizeNonNegativeQuantity(item.quantityNeeded),
        quantityFab: normalizeFabQuantity(
          item.quantityFab,
          item.quantityNeeded,
        ),
      });
    }
  });

  // Process each update
  const updatePromises = updates.map(async (update) => {
    // Get old partNumber and listNumber from rowIndex
    const itemInfo = rowIndexToItem.get(update.rowIndex);

    if (!itemInfo) {
      console.warn(
        `Could not find item for rowIndex ${update.rowIndex} in job ${jobNumber}`,
      );
      return;
    }

    const oldPartNumber = itemInfo.partNumber;
    const listNumber = itemInfo.listNumber;

    // Check if partNumber is being changed
    const newPartNumber = update.partNumber?.trim();
    const isPartNumberChanging =
      newPartNumber && newPartNumber !== oldPartNumber.trim();

    if (isPartNumberChanging) {
      // Part number is changing - need to delete old record and create new one
      console.log(
        `[updateJobLines] Part number changing from "${oldPartNumber}" to "${newPartNumber}"`,
      );

      // Get current record data
      const currentRecord = await prisma.job.findUnique({
        where: {
          jobNumber_listNumber_partNumber: {
            jobNumber: jobNumber.trim(),
            listNumber: listNumber,
            partNumber: oldPartNumber,
          },
        },
      });

      if (!currentRecord) {
        console.warn(
          `Could not find record for job ${jobNumber}, list ${listNumber}, part ${oldPartNumber}`,
        );
        return;
      }

      // Check if new part number already exists
      const existingNewRecord = await prisma.job.findUnique({
        where: {
          jobNumber_listNumber_partNumber: {
            jobNumber: jobNumber.trim(),
            listNumber: listNumber,
            partNumber: newPartNumber,
          },
        },
      });

      if (existingNewRecord) {
        throw new Error(
          `A line item with this job number, list number, and part number already exists. Cannot change part number to "${newPartNumber}".`,
        );
      }

      const nextQuantityNeeded =
        update.quantityNeeded !== undefined
          ? normalizeNonNegativeQuantity(update.quantityNeeded)
          : normalizeNonNegativeQuantity(currentRecord.quantityNeeded);
      const nextQuantityFab =
        update.quantityFab !== undefined
          ? normalizeFabQuantity(update.quantityFab, nextQuantityNeeded)
          : normalizeFabQuantity(currentRecord.quantityFab ?? 0, nextQuantityNeeded);

      // Build new record data, preserving all existing fields and applying updates
      const newRecordData: any = {
        jobNumber: jobNumber.trim(),
        jobName: currentRecord.jobName,
        listNumber: listNumber,
        partNumber: newPartNumber,
        quantityNeeded: nextQuantityNeeded,
        quantityFab: nextQuantityFab,
        pulled:
          update.quantityPulled !== undefined
            ? update.quantityPulled
            : currentRecord.pulled,
        contractNumber: currentRecord.contractNumber,
        area: currentRecord.area,
        locationShipTo: currentRecord.locationShipTo,
        stocklistDeliveryShipDate: currentRecord.stocklistDeliveryShipDate,
        deliveryDate: currentRecord.deliveryDate,
        unitOfMeasurement:
          update.uom !== undefined
            ? update.uom || null
            : currentRecord.unitOfMeasurement,
        description:
          update.description !== undefined
            ? update.description || null
            : currentRecord.description,
        pulledBy:
          update.pulledBy !== undefined
            ? update.pulledBy || null
            : currentRecord.pulledBy,
        pulledDate:
          update.pulledDate !== undefined
            ? update.pulledDate
              ? new Date(update.pulledDate)
              : null
            : currentRecord.pulledDate,
        ordered:
          update.ordered !== undefined
            ? update.ordered === "Yes" ||
              update.ordered === "yes" ||
              update.ordered === "YES"
            : currentRecord.ordered,
        receivedFromOrder:
          update.receivedFromOrder !== undefined
            ? update.receivedFromOrder === "Yes" ||
              update.receivedFromOrder === "yes" ||
              update.receivedFromOrder === "YES"
            : currentRecord.receivedFromOrder,
        pickupFromSupplier: currentRecord.pickupFromSupplier ?? false,
        supplierDeliveryToJobsite:
          currentRecord.supplierDeliveryToJobsite ?? false,
        delivered: currentRecord.delivered,
        purchaseOrderAccountedFor:
          currentRecord.purchaseOrderAccountedFor ?? false,
        quantityOrdered:
          update.quantityOrdered !== undefined
            ? update.quantityOrdered === null
              ? null
              : update.quantityOrdered
            : currentRecord.quantityOrdered,
        quantityReceivedFromOrder:
          update.quantityReceivedFromOrder !== undefined
            ? update.quantityReceivedFromOrder
            : (currentRecord.quantityReceivedFromOrder ?? 0),
        lineOrder:
          update.lineOrder !== undefined
            ? normalizeNonNegativeQuantity(update.lineOrder)
            : currentRecord.lineOrder ?? null,
        updatedAt: new Date(),
      };

      // Handle type/supplier
      if (update.supplier !== undefined) {
        newRecordData.type = update.supplier || null;
      } else if (update.type !== undefined) {
        newRecordData.type = update.type || null;
      } else {
        newRecordData.type = currentRecord.type;
      }

      // Delete old record and create new one in a transaction
      await prisma.$transaction([
        prisma.job.delete({
          where: {
            jobNumber_listNumber_partNumber: {
              jobNumber: jobNumber.trim(),
              listNumber: listNumber,
              partNumber: oldPartNumber,
            },
          },
        }),
        prisma.job.create({
          data: newRecordData,
        }),
      ]);

      console.log(
        `[updateJobLines] Successfully changed part number from "${oldPartNumber}" to "${newPartNumber}"`,
      );
      return;
    }

    // Part number is not changing - proceed with normal update
    const partNumber = oldPartNumber;

    console.log(
      `[updateJobLines] Updating item ${jobNumber}::${partNumber} with data:`,
      {
        quantityNeeded: update.quantityNeeded,
        quantityFab: update.quantityFab,
        ordered: update.ordered,
        receivedFromOrder: update.receivedFromOrder,
        quantityOrdered: update.quantityOrdered,
        quantityReceivedFromOrder: update.quantityReceivedFromOrder,
        quantityPulled: update.quantityPulled,
      },
    );

    // Build update data
    const updateData: any = {};

    if (update.quantityPulled !== undefined) {
      updateData.pulled = update.quantityPulled;
    }

    if (update.quantityPulledFromPreorder !== undefined) {
      const nextPreorderPull = Math.max(
        0,
        Math.trunc(Number(update.quantityPulledFromPreorder || 0)),
      );
      const otherRows = await prisma.job.findMany({
        where: {
          jobNumber: jobNumber.trim(),
          partNumber,
          listNumber: { not: listNumber },
        },
        select: { quantityPulledFromPreorder: true },
      });
      const otherPulled = otherRows.reduce(
        (sum, row) => sum + Math.max(0, row.quantityPulledFromPreorder ?? 0),
        0,
      );
      const validation = await validatePreorderPullForJob({
        jobNumber,
        partNumber,
        nextTotalPulled: otherPulled + nextPreorderPull,
      });
      if (!validation.ok) {
        throw new Error(validation.message);
      }
      updateData.quantityPulledFromPreorder = nextPreorderPull;
    }

    if (update.pulledBy !== undefined) {
      updateData.pulledBy = update.pulledBy || null;
    }

    if (update.pulledDate !== undefined) {
      updateData.pulledDate = update.pulledDate
        ? new Date(update.pulledDate)
        : null;
    }

    if (update.ordered !== undefined) {
      const orderedValue =
        update.ordered === "Yes" ||
        update.ordered === "yes" ||
        update.ordered === "YES";
      updateData.ordered = orderedValue;
      console.log(
        `[updateJobLines] Setting ordered for ${partNumber}: "${update.ordered}" -> ${orderedValue}`,
      );
    }

    if (update.receivedFromOrder !== undefined) {
      const receivedValue =
        update.receivedFromOrder === "Yes" ||
        update.receivedFromOrder === "yes" ||
        update.receivedFromOrder === "YES";
      updateData.receivedFromOrder = receivedValue;
      console.log(
        `[updateJobLines] Setting receivedFromOrder for ${partNumber}: "${update.receivedFromOrder}" -> ${receivedValue}`,
      );
    }

    if (update.quantityReceivedFromOrder !== undefined) {
      updateData.quantityReceivedFromOrder = update.quantityReceivedFromOrder;
    }

    if (update.lineOrder !== undefined) {
      updateData.lineOrder = normalizeNonNegativeQuantity(update.lineOrder);
    }

    if (update.description !== undefined) {
      updateData.description = update.description || null;
    }

    if (update.uom !== undefined) {
      updateData.unitOfMeasurement = update.uom || null;
    }

    const currentNeeded = normalizeNonNegativeQuantity(itemInfo.quantityNeeded);
    const nextQuantityNeeded =
      update.quantityNeeded !== undefined
        ? normalizeNonNegativeQuantity(update.quantityNeeded)
        : currentNeeded;
    const currentFab = normalizeFabQuantity(itemInfo.quantityFab, currentNeeded);
    const nextQuantityFab =
      update.quantityFab !== undefined
        ? normalizeFabQuantity(update.quantityFab, nextQuantityNeeded)
        : normalizeFabQuantity(currentFab, nextQuantityNeeded);

    if (update.quantityNeeded !== undefined) {
      updateData.quantityNeeded = nextQuantityNeeded;
    }
    if (update.quantityFab !== undefined || update.quantityNeeded !== undefined) {
      updateData.quantityFab = nextQuantityFab;
    }

    if (update.quantityOrdered !== undefined) {
      // If quantityOrdered is explicitly null, set it to null in database
      // Otherwise, set it to the provided value
      updateData.quantityOrdered =
        update.quantityOrdered === null ? null : update.quantityOrdered;
    }

    if (update.manualCost !== undefined) {
      updateData.manualCost =
        update.manualCost === null ? null : update.manualCost;
    }

    // Handle supplier change - supplier takes precedence over type field
    // Supplier is stored in the type field (since that's where supplier info is stored in jobs)
    if (update.supplier !== undefined) {
      console.log(
        `[updateJobLines] Processing supplier update for partNumber ${partNumber}:`,
        update.supplier,
      );
      // Get the database supplier for this part number (only if supplier is not empty)
      if (update.supplier) {
        const dbSuppliers = await getSuppliersForParts([partNumber]);
        const dbSupplier = dbSuppliers.get(partNumber);

        // Normalize supplier names for comparison (handle variations)
        const normalizeSupplier = (
          supplier: string | null | undefined,
        ): string => {
          if (!supplier) return "";
          return supplier
            .toUpperCase()
            .trim()
            .replace(/CORE\s*&\s*MAIN/gi, "CORE & MAIN")
            .replace(/CORE\s*MAIN/gi, "CORE & MAIN")
            .replace(/ETNA/gi, "ETNA")
            .replace(/GALLOUP/gi, "GALLOUP")
            .replace(/VIKING/gi, "VIKING")
            .replace(/ARGCO/gi, "ARGCO");
        };

        const selectedSupplier = normalizeSupplier(update.supplier);
        const databaseSupplier = normalizeSupplier(dbSupplier);

        // If supplier differs from database, update price to 0 in parts database
        // Only do this if there IS a database supplier and it's different from selected
        if (
          selectedSupplier &&
          databaseSupplier &&
          selectedSupplier !== databaseSupplier
        ) {
          console.log(
            `⚠️ Supplier mismatch for ${partNumber}: Selected "${update.supplier}" but database has "${dbSupplier}". Setting price to 0.`,
          );
          await updatePartPriceToZero(partNumber, { jobNumber: jobNumber.trim() });
        }
      }

      // Always save supplier to type field (even if empty string to clear it)
      updateData.type = update.supplier || null;
      console.log(`[updateJobLines] Setting type field to:`, updateData.type);
    } else if (update.type !== undefined) {
      // Only use type field if supplier is not being updated
      updateData.type = update.type || null;
    }

    // Always update updatedAt
    updateData.updatedAt = new Date();

    // Debug: log what we're about to update
    if (update.supplier !== undefined) {
      console.log(
        `[updateJobLines] About to update job ${jobNumber}, part ${partNumber} with:`,
        JSON.stringify(updateData, null, 2),
      );
    }

    // Update the record using the composite key
    const updated = await prisma.job.update({
      where: {
        jobNumber_listNumber_partNumber: {
          jobNumber: jobNumber.trim(),
          listNumber: listNumber,
          partNumber: partNumber,
        },
      },
      data: updateData,
    });

    console.log(
      `[updateJobLines] Database update completed for ${jobNumber}::${partNumber}:`,
      {
        quantityNeeded: updated.quantityNeeded,
        quantityFab: updated.quantityFab ?? 0,
        ordered: updated.ordered,
        receivedFromOrder: updated.receivedFromOrder,
        quantityOrdered: updated.quantityOrdered,
        quantityReceivedFromOrder: updated.quantityReceivedFromOrder,
        quantityPulled: updated.pulled,
      },
    );

    // Debug: log what was actually saved
    if (update.supplier !== undefined) {
      console.log(
        `[updateJobLines] Successfully updated. Saved type field:`,
        updated.type,
      );
    }
  });

  await Promise.all(updatePromises);

  if (lineOrderUpdates.length > 0) {
    const targetRow = currentJob.lineItems.find(
      (item) => item.rowIndex === lineOrderUpdates[0]?.rowIndex,
    );
    if (targetRow) {
      await setManualOrderLockedForList(
        jobNumber,
        targetRow.listNumber || "1",
        true,
      );
    }
  }

  // Return updated job lines
  return await getJobLinesFromDatabase(jobNumber);
}

/**
 * Get the next available list number for a job
 */
export async function getNextListNumber(jobNumber: string): Promise<string> {
  const existingJobs = await prisma.job.findMany({
    where: {
      jobNumber: jobNumber.trim(),
    },
    select: {
      listNumber: true,
    },
    distinct: ['listNumber'],
  });

  if (existingJobs.length === 0) {
    return "1";
  }

  // Parse list numbers as integers and find the maximum
  const listNumbers = existingJobs
    .map(job => parseInt(job.listNumber, 10))
    .filter(num => !isNaN(num));

  if (listNumbers.length === 0) {
    return "1";
  }

  const maxListNumber = Math.max(...listNumbers);
  return String(maxListNumber + 1);
}

/**
 * Check if a job with the given jobNumber and listNumber exists
 */
export async function checkJobExists(jobNumber: string, listNumber: string): Promise<{
  exists: boolean;
  existingJob?: {
    jobNumber: string;
    jobName: string;
    listNumber: string;
    partCount: number;
    existingParts: Array<{
      partNumber: string;
      description: string | null;
      quantityNeeded: number;
      quantityFab: number;
    }>;
  };
}> {
  const jobs = await prisma.job.findMany({
    where: {
      jobNumber: jobNumber.trim(),
      listNumber: listNumber.trim(),
    },
    orderBy: [
      { lineOrder: 'asc' },
      { partNumber: 'asc' },
    ],
  });

  if (jobs.length === 0) {
    return { exists: false };
  }

  const realJobs = jobs.filter(
    (job) => job.partNumber !== NO_PARTS_PLACEHOLDER_PART_NUMBER,
  );

  return {
    exists: true,
    existingJob: {
      jobNumber: jobs[0].jobNumber,
      jobName: jobs[0].jobName,
      listNumber: jobs[0].listNumber,
      partCount: realJobs.length,
      existingParts: realJobs.map(job => ({
        partNumber: job.partNumber,
        description: job.description,
        quantityNeeded: job.quantityNeeded,
        quantityFab: job.quantityFab ?? 0,
      })),
    },
  };
}

/**
 * Line item data for job creation
 */
export interface CreateJobLineItem {
  partNumber: string;
  quantityNeeded: number;
  quantityFab?: number;
  unitOfMeasurement?: string | null;
  description?: string | null;
  type?: string | null;
}

/**
 * Create a new job with multiple line items in the database
 */
export async function createJobInDatabase(data: {
  jobNumber: string;
  jobName: string;
  contractNumber?: string | null;
  listNumber?: string | null;
  area?: string | null;
  locationShipTo?: string | null;
  stocklistDeliveryShipDate?: Date | null;
  listedBy?: string | null;
  pulledBy?: string | null;
  deliveryDate: Date;
  lineItems: CreateJobLineItem[];
  /** IANA timezone (e.g. "Asia/Kolkata") from creator's browser for accurate created-on date display */
  creatorTimezone?: string | null;
}): Promise<JobDetailsResponse> {
  // Validate required fields
  if (!data.jobNumber || !data.jobName) {
    throw new Error("jobNumber and jobName are required");
  }

  if (!data.deliveryDate) {
    throw new Error("deliveryDate is required");
  }

  const effectiveLineItems: CreateJobLineItem[] =
    data.lineItems && data.lineItems.length > 0
      ? data.lineItems
      : [
          {
            partNumber: NO_PARTS_PLACEHOLDER_PART_NUMBER,
            quantityNeeded: 0,
            quantityFab: 0,
            unitOfMeasurement: null,
            description: null,
            type: null,
          },
        ];

  // Validate all line items (including placeholder when applicable)
  for (const item of effectiveLineItems) {
    if (!item.partNumber || !item.partNumber.trim()) {
      throw new Error("All line items must have a partNumber");
    }
    if (
      item.quantityNeeded === undefined ||
      item.quantityNeeded === null ||
      item.quantityNeeded < 0
    ) {
      throw new Error("All line items must have quantityNeeded >= 0");
    }
  }

  // Use listNumber or default to "1"
  const finalListNumber = data.listNumber?.trim() || "1";

  // Create or update all job records in a transaction using upsert
  await prisma.$transaction(
    effectiveLineItems.map((item, index) =>
      prisma.job.upsert({
        where: {
          jobNumber_listNumber_partNumber: {
            jobNumber: data.jobNumber.trim(),
            listNumber: finalListNumber,
            partNumber: item.partNumber.trim(),
          },
        },
        update: {
          jobName: data.jobName.trim(),
          quantityNeeded: normalizeNonNegativeQuantity(item.quantityNeeded),
          quantityFab: normalizeFabQuantity(
            item.quantityFab ?? 0,
            item.quantityNeeded,
          ),
          contractNumber: data.contractNumber?.trim() || null,
          area: data.area?.trim() || null,
          locationShipTo: data.locationShipTo?.trim() || null,
          stocklistDeliveryShipDate: data.stocklistDeliveryShipDate || null,
          listedBy: data.listedBy?.trim() || null,
          deliveryDate: data.deliveryDate,
          unitOfMeasurement: item.unitOfMeasurement?.trim() || null,
          description: item.description?.trim() || null,
          type: item.type?.trim() || null,
          lineOrder: index + 1,
          updatedAt: new Date(),
        },
        create: {
          jobNumber: data.jobNumber.trim(),
          jobName: data.jobName.trim(),
          listNumber: finalListNumber,
          partNumber: item.partNumber.trim(),
          quantityNeeded: normalizeNonNegativeQuantity(item.quantityNeeded),
          quantityFab: normalizeFabQuantity(
            item.quantityFab ?? 0,
            item.quantityNeeded,
          ),
          pulled: 0,
          pulledBy: data.pulledBy?.trim() || null,
          contractNumber: data.contractNumber?.trim() || null,
          area: data.area?.trim() || null,
          locationShipTo: data.locationShipTo?.trim() || null,
          stocklistDeliveryShipDate: data.stocklistDeliveryShipDate || null,
          listedBy: data.listedBy?.trim() || null,
          deliveryDate: data.deliveryDate,
          unitOfMeasurement: item.unitOfMeasurement?.trim() || null,
          description: item.description?.trim() || null,
          type: item.type?.trim() || null,
          lineOrder: index + 1,
          ordered: false,
          receivedFromOrder: false,
          delivered: false,
          creatorTimezone: data.creatorTimezone?.trim() || null,
        },
      }),
    ),
  );

  // Return the created job as JobDetailsResponse
  return await getJobLinesFromDatabase(data.jobNumber, finalListNumber);
}

/**
 * Create a new job with multiple line items in the database with duplicate handling
 */
export async function createJobWithMerge(data: {
  jobNumber: string;
  jobName: string;
  contractNumber?: string | null;
  listNumber?: string | null;
  area?: string | null;
  locationShipTo?: string | null;
  stocklistDeliveryShipDate?: Date | null;
  listedBy?: string | null;
  pulledBy?: string | null;
  deliveryDate: Date;
  lineItems: CreateJobLineItem[];
  duplicateAction?: 'add' | 'replace' | 'skip';
  perPartDecisions?: Record<string, 'add' | 'replace' | 'skip' | 'custom'>;
  perPartCustomQuantities?: Record<string, number>;
  /** IANA timezone (e.g. "Asia/Kolkata") from creator's browser for accurate created-on date display */
  creatorTimezone?: string | null;
}): Promise<JobDetailsResponse> {
  // Validate required fields
  if (!data.jobNumber || !data.jobName) {
    throw new Error("jobNumber and jobName are required");
  }

  if (!data.deliveryDate) {
    throw new Error("deliveryDate is required");
  }

  const effectiveLineItems: CreateJobLineItem[] =
    data.lineItems && data.lineItems.length > 0
      ? data.lineItems
      : [
          {
            partNumber: NO_PARTS_PLACEHOLDER_PART_NUMBER,
            quantityNeeded: 0,
            quantityFab: 0,
            unitOfMeasurement: null,
            description: null,
            type: null,
          },
        ];

  // Validate all line items
  for (const item of effectiveLineItems) {
    if (!item.partNumber || !item.partNumber.trim()) {
      throw new Error("All line items must have a partNumber");
    }
    if (
      item.quantityNeeded === undefined ||
      item.quantityNeeded === null ||
      item.quantityNeeded < 0
    ) {
      throw new Error("All line items must have quantityNeeded >= 0");
    }
    if (item.quantityNeeded > MAX_JOB_LINE_QUANTITY) {
      throw new Error(
        `Part ${item.partNumber.trim()} has quantityNeeded (${item.quantityNeeded.toLocaleString()}) above the allowed maximum (${MAX_JOB_LINE_QUANTITY.toLocaleString()}). Correct the quantity before saving.`,
      );
    }
    const fab = item.quantityFab ?? 0;
    if (fab > MAX_JOB_LINE_QUANTITY) {
      throw new Error(
        `Part ${item.partNumber.trim()} has quantityFab (${fab.toLocaleString()}) above the allowed maximum (${MAX_JOB_LINE_QUANTITY.toLocaleString()}). Correct the quantity before saving.`,
      );
    }
  }

  // Use listNumber or default to "1"
  const finalListNumber = data.listNumber?.trim() || "1";

  const normalizedLineItems = effectiveLineItems.map((item) => {
    const quantityNeeded = normalizeNonNegativeQuantity(item.quantityNeeded);
    const quantityFab = normalizeFabQuantity(item.quantityFab ?? 0, quantityNeeded);
    return {
      ...item,
      quantityNeeded,
      quantityFab,
    };
  });

  // Check which parts already exist
  const existingJobs = await prisma.job.findMany({
    where: {
      jobNumber: data.jobNumber.trim(),
      listNumber: finalListNumber,
    },
  });
  const manualOrderLocked = await isManualOrderLocked(
    data.jobNumber,
    finalListNumber,
  );
  const sortedExistingJobs = [...existingJobs].sort(compareJobsByStoredOrder);

  const existingPartsMap = new Map(
    existingJobs.map(job => [job.partNumber, job])
  );

  // Incoming parts should follow PDF order deterministically (first appearance wins)
  const incomingOrderMap = new Map<string, number>();
  normalizedLineItems.forEach((item) => {
    const partNumber = item.partNumber.trim();
    if (!partNumber || incomingOrderMap.has(partNumber)) return;
    incomingOrderMap.set(partNumber, incomingOrderMap.size + 1);
  });
  const maxExistingLineOrder = sortedExistingJobs.reduce((max, job) => {
    if (job.lineOrder === null || job.lineOrder === undefined) return max;
    return Math.max(max, job.lineOrder);
  }, 0);

  // Existing rows not present in upload should remain after incoming rows, preserving prior relative order
  const existingNotInIncoming = sortedExistingJobs.filter(
    (job) => !incomingOrderMap.has(job.partNumber)
  );
  const carryForwardOrderMap = new Map<string, number | null>();

  if (manualOrderLocked) {
    existingNotInIncoming.forEach((job) => {
      carryForwardOrderMap.set(job.partNumber, job.lineOrder ?? null);
    });
  } else {
    existingNotInIncoming.forEach((job, idx) => {
      carryForwardOrderMap.set(job.partNumber, incomingOrderMap.size + idx + 1);
    });
  }

  // Process each line item based on duplicate handling strategy
  const operations = normalizedLineItems.map((item) => {
    const partNumber = item.partNumber.trim();
    const existingPart = existingPartsMap.get(partNumber);
    const incomingOrder = manualOrderLocked
      ? existingPart?.lineOrder ??
        maxExistingLineOrder +
          (incomingOrderMap.get(partNumber) ?? 0)
      : incomingOrderMap.get(partNumber) ?? null;
    
    // Determine action for this part
    let action: 'add' | 'replace' | 'skip' | 'custom' = data.duplicateAction || 'replace';
    if (data.perPartDecisions && data.perPartDecisions[partNumber]) {
      action = data.perPartDecisions[partNumber];
    }

    if (existingPart) {
      // Part exists - apply duplicate handling
      if (action === 'skip') {
        // Keep quantity untouched, but move row to uploaded PDF position
        return prisma.job.update({
          where: {
            jobNumber_listNumber_partNumber: {
              jobNumber: data.jobNumber.trim(),
              listNumber: finalListNumber,
              partNumber: partNumber,
            },
          },
          data: {
            lineOrder: incomingOrder,
            updatedAt: new Date(),
          },
        });
      } else if (action === 'add') {
        // Add quantities together
        const mergedNeeded = normalizeNonNegativeQuantity(
          existingPart.quantityNeeded + item.quantityNeeded,
        );
        const mergedFab = normalizeFabQuantity(
          (existingPart.quantityFab ?? 0) + item.quantityFab,
          mergedNeeded,
        );
        return prisma.job.update({
          where: {
            jobNumber_listNumber_partNumber: {
              jobNumber: data.jobNumber.trim(),
              listNumber: finalListNumber,
              partNumber: partNumber,
            },
          },
          data: {
            quantityNeeded: mergedNeeded,
            quantityFab: mergedFab,
            lineOrder: incomingOrder,
            updatedAt: new Date(),
          },
        });
      } else if (action === 'custom') {
        const rawCustomQty = data.perPartCustomQuantities?.[partNumber];
        if (
          rawCustomQty === undefined ||
          typeof rawCustomQty !== "number" ||
          Number.isNaN(rawCustomQty) ||
          rawCustomQty < 0
        ) {
          throw new Error(
            `Custom quantity is required and must be >= 0 for part "${partNumber}"`,
          );
        }
        const customQty = normalizeNonNegativeQuantity(rawCustomQty);
        return prisma.job.update({
          where: {
            jobNumber_listNumber_partNumber: {
              jobNumber: data.jobNumber.trim(),
              listNumber: finalListNumber,
              partNumber: partNumber,
            },
          },
          data: {
            jobName: data.jobName.trim(),
            quantityNeeded: customQty,
            quantityFab: customQty,
            contractNumber: data.contractNumber?.trim() || null,
            area: data.area?.trim() || null,
            locationShipTo: data.locationShipTo?.trim() || null,
            stocklistDeliveryShipDate: data.stocklistDeliveryShipDate || null,
            listedBy: data.listedBy?.trim() || null,
            deliveryDate: data.deliveryDate,
            unitOfMeasurement: item.unitOfMeasurement?.trim() || null,
            description: item.description?.trim() || null,
            type: item.type?.trim() || null,
            lineOrder: incomingOrder,
            updatedAt: new Date(),
          },
        });
      } else {
        // Replace with new quantity (default for 'replace' or missing custom)
        return prisma.job.update({
          where: {
            jobNumber_listNumber_partNumber: {
              jobNumber: data.jobNumber.trim(),
              listNumber: finalListNumber,
              partNumber: partNumber,
            },
          },
          data: {
            jobName: data.jobName.trim(),
            quantityNeeded: item.quantityNeeded,
            quantityFab: item.quantityFab,
            contractNumber: data.contractNumber?.trim() || null,
            area: data.area?.trim() || null,
            locationShipTo: data.locationShipTo?.trim() || null,
            stocklistDeliveryShipDate: data.stocklistDeliveryShipDate || null,
            listedBy: data.listedBy?.trim() || null,
            deliveryDate: data.deliveryDate,
            unitOfMeasurement: item.unitOfMeasurement?.trim() || null,
            description: item.description?.trim() || null,
            type: item.type?.trim() || null,
            lineOrder: incomingOrder,
            updatedAt: new Date(),
          },
        });
      }
    } else {
      // Part doesn't exist - create it
      return prisma.job.create({
        data: {
          jobNumber: data.jobNumber.trim(),
          jobName: data.jobName.trim(),
          listNumber: finalListNumber,
          partNumber: partNumber,
          quantityNeeded: item.quantityNeeded,
          quantityFab: item.quantityFab,
          pulled: 0,
          pulledBy: data.pulledBy?.trim() || null,
          contractNumber: data.contractNumber?.trim() || null,
          area: data.area?.trim() || null,
          locationShipTo: data.locationShipTo?.trim() || null,
          stocklistDeliveryShipDate: data.stocklistDeliveryShipDate || null,
          listedBy: data.listedBy?.trim() || null,
          deliveryDate: data.deliveryDate,
          unitOfMeasurement: item.unitOfMeasurement?.trim() || null,
          description: item.description?.trim() || null,
          type: item.type?.trim() || null,
          lineOrder: incomingOrder,
          ordered: false,
          receivedFromOrder: false,
          delivered: false,
          creatorTimezone: data.creatorTimezone?.trim() || null,
        },
      });
    }
  });

  // Re-position existing rows not present in upload after incoming rows
  const carryForwardOperations = existingNotInIncoming.map((row) =>
    prisma.job.update({
      where: {
        jobNumber_listNumber_partNumber: {
          jobNumber: data.jobNumber.trim(),
          listNumber: finalListNumber,
          partNumber: row.partNumber,
        },
      },
      data: {
        lineOrder: carryForwardOrderMap.get(row.partNumber) ?? null,
        updatedAt: new Date(),
      },
    })
  );

  const syncListMetadataOperation = prisma.job.updateMany({
    where: {
      jobNumber: data.jobNumber.trim(),
      listNumber: finalListNumber,
    },
    data: {
      jobName: data.jobName.trim(),
      contractNumber: data.contractNumber?.trim() || null,
      area: data.area?.trim() || null,
      locationShipTo: data.locationShipTo?.trim() || null,
      stocklistDeliveryShipDate: data.stocklistDeliveryShipDate || null,
      listedBy: data.listedBy?.trim() || null,
      deliveryDate: data.deliveryDate,
      updatedAt: new Date(),
    },
  });

  // Execute all operations in a transaction
  await prisma.$transaction([
    ...operations,
    ...carryForwardOperations,
    syncListMetadataOperation,
  ]);

  if (manualOrderLocked) {
    await setManualOrderLockedForList(data.jobNumber, finalListNumber, true);
  }

  // Return the created/updated job as JobDetailsResponse
  return await getJobLinesFromDatabase(data.jobNumber, finalListNumber);
}

/**
 * Add a single line item to an existing job in the database
 */
export async function addJobLineToDatabase(
  jobNumber: string,
  jobName: string,
  lineItem: {
    partNumber: string;
    description?: string | null;
    uom?: string | null;
    quantityNeeded: number;
    quantityFab?: number | null;
    type?: string | null;
    contractNumber?: string | null;
    listNumber?: string | null;
    area?: string | null;
    locationShipTo?: string | null;
    stocklistDeliveryShipDate?: Date | null;
  },
): Promise<JobDetailsResponse> {
  // Validate required fields
  if (!jobNumber || !jobName) {
    throw new Error("jobNumber and jobName are required");
  }

  if (!lineItem.partNumber || !lineItem.partNumber.trim()) {
    throw new Error("partNumber is required");
  }

  if (
    lineItem.quantityNeeded === undefined ||
    lineItem.quantityNeeded === null ||
    lineItem.quantityNeeded <= 0
  ) {
    throw new Error("quantityNeeded must be greater than 0");
  }

  // Use listNumber or default to "1"
  const finalListNumber = lineItem.listNumber?.trim() || "1";

  // Check if this line item already exists
  const existing = await prisma.job.findUnique({
    where: {
      jobNumber_listNumber_partNumber: {
        jobNumber: jobNumber.trim(),
        listNumber: finalListNumber,
        partNumber: lineItem.partNumber.trim(),
      },
    },
  });

  if (existing) {
    throw new Error(
      `A line item with this job number, list number, and part number already exists (job "${jobNumber}", list "${finalListNumber}", part "${lineItem.partNumber}").`,
    );
  }

  // Get an existing line item from this job to copy deliveryDate
  // If this is the first line item, use current date as default
  const existingJobLine = await prisma.job.findFirst({
    where: {
      jobNumber: jobNumber.trim(),
    },
  });

  const deliveryDate = existingJobLine?.deliveryDate || new Date();

  const siblingInList = await prisma.job.findFirst({
    where: {
      jobNumber: jobNumber.trim(),
      listNumber: finalListNumber,
    },
    select: { purchaseOrderAccountedFor: true },
  });
  const purchaseOrderAccountedFor =
    siblingInList?.purchaseOrderAccountedFor ?? false;

  // Preserve legacy behavior: only append ordered rows when this list already uses lineOrder.
  const orderAggregate = await prisma.job.aggregate({
    where: {
      jobNumber: jobNumber.trim(),
      listNumber: finalListNumber,
    },
    _max: {
      lineOrder: true,
    },
    _count: {
      lineOrder: true,
    },
  });
  const hasOrderedRows = (orderAggregate._count.lineOrder ?? 0) > 0;
  const manualOrderLocked = await isManualOrderLocked(jobNumber, finalListNumber);
  const nextLineOrder =
    hasOrderedRows || manualOrderLocked
      ? (orderAggregate._max.lineOrder ?? 0) + 1
      : null;

  const normalizedNeeded = normalizeNonNegativeQuantity(lineItem.quantityNeeded);
  const normalizedFab = normalizeFabQuantity(
    lineItem.quantityFab ?? 0,
    normalizedNeeded,
  );

  // Create the new line item
  await prisma.job.create({
    data: {
      jobNumber: jobNumber.trim(),
      jobName: jobName.trim(),
      listNumber: finalListNumber,
      partNumber: lineItem.partNumber.trim(),
      quantityNeeded: normalizedNeeded,
      quantityFab: normalizedFab,
      pulled: 0,
      contractNumber: lineItem.contractNumber?.trim() || null,
      area: lineItem.area?.trim() || null,
      locationShipTo: lineItem.locationShipTo?.trim() || null,
      stocklistDeliveryShipDate: lineItem.stocklistDeliveryShipDate || null,
      deliveryDate: deliveryDate,
      unitOfMeasurement: lineItem.uom?.trim() || null,
      description: lineItem.description?.trim() || null,
      type: lineItem.type?.trim() || null,
      lineOrder: nextLineOrder,
      ordered: false,
      receivedFromOrder: false,
      delivered: false,
      purchaseOrderAccountedFor,
    },
  });

  if (manualOrderLocked) {
    await setManualOrderLockedForList(jobNumber, finalListNumber, true);
  }

  // Return the updated job as JobDetailsResponse
  return await getJobLinesFromDatabase(jobNumber, finalListNumber);
}
