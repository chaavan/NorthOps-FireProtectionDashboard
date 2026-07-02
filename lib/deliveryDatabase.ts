import { prisma } from "./prisma";
import type {
  BackordersOtherVendor,
  DeliveryRecord,
  DeliveryLocation,
} from "./deliveryTypes";
import {
  DEFAULT_LIST_NUMBER,
  normalizeListContextForLookup,
} from "./jobListContext";

/**
 * Convert database Delivery model to DeliveryRecord type
 */
function normalizeBackordersOtherVendors(raw: unknown): BackordersOtherVendor[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      const name =
        typeof candidate.name === "string" ? candidate.name.trim() : "";
      if (!name) return null;
      return {
        name,
        ordered: candidate.ordered === true,
        partial: candidate.partial === true,
        received: candidate.received === true,
      };
    })
    .filter((entry): entry is BackordersOtherVendor => entry !== null);
}

function parseBackordersOtherVendors(
  rawName: string | null | undefined,
  legacyFlags: Pick<
    DeliveryRecord,
    "backordersOtherOrdered" | "backordersOtherPartial" | "backordersOtherReceived"
  >,
): BackordersOtherVendor[] {
  const value = typeof rawName === "string" ? rawName.trim() : "";
  if (!value) return [];

  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      return normalizeBackordersOtherVendors(parsed);
    } catch {
      // Fall through to legacy single-name format
    }
  }

  return [
    {
      name: value,
      ordered: legacyFlags.backordersOtherOrdered,
      partial: legacyFlags.backordersOtherPartial,
      received: legacyFlags.backordersOtherReceived,
    },
  ];
}

function dbDeliveryToRecord(delivery: any): DeliveryRecord {
  const backordersOtherVendors = parseBackordersOtherVendors(
    delivery.backordersOtherName,
    {
      backordersOtherOrdered: delivery.backordersOtherOrdered,
      backordersOtherPartial: delivery.backordersOtherPartial,
      backordersOtherReceived: delivery.backordersOtherReceived,
    },
  );

  return {
    rowIndex: 0, // Not used in database
    jobNumber: delivery.jobNumber,
    listNumber: delivery.listNumber ?? null,
    jobArea: delivery.jobArea,
    jobName: delivery.jobName,
    date: delivery.date ? delivery.date.toISOString().split("T")[0] : null,
    address: delivery.address,
    isServiceJob: delivery.isServiceJob ?? false,

    // Parts checkboxes
    fabPipes: delivery.fabPipes,
    loosePipes: delivery.loosePipes,
    thdFittings: delivery.thdFittings,
    nipples: delivery.nipples,
    grvdFittings: delivery.grvdFittings,
    valves: delivery.valves,
    heads: delivery.heads,
    hangers: delivery.hangers,
    rodStrut: delivery.rodStrut,
    flexDrops: delivery.flexDrops,
    cpvcPipes: delivery.cpvcPipes,
    cpvcFittings: delivery.cpvcFittings ?? false,
    quickDrops: delivery.quickDrops,
    pipeStand: delivery.pipeStand,
    compressor: delivery.compressor,
    backflow: delivery.backflow,
    signs: delivery.signs,
    other: delivery.other ?? false,

    // Location
    location: delivery.location,
    locationRow: delivery.locationRow,
    locationColumn: delivery.locationColumn,
    // Multiple locations
    locations: delivery.locations?.map((loc: any) => ({
      id: loc.id,
      locationType: loc.locationType,
      row: loc.row,
      column: loc.column,
      order: loc.order,
    })),
    // Pickup
    pickupGalloup: delivery.pickupGalloup,
    pickupEtna: delivery.pickupEtna,
    pickupViking: delivery.pickupViking,
    pickupOther: delivery.pickupOther,

    // Delivery
    deliveryGalloup: delivery.deliveryGalloup,
    deliveryEtna: delivery.deliveryEtna,
    deliveryViking: delivery.deliveryViking,
    deliveryOther: delivery.deliveryOther,

    // Personnel
    fitterPickingUpMaterial: delivery.fitterPickingUpMaterial,
    picker: delivery.picker,
    pickerDate: delivery.pickerDate
      ? delivery.pickerDate.toISOString().split("T")[0]
      : null,
    receiver: delivery.receiver,
    receiverDate: delivery.receiverDate
      ? delivery.receiverDate.toISOString().split("T")[0]
      : null,
    additionalReceiverDates: Array.isArray(delivery.additionalReceiverDates)
      ? (delivery.additionalReceiverDates as string[])
      : [],
    loaderDriver: delivery.loaderDriver,
    fitter: delivery.fitter,
    materialDate: delivery.materialDate
      ? delivery.materialDate.toISOString().split("T")[0]
      : null,
    notes: delivery.notes,

    // Backorders - Ordered
    backordersEtnaOrdered: delivery.backordersEtnaOrdered,
    backordersGalloupOrdered: delivery.backordersGalloupOrdered,
    backordersVikingOrdered: delivery.backordersVikingOrdered,
    backordersCoreMainOrdered: delivery.backordersCoreMainOrdered,
    backordersOtherOrdered: delivery.backordersOtherOrdered,

    // Backorders - Partial
    backordersEtnaPartial: delivery.backordersEtnaPartial,
    backordersGalloupPartial: delivery.backordersGalloupPartial,
    backordersVikingPartial: delivery.backordersVikingPartial,
    backordersCoreMainPartial: delivery.backordersCoreMainPartial,
    backordersOtherPartial: delivery.backordersOtherPartial,

    // Backorders - Received
    backordersEtnaReceived: delivery.backordersEtnaReceived,
    backordersGalloupReceived: delivery.backordersGalloupReceived,
    backordersVikingReceived: delivery.backordersVikingReceived,
    backordersCoreMainReceived: delivery.backordersCoreMainReceived,
    backordersOtherReceived: delivery.backordersOtherReceived,
    backordersOtherName: delivery.backordersOtherName,
    backordersOtherVendors,

    // Material status
    fromShopComplete: delivery.fromShopComplete,
    fromShopStillNeed: delivery.fromShopStillNeed,
    fromShopNa: delivery.fromShopNa,
    fromSuppliersComplete: delivery.fromSuppliersComplete,
    fromSuppliersStillNeed: delivery.fromSuppliersStillNeed,
    fromSuppliersNa: delivery.fromSuppliersNa,

    // Partial delivery
    partialDeliveryNote: delivery.partialDeliveryNote ?? null,
    partialDeliveryRecordedAt: delivery.partialDeliveryRecordedAt
      ? delivery.partialDeliveryRecordedAt.toISOString()
      : null,

    dateUpdated: delivery.updatedAt
      ? delivery.updatedAt.toISOString().split("T")[0]
      : null,
  };
}

