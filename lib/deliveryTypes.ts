/**
 * Type definitions for Delivery Tracking sheet
 */

export type DeliveryLocation = {
  locationType: string | null;
  row: string | null;
  column: string | null;
  order?: number;
};

export type BackordersOtherVendor = {
  name: string;
  ordered: boolean;
  partial: boolean;
  received: boolean;
};

export type DeliveryRecord = {
  rowIndex: number;
  jobNumber: string;
  listNumber: string | null;
  jobArea: string | null;
  jobName: string | null;
  date: string | null;
  address: string | null;
  isServiceJob: boolean;

  // Parts checkboxes
  fabPipes: boolean;
  loosePipes: boolean;
  thdFittings: boolean;
  nipples: boolean;
  grvdFittings: boolean;
  valves: boolean;
  heads: boolean;
  hangers: boolean;
  rodStrut: boolean;
  flexDrops: boolean;
  cpvcPipes: boolean;
  cpvcFittings: boolean;
  quickDrops: boolean;
  pipeStand: boolean;
  compressor: boolean;
  backflow: boolean;
  signs: boolean;
  other: boolean;

  // Location
  location: string | null;
  locationRow: string | null;
  locationColumn: string | null;

  // Multiple locations
  locations: DeliveryLocation[];

  // Pickup locations
  pickupGalloup: boolean;
  pickupEtna: boolean;
  pickupViking: boolean;
  pickupOther: string | null;

  // Delivery locations
  deliveryGalloup: boolean;
  deliveryEtna: boolean;
  deliveryViking: boolean;
  deliveryOther: string | null;

  // Personnel
  fitterPickingUpMaterial: boolean;
  picker: string | null;
  pickerDate: string | null;
  receiver: string | null;
  receiverDate: string | null;
  additionalReceiverDates: string[];
  loaderDriver: string | null;
  fitter: string | null;
  materialDate: string | null;
  notes: string | null;

  // Backorders - Ordered
  backordersEtnaOrdered: boolean;
  backordersGalloupOrdered: boolean;
  backordersVikingOrdered: boolean;
  backordersCoreMainOrdered: boolean;
  backordersOtherOrdered: boolean;

  // Backorders - Partial
  backordersEtnaPartial: boolean;
  backordersGalloupPartial: boolean;
  backordersVikingPartial: boolean;
  backordersCoreMainPartial: boolean;
  backordersOtherPartial: boolean;

  // Backorders - Received
  backordersEtnaReceived: boolean;
  backordersGalloupReceived: boolean;
  backordersVikingReceived: boolean;
  backordersCoreMainReceived: boolean;
  backordersOtherReceived: boolean;
  backordersOtherName: string | null;
  backordersOtherVendors?: BackordersOtherVendor[];

  // Material status
  fromShopComplete: boolean;
  fromShopStillNeed: boolean;
  fromShopNa: boolean;
  fromSuppliersComplete: boolean;
  fromSuppliersStillNeed: boolean;
  fromSuppliersNa: boolean;

  // Partial delivery (recorded when user notes only some parts delivered)
  partialDeliveryNote: string | null;
  partialDeliveryRecordedAt: string | null;

  dateUpdated: string | null;
};

/**
 * Column indices for the Delivery Tracking sheet
 * Based on actual sheet structure from debug endpoint
 */
