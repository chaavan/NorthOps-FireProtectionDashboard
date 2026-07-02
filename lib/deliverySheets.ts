import { google } from "googleapis";
import type { DeliveryRecord } from "./deliveryTypes";
import { DELIVERY_COLUMNS, parseBoolean } from "./deliveryTypes";
import { parseString, columnIndexToLetter } from "./types";

// Configuration
const SPREADSHEET_ID = "1U-az1-yK4p-GZAbdoK9O9ujM4belavYeBRNogxxEwUQ";
const DELIVERY_SHEET_NAME = "Delivery Tracking";
const DELIVERY_RANGE = `'${DELIVERY_SHEET_NAME}'!A2:BK`; // Start from row 2 (skip header) - note single quotes around sheet name

/**
 * Get authenticated Google Sheets client
 */
function getSheetsClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set.",
    );
  }

  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch (error) {
    throw new Error(
      "Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: " +
        (error as Error).message,
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

/**
 * Parse a row from the delivery sheet into a DeliveryRecord object
 */
function parseRowToDeliveryRecord(
  row: any[],
  rowIndex: number,
): DeliveryRecord {
  return {
    rowIndex: rowIndex + 2, // +2 because: 0-indexed, and we skip header row
    jobNumber: parseString(row[DELIVERY_COLUMNS.JOB_NUMBER]) || "",
    listNumber: null,
    jobArea: parseString(row[DELIVERY_COLUMNS.JOB_AREA]),
    jobName: parseString(row[DELIVERY_COLUMNS.JOB_NAME]),
    date: parseString(row[DELIVERY_COLUMNS.DATE]),
    address: parseString(row[DELIVERY_COLUMNS.ADDRESS]),

    // Parts
    fabPipes: parseBoolean(row[DELIVERY_COLUMNS.FAB_PIPES]),
    loosePipes: parseBoolean(row[DELIVERY_COLUMNS.LOOSE_PIPES]),
    thdFittings: parseBoolean(row[DELIVERY_COLUMNS.THD_FITTINGS]),
    nipples: parseBoolean(row[DELIVERY_COLUMNS.NIPPLES]),
    grvdFittings: parseBoolean(row[DELIVERY_COLUMNS.GRVD_FITTINGS]),
    valves: parseBoolean(row[DELIVERY_COLUMNS.VALVES]),
    heads: parseBoolean(row[DELIVERY_COLUMNS.HEADS]),
    hangers: parseBoolean(row[DELIVERY_COLUMNS.HANGERS]),
    rodStrut: parseBoolean(row[DELIVERY_COLUMNS.ROD_STRUT]),
    flexDrops: parseBoolean(row[DELIVERY_COLUMNS.FLEX_DROPS]),
    cpvcPipes: parseBoolean(row[DELIVERY_COLUMNS.CPVC_PIPES]),
    cpvcFittings: false, // Sheet column not defined yet
    quickDrops: parseBoolean(row[DELIVERY_COLUMNS.QUICK_DROPS]),
    pipeStand: parseBoolean(row[DELIVERY_COLUMNS.PIPE_STAND]),
    compressor: parseBoolean(row[DELIVERY_COLUMNS.COMPRESSOR]),
    backflow: parseBoolean(row[DELIVERY_COLUMNS.BACKFLOW]),
    signs: parseBoolean(row[DELIVERY_COLUMNS.SIGNS]),
    other: false, // Parts "Other" - sheet may not have column yet

    // Location
    location: parseString(row[DELIVERY_COLUMNS.LOCATION]),
    locationRow: parseString(row[DELIVERY_COLUMNS.LOCATION_ROW]),
    locationColumn: parseString(row[DELIVERY_COLUMNS.LOCATION_COLUMN]),

    // Pickup
    pickupGalloup: parseBoolean(row[DELIVERY_COLUMNS.PICKUP_GALLOUP]),
    pickupEtna: parseBoolean(row[DELIVERY_COLUMNS.PICKUP_ETNA]),
    pickupViking: parseBoolean(row[DELIVERY_COLUMNS.PICKUP_VIKING]),
    pickupOther: parseString(row[DELIVERY_COLUMNS.PICKUP_OTHER]),

    // Delivery
    deliveryGalloup: parseBoolean(row[DELIVERY_COLUMNS.DELIVERY_GALLOUP]),
    deliveryEtna: parseBoolean(row[DELIVERY_COLUMNS.DELIVERY_ETNA]),
    deliveryViking: parseBoolean(row[DELIVERY_COLUMNS.DELIVERY_VIKING]),
    deliveryOther: parseString(row[DELIVERY_COLUMNS.DELIVERY_OTHER]),

    // Personnel
    fitterPickingUpMaterial: parseBoolean(
      row[DELIVERY_COLUMNS.FITTER_PICKING_UP],
    ),
    picker: parseString(row[DELIVERY_COLUMNS.PICKER]),
    pickerDate: parseString(row[DELIVERY_COLUMNS.PICKER_DATE]),
    receiver: parseString(row[DELIVERY_COLUMNS.RECEIVER]),
    receiverDate: parseString(row[DELIVERY_COLUMNS.RECEIVER_DATE]),
    additionalReceiverDates: [],
    loaderDriver: parseString(row[DELIVERY_COLUMNS.LOADER_DRIVER]),
    fitter: parseString(row[DELIVERY_COLUMNS.FITTER]),
    materialDate: parseString(row[DELIVERY_COLUMNS.MATERIAL_DATE]),
    notes: null,

    // Backorders
    backordersEtnaOrdered: parseBoolean(
      row[DELIVERY_COLUMNS.BACKORDERS_ETNA_ORDERED],
    ),
    backordersGalloupOrdered: parseBoolean(
      row[DELIVERY_COLUMNS.BACKORDERS_GALLOUP_ORDERED],
    ),
    backordersVikingOrdered: parseBoolean(
      row[DELIVERY_COLUMNS.BACKORDERS_VIKING_ORDERED],
    ),
    backordersCoreMainOrdered: parseBoolean(
      row[DELIVERY_COLUMNS.BACKORDERS_COREMAIN_ORDERED],
    ),
    backordersEtnaPartial: parseBoolean(
      row[DELIVERY_COLUMNS.BACKORDERS_ETNA_PARTIAL],
    ),
    backordersGalloupPartial: parseBoolean(
      row[DELIVERY_COLUMNS.BACKORDERS_GALLOUP_PARTIAL],
    ),
    backordersVikingPartial: parseBoolean(
      row[DELIVERY_COLUMNS.BACKORDERS_VIKING_PARTIAL],
    ),
    backordersCoreMainPartial: parseBoolean(
      row[DELIVERY_COLUMNS.BACKORDERS_COREMAIN_PARTIAL],
    ),
    backordersEtnaReceived: parseBoolean(
      row[DELIVERY_COLUMNS.BACKORDERS_ETNA_RECEIVED],
    ),
    backordersGalloupReceived: parseBoolean(
      row[DELIVERY_COLUMNS.BACKORDERS_GALLOUP_RECEIVED],
    ),
    backordersVikingReceived: parseBoolean(
      row[DELIVERY_COLUMNS.BACKORDERS_VIKING_RECEIVED],
    ),
    backordersCoreMainReceived: parseBoolean(
      row[DELIVERY_COLUMNS.BACKORDERS_COREMAIN_RECEIVED],
    ),
    backordersOtherOrdered: false,
    backordersOtherPartial: false,
    backordersOtherReceived: false,
    backordersOtherName: null,

    // Material status
    fromShopComplete: parseBoolean(row[DELIVERY_COLUMNS.FROM_SHOP_COMPLETE]),
    fromShopStillNeed: parseBoolean(row[DELIVERY_COLUMNS.FROM_SHOP_STILL_NEED]),
    fromShopNa: false,
    fromSuppliersComplete: parseBoolean(
      row[DELIVERY_COLUMNS.FROM_SUPPLIERS_COMPLETE],
    ),
    fromSuppliersStillNeed: parseBoolean(
      row[DELIVERY_COLUMNS.FROM_SUPPLIERS_STILL_NEED],
    ),
    fromSuppliersNa: false,

    // Multiple locations (empty when loaded from sheet)
    locations: [],

    // Partial delivery (not in sheet; DB-only)
    partialDeliveryNote: null,
    partialDeliveryRecordedAt: null,
    // Service job (not in sheet; DB-only)
    isServiceJob: false,

    dateUpdated: parseString(row[DELIVERY_COLUMNS.DATE_UPDATED]),
  };
}

/**
 * Get delivery record for a specific job
 */
export async function getDeliveryRecord(
  jobNumber: string,
): Promise<DeliveryRecord | null> {
  let sheets;

  try {
    sheets = getSheetsClient();
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Error initializing Google Sheets client:", errorMessage);

    if (errorMessage.includes("GOOGLE_SERVICE_ACCOUNT_JSON")) {
      throw new Error(
        "Google Sheets authentication is not configured. Please set GOOGLE_SERVICE_ACCOUNT_JSON environment variable.",
      );
    } else if (errorMessage.includes("Failed to parse")) {
      throw new Error(
        "Invalid Google Sheets credentials. Please check your service account JSON format.",
      );
    }
    throw error;
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: DELIVERY_RANGE,
    });

    const rows = response.data.values || [];

    // Find the row for this job number
    const rowIndex = rows.findIndex(
      (row) =>
        parseString(row[DELIVERY_COLUMNS.JOB_NUMBER])?.trim().toLowerCase() ===
        jobNumber.trim().toLowerCase(),
    );

    if (rowIndex === -1) {
      // No existing record, return null (we'll create one on save)
      return null;
    }

    return parseRowToDeliveryRecord(rows[rowIndex], rowIndex);
  } catch (error: any) {
    console.error("Error reading delivery sheet:", {
      message: error?.message,
      code: error?.code,
      jobNumber,
    });

    // Provide more specific error messages
    if (
      error?.code === 403 ||
      error?.message?.includes("permission") ||
      error?.message?.includes("access")
    ) {
      throw new Error(
        "Permission denied. Please ensure the service account has access to the Google Sheet.",
      );
    } else if (error?.code === 404 || error?.message?.includes("not found")) {
      throw new Error(
        "Google Sheet not found. Please check the spreadsheet ID and sheet name.",
      );
    } else if (error?.message?.includes("Invalid JWT")) {
      throw new Error(
        "Invalid service account credentials. Please check your GOOGLE_SERVICE_ACCOUNT_JSON.",
      );
    }

    throw new Error(
      "Failed to read delivery sheet: " + (error?.message || "Unknown error"),
    );
  }
}