/**
 * Get delivery record for a specific job
 */
export async function getDeliveryRecord(
  jobNumber: string,
  listNumberContext?: string | null,
): Promise<DeliveryRecord | null> {
  try {
    const normalizedJobNumber = jobNumber.trim();
    const normalizedListNumber = normalizeListContextForLookup(listNumberContext);

    const delivery = await prisma.delivery.findUnique({
      where: {
        jobNumber_listNumber: {
          jobNumber: normalizedJobNumber,
          listNumber: normalizedListNumber,
        },
      },
      include: {
        locations: {
          orderBy: {
            order: "asc",
          },
        },
      },
    });

    if (!delivery) {
      return null;
    }

    return dbDeliveryToRecord(delivery);
  } catch (error) {
    console.error("Error reading delivery from database:", error);
    throw new Error(
      "Failed to read delivery record: " + (error as Error).message,
    );
  }
}

/**
 * Get all delivery records (for calendar display and admin jobs list).
 * Includes records with null date so isServiceJob and other flags are available
 * when a job is updated via Edit Job (e.g. marked as service job) before a delivery date is set.
 */
export async function getAllDeliveryRecords(): Promise<DeliveryRecord[]> {
  try {
    const deliveries = await prisma.delivery.findMany({
      orderBy: {
        date: "asc",
      },
      include: {
        locations: {
          orderBy: {
            order: "asc",
          },
        },
      },
    });

    return deliveries
      .map(dbDeliveryToRecord)
      .filter((record) => record.jobNumber); // Include all records so isServiceJob is available even when date is null
  } catch (error) {
    console.error("Error reading all delivery records:", error);
    throw new Error(
      "Failed to read delivery records: " + (error as Error).message,
    );
  }
}

/**
 * Update or create delivery record for a job
 */