export const DELIVERY_COLUMNS = {
  JOB_NUMBER: 0, // A - Job #
  JOB_AREA: 1, // B - Job Area
  JOB_NAME: 2, // C - Job Name
  DATE: 3, // D - Date
  ADDRESS: 4, // E - Address
  FAB_PIPES: 5, // F - FAB Pipes
  LOOSE_PIPES: 6, // G - Loose Pipes
  THD_FITTINGS: 7, // H - THD Fittings
  NIPPLES: 8, // I - Nipples
  GRVD_FITTINGS: 9, // J - GRVD Fittings
  // Note: Column 10 (K) is duplicate "Nipples" - skipped
  VALVES: 11, // L - Valves
  HEADS: 12, // M - Heads
  HANGERS: 13, // N - Hangers
  ROD_STRUT: 14, // O - Rod/Strut
  FLEX_DROPS: 15, // P - Flex Drops
  CPVC_PIPES: 16, // Q - CPVC Pipes
  QUICK_DROPS: 17, // R - Quick Drops
  PIPE_STAND: 18, // S - Pipe Stand
  COMPRESSOR: 19, // T - Compressor
  BACKFLOW: 20, // U - Backflow
  SIGNS: 21, // V - Signs
  LOCATION: 22, // W - Location
  LOCATION_ROW: 23, // X - Row
  LOCATION_COLUMN: 24, // Y - Column
  PICKUP_GALLOUP: 29, // AD - Pick Up at Galloup (Z-AC: boxes/skids/bags/bundles removed)
  PICKUP_ETNA: 30, // AE - Pick Up at Etna
  PICKUP_VIKING: 31, // AF - Pick Up at Viking
  PICKUP_OTHER: 32, // AG - Picking up at Other
  DELIVERY_GALLOUP: 33, // AH - Galloup - Delivering
  DELIVERY_ETNA: 34, // AI - Etna - Delivering
  DELIVERY_VIKING: 35, // AJ - Viking - Delivering
  DELIVERY_OTHER: 36, // AK - Other - Delivering
  FITTER_PICKING_UP: 37, // AL - Fitter Picking up Material
  PICKER: 38, // AM - Picker
  PICKER_DATE: 39, // AN - Picker Date
  RECEIVER: 40, // AO - Reciever
  RECEIVER_DATE: 41, // AP - Reciever Date
  LOADER_DRIVER: 42, // AQ - Loader/Driver
  FITTER: 43, // AR - Fitter
  MATERIAL_DATE: 44, // AS - Date (for Fitter/Material)
  BACKORDERS_ETNA_ORDERED: 46, // AU - Backorders - Etna (Ordered)
  BACKORDERS_GALLOUP_ORDERED: 47, // AV - Backorders - Galloup (Ordered)
  BACKORDERS_VIKING_ORDERED: 48, // AW - Backorders - Vikings (Ordered)
  BACKORDERS_COREMAIN_ORDERED: 49, // AX - Backorders - Core & Main (Ordered)
  BACKORDERS_ETNA_PARTIAL: 50, // AY - Backorders - Etna (Partial)
  BACKORDERS_GALLOUP_PARTIAL: 51, // AZ - Backorders - Galloup (Partial)
  BACKORDERS_VIKING_PARTIAL: 52, // BA - Backorders - Vikings (Partial)
  BACKORDERS_COREMAIN_PARTIAL: 53, // BB - Backorders - Core & Main (Partial)
  BACKORDERS_ETNA_RECEIVED: 54, // BC - Backorders - Etna (Received)
  BACKORDERS_GALLOUP_RECEIVED: 55, // BD - Backorders - Galloup (Received)
  BACKORDERS_VIKING_RECEIVED: 56, // BE - Backorders - Vikings (Received)
  BACKORDERS_COREMAIN_RECEIVED: 57, // BF - Backorders - Core & Main (Received)
  FROM_SHOP_COMPLETE: 58, // BG - From Shop - Complete
  FROM_SHOP_STILL_NEED: 59, // BH - From Shop - Still Need
  FROM_SUPPLIERS_COMPLETE: 60, // BI - From Suppliers - Complete
  FROM_SUPPLIERS_STILL_NEED: 61, // BJ - From Suppliers - Still Need
  DATE_UPDATED: 62, // BK - Date Updated
} as const;

/**
 * Helper to parse boolean from cell value (checkboxes in sheets)
 */
export function parseBoolean(value: any): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    return (
      lower === "true" ||
      lower === "yes" ||
      lower === "x" ||
      lower === "✓" ||
      lower === "✔"
    );
  }
  return false;
}