/**
 * Get all delivery records (for calendar display)
 */
export async function getAllDeliveryRecords(): Promise<DeliveryRecord[]> {
  const sheets = getSheetsClient();

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: DELIVERY_RANGE,
    });

    const rows = response.data.values || [];

    return rows
      .map((row, index) => parseRowToDeliveryRecord(row, index))
      .filter((record) => record.jobNumber && record.date); // Only return records with job number and date
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
): Promise<DeliveryRecord> {
  const sheets = getSheetsClient();

  try {
    // First, check if a record exists
    const existing = await getDeliveryRecord(jobNumber);

    let targetRow: number;

    if (existing) {
      // Update existing row
      targetRow = existing.rowIndex;
    } else {
      // Find next empty row or append
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: DELIVERY_RANGE,
      });
      const rows = response.data.values || [];
      targetRow = rows.length + 2; // +2 for header and 1-indexed
    }

    // Prepare update data - only update provided fields
    const updates: any[] = [];

    // Helper to add update
    const addUpdate = (colIndex: number, value: any) => {
      const col = columnIndexToLetter(colIndex);
      updates.push({
        range: `'${DELIVERY_SHEET_NAME}'!${col}${targetRow}`,
        values: [[value ?? ""]],
      });
    };

    // Job info (always set for new records)
    if (!existing) {
      addUpdate(DELIVERY_COLUMNS.JOB_NUMBER, jobNumber);
      if (data.jobName) addUpdate(DELIVERY_COLUMNS.JOB_NAME, data.jobName);
      if (data.jobArea) addUpdate(DELIVERY_COLUMNS.JOB_AREA, data.jobArea);
      if (data.address) addUpdate(DELIVERY_COLUMNS.ADDRESS, data.address);
    }

    // Parts checkboxes
    if (data.fabPipes !== undefined)
      addUpdate(DELIVERY_COLUMNS.FAB_PIPES, data.fabPipes);
    if (data.loosePipes !== undefined)
      addUpdate(DELIVERY_COLUMNS.LOOSE_PIPES, data.loosePipes);
    if (data.thdFittings !== undefined)
      addUpdate(DELIVERY_COLUMNS.THD_FITTINGS, data.thdFittings);
    if (data.nipples !== undefined)
      addUpdate(DELIVERY_COLUMNS.NIPPLES, data.nipples);
    if (data.grvdFittings !== undefined)
      addUpdate(DELIVERY_COLUMNS.GRVD_FITTINGS, data.grvdFittings);
    if (data.valves !== undefined)
      addUpdate(DELIVERY_COLUMNS.VALVES, data.valves);
    if (data.heads !== undefined) addUpdate(DELIVERY_COLUMNS.HEADS, data.heads);
    if (data.hangers !== undefined)
      addUpdate(DELIVERY_COLUMNS.HANGERS, data.hangers);
    if (data.rodStrut !== undefined)
      addUpdate(DELIVERY_COLUMNS.ROD_STRUT, data.rodStrut);
    if (data.flexDrops !== undefined)
      addUpdate(DELIVERY_COLUMNS.FLEX_DROPS, data.flexDrops);
    if (data.cpvcPipes !== undefined)
      addUpdate(DELIVERY_COLUMNS.CPVC_PIPES, data.cpvcPipes);
    if (data.quickDrops !== undefined)
      addUpdate(DELIVERY_COLUMNS.QUICK_DROPS, data.quickDrops);
    if (data.pipeStand !== undefined)
      addUpdate(DELIVERY_COLUMNS.PIPE_STAND, data.pipeStand);
    if (data.compressor !== undefined)
      addUpdate(DELIVERY_COLUMNS.COMPRESSOR, data.compressor);
    if (data.backflow !== undefined)
      addUpdate(DELIVERY_COLUMNS.BACKFLOW, data.backflow);
    if (data.signs !== undefined) addUpdate(DELIVERY_COLUMNS.SIGNS, data.signs);

    // Location
    if (data.location !== undefined)
      addUpdate(DELIVERY_COLUMNS.LOCATION, data.location);
    if (data.locationRow !== undefined)
      addUpdate(DELIVERY_COLUMNS.LOCATION_ROW, data.locationRow);
    if (data.locationColumn !== undefined)
      addUpdate(DELIVERY_COLUMNS.LOCATION_COLUMN, data.locationColumn);

    // Pickup
    if (data.pickupGalloup !== undefined)
      addUpdate(DELIVERY_COLUMNS.PICKUP_GALLOUP, data.pickupGalloup);
    if (data.pickupEtna !== undefined)
      addUpdate(DELIVERY_COLUMNS.PICKUP_ETNA, data.pickupEtna);
    if (data.pickupViking !== undefined)
      addUpdate(DELIVERY_COLUMNS.PICKUP_VIKING, data.pickupViking);
    if (data.pickupOther !== undefined)
      addUpdate(DELIVERY_COLUMNS.PICKUP_OTHER, data.pickupOther);

    // Delivery
    if (data.deliveryGalloup !== undefined)
      addUpdate(DELIVERY_COLUMNS.DELIVERY_GALLOUP, data.deliveryGalloup);
    if (data.deliveryEtna !== undefined)
      addUpdate(DELIVERY_COLUMNS.DELIVERY_ETNA, data.deliveryEtna);
    if (data.deliveryViking !== undefined)
      addUpdate(DELIVERY_COLUMNS.DELIVERY_VIKING, data.deliveryViking);
    if (data.deliveryOther !== undefined)
      addUpdate(DELIVERY_COLUMNS.DELIVERY_OTHER, data.deliveryOther);

    // Personnel
    if (data.fitterPickingUpMaterial !== undefined)
      addUpdate(
        DELIVERY_COLUMNS.FITTER_PICKING_UP,
        data.fitterPickingUpMaterial,
      );
    if (data.picker !== undefined)
      addUpdate(DELIVERY_COLUMNS.PICKER, data.picker);
    if (data.pickerDate !== undefined)
      addUpdate(DELIVERY_COLUMNS.PICKER_DATE, data.pickerDate);
    if (data.receiver !== undefined)
      addUpdate(DELIVERY_COLUMNS.RECEIVER, data.receiver);
    if (data.receiverDate !== undefined)
      addUpdate(DELIVERY_COLUMNS.RECEIVER_DATE, data.receiverDate);
    if (data.loaderDriver !== undefined)
      addUpdate(DELIVERY_COLUMNS.LOADER_DRIVER, data.loaderDriver);
    if (data.fitter !== undefined)
      addUpdate(DELIVERY_COLUMNS.FITTER, data.fitter);
    if (data.materialDate !== undefined)
      addUpdate(DELIVERY_COLUMNS.MATERIAL_DATE, data.materialDate);

    // Backorders
    if (data.backordersEtnaOrdered !== undefined)
      addUpdate(
        DELIVERY_COLUMNS.BACKORDERS_ETNA_ORDERED,
        data.backordersEtnaOrdered,
      );
    if (data.backordersGalloupOrdered !== undefined)
      addUpdate(
        DELIVERY_COLUMNS.BACKORDERS_GALLOUP_ORDERED,
        data.backordersGalloupOrdered,
      );
    if (data.backordersVikingOrdered !== undefined)
      addUpdate(
        DELIVERY_COLUMNS.BACKORDERS_VIKING_ORDERED,
        data.backordersVikingOrdered,
      );
    if (data.backordersCoreMainOrdered !== undefined)
      addUpdate(
        DELIVERY_COLUMNS.BACKORDERS_COREMAIN_ORDERED,
        data.backordersCoreMainOrdered,
      );
    if (data.backordersEtnaPartial !== undefined)
      addUpdate(
        DELIVERY_COLUMNS.BACKORDERS_ETNA_PARTIAL,
        data.backordersEtnaPartial,
      );
    if (data.backordersGalloupPartial !== undefined)
      addUpdate(
        DELIVERY_COLUMNS.BACKORDERS_GALLOUP_PARTIAL,
        data.backordersGalloupPartial,
      );
    if (data.backordersVikingPartial !== undefined)
      addUpdate(
        DELIVERY_COLUMNS.BACKORDERS_VIKING_PARTIAL,
        data.backordersVikingPartial,
      );
    if (data.backordersCoreMainPartial !== undefined)
      addUpdate(
        DELIVERY_COLUMNS.BACKORDERS_COREMAIN_PARTIAL,
        data.backordersCoreMainPartial,
      );
    if (data.backordersEtnaReceived !== undefined)
      addUpdate(
        DELIVERY_COLUMNS.BACKORDERS_ETNA_RECEIVED,
        data.backordersEtnaReceived,
      );
    if (data.backordersGalloupReceived !== undefined)
      addUpdate(
        DELIVERY_COLUMNS.BACKORDERS_GALLOUP_RECEIVED,
        data.backordersGalloupReceived,
      );
    if (data.backordersVikingReceived !== undefined)
      addUpdate(
        DELIVERY_COLUMNS.BACKORDERS_VIKING_RECEIVED,
        data.backordersVikingReceived,
      );
    if (data.backordersCoreMainReceived !== undefined)
      addUpdate(
        DELIVERY_COLUMNS.BACKORDERS_COREMAIN_RECEIVED,
        data.backordersCoreMainReceived,
      );

    // Material status
    if (data.fromShopComplete !== undefined)
      addUpdate(DELIVERY_COLUMNS.FROM_SHOP_COMPLETE, data.fromShopComplete);
    if (data.fromShopStillNeed !== undefined)
      addUpdate(DELIVERY_COLUMNS.FROM_SHOP_STILL_NEED, data.fromShopStillNeed);
    if (data.fromSuppliersComplete !== undefined)
      addUpdate(
        DELIVERY_COLUMNS.FROM_SUPPLIERS_COMPLETE,
        data.fromSuppliersComplete,
      );
    if (data.fromSuppliersStillNeed !== undefined)
      addUpdate(
        DELIVERY_COLUMNS.FROM_SUPPLIERS_STILL_NEED,
        data.fromSuppliersStillNeed,
      );

    // Always update dateUpdated
    addUpdate(
      DELIVERY_COLUMNS.DATE_UPDATED,
      new Date().toISOString().split("T")[0],
    );

    // Execute batch update
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: updates,
      },
    });

    // Fetch and return updated data
    const updated = await getDeliveryRecord(jobNumber);
    return (
      updated ||
      ({
        ...data,
        rowIndex: targetRow,
        jobNumber,
        listNumber: data.listNumber ?? null,
      } as DeliveryRecord)
    );
  } catch (error) {
    console.error("Error updating delivery sheet:", error);
    throw new Error(
      "Failed to update delivery sheet: " + (error as Error).message,
    );
  }
}