export async function updateDeliveryRecord(
  jobNumber: string,
  data: Partial<DeliveryRecord>,
  listNumberContext?: string | null,
): Promise<DeliveryRecord> {
  try {
    const normalizedJobNumber = jobNumber.trim();
    const normalizedListNumber = normalizeListContextForLookup(listNumberContext);

    // Prepare data for database
    const dbData: any = {};

    // Job info
    if (data.jobName !== undefined) dbData.jobName = data.jobName;
    if (data.jobArea !== undefined) dbData.jobArea = data.jobArea;
    if (data.address !== undefined) dbData.address = data.address;
    if (data.date !== undefined) {
      dbData.date = data.date ? new Date(data.date) : null;
    }
    if (data.isServiceJob !== undefined) dbData.isServiceJob = data.isServiceJob;

    // Parts checkboxes
    if (data.fabPipes !== undefined) dbData.fabPipes = data.fabPipes;
    if (data.loosePipes !== undefined) dbData.loosePipes = data.loosePipes;
    if (data.thdFittings !== undefined) dbData.thdFittings = data.thdFittings;
    if (data.nipples !== undefined) dbData.nipples = data.nipples;
    if (data.grvdFittings !== undefined)
      dbData.grvdFittings = data.grvdFittings;
    if (data.valves !== undefined) dbData.valves = data.valves;
    if (data.heads !== undefined) dbData.heads = data.heads;
    if (data.hangers !== undefined) dbData.hangers = data.hangers;
    if (data.rodStrut !== undefined) dbData.rodStrut = data.rodStrut;
    if (data.flexDrops !== undefined) dbData.flexDrops = data.flexDrops;
    if (data.cpvcPipes !== undefined) dbData.cpvcPipes = data.cpvcPipes;
    if (data.cpvcFittings !== undefined) dbData.cpvcFittings = data.cpvcFittings;
    if (data.quickDrops !== undefined) dbData.quickDrops = data.quickDrops;
    if (data.pipeStand !== undefined) dbData.pipeStand = data.pipeStand;
    if (data.compressor !== undefined) dbData.compressor = data.compressor;
    if (data.backflow !== undefined) dbData.backflow = data.backflow;
    if (data.signs !== undefined) dbData.signs = data.signs;
    if (data.other !== undefined) dbData.other = data.other;

    // Location
    if (data.location !== undefined) dbData.location = data.location;
    if (data.locationRow !== undefined) dbData.locationRow = data.locationRow;
    if (data.locationColumn !== undefined)
      dbData.locationColumn = data.locationColumn;

    // Pickup
    if (data.pickupGalloup !== undefined)
      dbData.pickupGalloup = data.pickupGalloup;
    if (data.pickupEtna !== undefined) dbData.pickupEtna = data.pickupEtna;
    if (data.pickupViking !== undefined)
      dbData.pickupViking = data.pickupViking;
    if (data.pickupOther !== undefined) dbData.pickupOther = data.pickupOther;

    // Delivery
    if (data.deliveryGalloup !== undefined)
      dbData.deliveryGalloup = data.deliveryGalloup;
    if (data.deliveryEtna !== undefined)
      dbData.deliveryEtna = data.deliveryEtna;
    if (data.deliveryViking !== undefined)
      dbData.deliveryViking = data.deliveryViking;
    if (data.deliveryOther !== undefined)
      dbData.deliveryOther = data.deliveryOther;

    // Personnel
    if (data.fitterPickingUpMaterial !== undefined)
      dbData.fitterPickingUpMaterial = data.fitterPickingUpMaterial;
    if (data.picker !== undefined) dbData.picker = data.picker;
    if (data.pickerDate !== undefined) {
      dbData.pickerDate = data.pickerDate ? new Date(data.pickerDate) : null;
    }
    if (data.receiver !== undefined) dbData.receiver = data.receiver;
    if (data.receiverDate !== undefined) {
      dbData.receiverDate = data.receiverDate
        ? new Date(data.receiverDate)
        : null;
    }
    if (data.additionalReceiverDates !== undefined) {
      dbData.additionalReceiverDates = Array.isArray(data.additionalReceiverDates)
        ? data.additionalReceiverDates.filter((d: string) => d && d.trim() !== "")
        : [];
    }
    if (data.loaderDriver !== undefined)
      dbData.loaderDriver = data.loaderDriver;
    if (data.fitter !== undefined) dbData.fitter = data.fitter;
    if (data.materialDate !== undefined) {
      dbData.materialDate = data.materialDate
        ? new Date(data.materialDate)
        : null;
    }
    if (data.notes !== undefined) dbData.notes = data.notes;

    // Backorders - Ordered
    if (data.backordersEtnaOrdered !== undefined)
      dbData.backordersEtnaOrdered = data.backordersEtnaOrdered;
    if (data.backordersGalloupOrdered !== undefined)
      dbData.backordersGalloupOrdered = data.backordersGalloupOrdered;
    if (data.backordersVikingOrdered !== undefined)
      dbData.backordersVikingOrdered = data.backordersVikingOrdered;
    if (data.backordersCoreMainOrdered !== undefined)
      dbData.backordersCoreMainOrdered = data.backordersCoreMainOrdered;
    if (data.backordersOtherOrdered !== undefined)
      dbData.backordersOtherOrdered = data.backordersOtherOrdered;

    // Backorders - Partial
    if (data.backordersEtnaPartial !== undefined)
      dbData.backordersEtnaPartial = data.backordersEtnaPartial;
    if (data.backordersGalloupPartial !== undefined)
      dbData.backordersGalloupPartial = data.backordersGalloupPartial;
    if (data.backordersVikingPartial !== undefined)
      dbData.backordersVikingPartial = data.backordersVikingPartial;
    if (data.backordersCoreMainPartial !== undefined)
      dbData.backordersCoreMainPartial = data.backordersCoreMainPartial;
    if (data.backordersOtherPartial !== undefined)
      dbData.backordersOtherPartial = data.backordersOtherPartial;

    // Backorders - Received
    if (data.backordersEtnaReceived !== undefined)
      dbData.backordersEtnaReceived = data.backordersEtnaReceived;
    if (data.backordersGalloupReceived !== undefined)
      dbData.backordersGalloupReceived = data.backordersGalloupReceived;
    if (data.backordersVikingReceived !== undefined)
      dbData.backordersVikingReceived = data.backordersVikingReceived;
    if (data.backordersCoreMainReceived !== undefined)
      dbData.backordersCoreMainReceived = data.backordersCoreMainReceived;
    if (data.backordersOtherReceived !== undefined)
      dbData.backordersOtherReceived = data.backordersOtherReceived;
    if (data.backordersOtherName !== undefined)
      dbData.backordersOtherName = data.backordersOtherName;
    if (data.backordersOtherVendors !== undefined) {
      const normalized = normalizeBackordersOtherVendors(
        data.backordersOtherVendors,
      );
      dbData.backordersOtherName =
        normalized.length > 0 ? JSON.stringify(normalized) : null;
      dbData.backordersOtherOrdered = normalized.some((v) => v.ordered);
      dbData.backordersOtherPartial = normalized.some((v) => v.partial);
      dbData.backordersOtherReceived = normalized.some((v) => v.received);
    }

    // Material status
    if (data.fromShopComplete !== undefined)
      dbData.fromShopComplete = data.fromShopComplete;
    if (data.fromShopStillNeed !== undefined)
      dbData.fromShopStillNeed = data.fromShopStillNeed;
    if (data.fromShopNa !== undefined)
      dbData.fromShopNa = data.fromShopNa;
    if (data.fromSuppliersComplete !== undefined)
      dbData.fromSuppliersComplete = data.fromSuppliersComplete;
    if (data.fromSuppliersStillNeed !== undefined)
      dbData.fromSuppliersStillNeed = data.fromSuppliersStillNeed;
    if (data.fromSuppliersNa !== undefined)
      dbData.fromSuppliersNa = data.fromSuppliersNa;

    // Partial delivery
    if (data.partialDeliveryNote !== undefined)
      dbData.partialDeliveryNote = data.partialDeliveryNote;
    if (data.partialDeliveryRecordedAt !== undefined) {
      dbData.partialDeliveryRecordedAt = data.partialDeliveryRecordedAt
        ? new Date(data.partialDeliveryRecordedAt)
        : null;
    }

    // Extract locations array before upserting delivery
    const locations = (data as any).locations as DeliveryLocation[] | undefined;

    // Use a transaction to update both delivery and locations atomically
    const delivery = await prisma.$transaction(async (tx) => {
      let existing = await tx.delivery.findUnique({
        where: {
          jobNumber_listNumber: {
            jobNumber: normalizedJobNumber,
            listNumber: normalizedListNumber,
          },
        },
        include: {
          locations: {
            orderBy: {
              order: "asc",
            },
          },
        },
      });

      let deliveryRecord;
      if (existing) {
        deliveryRecord = await tx.delivery.update({
          where: { id: existing.id },
          data: dbData,
        });
      } else {
        deliveryRecord = await tx.delivery.create({
          data: {
            jobNumber: normalizedJobNumber,
            listNumber: normalizedListNumber,
            ...dbData,
          },
        });
      }

      // Handle locations if provided
      if (locations !== undefined) {
        // Delete all existing locations for this delivery
        await tx.deliveryLocation.deleteMany({
          where: {
            deliveryId: deliveryRecord.id,
          },
        });

        // Create new locations
        if (locations.length > 0) {
          await tx.deliveryLocation.createMany({
            data: locations.map((loc, index) => ({
              deliveryId: deliveryRecord.id,
              locationType: loc.locationType,
              row: loc.row,
              column: loc.column,
              order: loc.order ?? index,
            })),
          });
        }
      }

      // Fetch the complete delivery record with locations
      return await tx.delivery.findUnique({
        where: { id: deliveryRecord.id },
        include: {
          locations: {
            orderBy: {
              order: "asc",
            },
          },
        },
      });
    });

    return dbDeliveryToRecord(delivery!);
  } catch (error) {
    console.error("Error updating delivery record:", error);
    throw new Error(
      "Failed to update delivery record: " + (error as Error).message,
    );
  }
}
