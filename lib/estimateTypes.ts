export type EstimateTemplateKey = "system-1";

export type EstimateStatus = "DRAFT" | "ACTIVE";

export type EstimatePricingMode =
  | "template_default"
  | "parts_database_match"
  | "manual_override";

export type EstimateRowType =
  | "item"
  | "section_header"
  | "subtotal"
  | "adjustment";

export type EstimateSectionKey =
  | "project"
  | "inputs"
  | "rates"
  | "field"
  | "shop"
  | "design"
  | "materials"
  | "subsAndFees"
  | "summary"
  | "changeOrders";

export type EstimateScalar = string | number | boolean | null;

export type EstimateValueMap = Record<string, EstimateScalar>;

export type EstimateManualCostMap = Record<string, number | null>;

export type EstimateVisibleLinePriceSource =
  | "database"
  | "manual"
  | "missing";

export type EstimateParityStatus = "pass" | "blocked";

export type EstimateChangeOrder = {
  id: string;
  title: string;
  description: string;
  amount: number;
  hours?: number | null;
};

export type EstimateMeta = {
  jobNumber: string;
  listNumber: string;
  jobName: string;
  templateKey: EstimateTemplateKey;
  templateVersion: string;
  status: EstimateStatus;
};

export type EstimateSalesType = "COMPETITIVE" | "NEGOTIATED";

export type EstimateConfidenceLevel = 1 | 2 | 3 | 4 | 5;

export type EstimateLookupCategory = "building_type" | "job_type";

export type EstimateProjectSection = {
  date: string;
  estimator: string;
  projectName: string;
  systemLabel: string;
  projectLocationLine1: string;
  projectLocationLine2: string;
  bidDueDate: string;
  squareFootage: number | null;
  buildingTypeOptionId: string | null;
  buildingTypeOther: string | null;
  jobTypeOptionId: string | null;
  jobTypeOther: string | null;
  salesType: EstimateSalesType | null;
  confidenceLevel: EstimateConfidenceLevel | null;
};

export type EstimateLookupOptionRecord = {
  id: string;
  category: EstimateLookupCategory;
  label: string;
  normalizedKey: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
};

export type EstimateInputsSection = {
  milesToJobSite: number | null;
  salesTaxPercent: number;
  materialInflationPercent: number;
  overheadPercent: number;
  profitPercent: number;
  subsMarkupPercent: number;
  fees: number | null;
  peStamp: number | null;
  bondCost: number | null;
};

export type EstimateRatesSection = {
  adjustedRates: EstimateValueMap;
};

export type EstimateFieldSection = {
  manualHours: EstimateValueMap;
  costs: EstimateValueMap;
};

export type EstimateShopSection = {
  inputs: EstimateValueMap;
};

export type EstimateDesignSection = {
  inputs: EstimateValueMap;
};

export type EstimateAutoChildSource = "rule" | null;

export type EstimatePumpBundleSize = 4 | 6 | 8 | 10;

export type EstimateVisibleMaterialLine = {
  lineKey: string;
  autoSource?: EstimateAutoChildSource;
  pumpSize?: EstimatePumpBundleSize | null;
  catalogRowKey?: string | null;
  catalogQuantityCell?: string | null;
  catalogUnitCostCell?: string | null;
  isCatalogFormula?: boolean | null;
  rowIndex: number;
  partNumber: string | null;
  description: string | null;
  manualQty: number;
  autoQty: number;
  effectiveQuantity: number;
  supplier: string | null;
  databaseUnitPrice: number | null;
  manualUnitPrice: number | null;
  baseUnitPrice?: number | null;
  vendorAdjustmentPercent?: number | null;
  adjustedUnitPrice?: number | null;
  resolvedUnitPrice: number | null;
  priceSource: EstimateVisibleLinePriceSource;
  blockingReason: string | null;
  lineTotal: number | null;
};

export type EstimateVendorAdjustmentRule = {
  id: string;
  vendor: string;
  percent: number;
};

export type EstimateWorkbookCatalogState = {
  rows: EstimateCatalogRow[];
  cellOverrides?: EstimateValueMap;
};

export type EstimateMaterialSection = {
  visibleLines: EstimateVisibleMaterialLine[];
  vendorAdjustments?: EstimateVendorAdjustmentRule[];
  workbookCatalog?: EstimateWorkbookCatalogState;
};

export type EstimateSubsAndFeesSection = {
  miscellaneousCosts: EstimateValueMap;
  miscellaneousLabels?: Record<string, string>;
};

export type EstimateSectionAdjustment = {
  adjustmentRowKey: string;
  label: string;
  percentCell: string;
  percent: number;
  sectionSubtotal: number;
  amount: number;
};

export type EstimateSummarySection = {
  materialSubtotal: number;
  materialLinesSubtotal: number;
  sectionAdjustmentsTotal: number;
  salesTaxCost: number;
  materialInflationCost: number;
  totalMaterialCost: number;
  totalFieldHours: number;
  totalFieldCost: number;
  totalShopHours: number;
  totalShopCost: number;
  totalDesignHours: number;
  totalDesignCost: number;
  subtotal: number;
  overheadCost: number;
  subtotalWithOverhead: number;
  profitCost: number;
  subtotalWithProfit: number;
  subsSubtotal: number;
  subsMarkupCost: number;
  subsTotal: number;
  fees: number;
  feesTotal: number;
  peStamp: number;
  bondCost: number;
  totalCost: number;
  grandTotalLaborHours: number;
  totalSprinklers: number;
  materialCostPerHead: number | null;
  totalCostPerHead: number | null;
  hoursPerHead: number | null;
  totalCostPerSquareFoot: number | null;
  travelZone: number | null;
};

export type EstimateParityIssue = {
  code: string;
  message: string;
  lineKey?: string | null;
  rowKey?: string | null;
};

export type EstimateParityReport = {
  status: EstimateParityStatus;
  canExportPdf: boolean;
  checkedAt: string;
  issues: EstimateParityIssue[];
  requiredSummaryCells: Record<string, number | null>;
};

export type EstimateDraft = {
  meta: EstimateMeta;
  project: EstimateProjectSection;
  inputs: EstimateInputsSection;
  rates: EstimateRatesSection;
  field: EstimateFieldSection;
  shop: EstimateShopSection;
  design: EstimateDesignSection;
  materials: EstimateMaterialSection;
  subsAndFees: EstimateSubsAndFeesSection;
  summary: EstimateSummarySection | null;
  parity: EstimateParityReport | null;
  changeOrders: EstimateChangeOrder[];
};

export type EstimateCatalogRow = {
  rowKey: string;
  sheetRow: number;
  section: string;
  subcategory: string | null;
  label: string | null;
  description: string | null;
  detail: string | null;
  vendorPartNumber: string | null;
  quantityCell: string | null;
  unitCostCell: string | null;
  defaultUnitCost: number | null;
  pricingMode: EstimatePricingMode;
  rowType: EstimateRowType;
  formulaKey: string | null;
  isQuantityDerived: boolean;
  quantity: number | null;
  unitCost: number | null;
  lineTotal: number | null;
};

export type EstimateWorkbookSectionRow = {
  rowKey: string;
  label: string;
  hoursCell?: string | null;
  daysCell?: string | null;
  quantityCell?: string | null;
  rateCell?: string | null;
  unitRateCell?: string | null;
  minutesCell?: string | null;
  costCell?: string | null;
  quantity?: number | null;
  rate?: number | null;
  unitRate?: number | null;
  minutes?: number | null;
  hours?: number | null;
  days?: number | null;
  cost?: number | null;
};

export type EstimateWorkbookAdjustmentRow = {
  id: string;
  label: string;
  hours: number;
  cost: number;
};

export type EstimateComputed = {
  draft: EstimateDraft;
  summary: EstimateSummarySection;
  parity: EstimateParityReport;
  projectDisplayRows: Array<{ label: string; value: string }>;
  fieldRows: EstimateWorkbookSectionRow[];
  shopRows: EstimateWorkbookSectionRow[];
  designRows: EstimateWorkbookSectionRow[];
  materials: EstimateCatalogRow[];
  visibleMaterialLines: EstimateVisibleMaterialLine[];
  sectionAdjustments: EstimateSectionAdjustment[];
  totalsBySection: Array<{ label: string; amount: number }>;
  summaryRows: Array<{ label: string; amount: number | null; cell: string }>;
};

export type EstimateVariantStatus = "draft" | "final" | "archived";

export type StandaloneEstimateBidStatus =
  | "DRAFT"
  | "SENT"
  | "WON"
  | "LOST"
  | "ARCHIVED";

export type EstimateRecord = {
  id: string;
  jobNumber: string;
  listNumber: string;
  jobName: string;
  templateKey: EstimateTemplateKey;
  templateVersion: string;
  variantKey: string;
  variantLabel: string | null;
  variantStatus: EstimateVariantStatus;
  status: EstimateStatus;
  data: EstimateDraft;
  subtotal: number | null;
  totalCost: number | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EstimateVariantSummary = {
  variantKey: string;
  variantLabel: string | null;
  variantStatus: EstimateVariantStatus;
  subtotal: number | null;
  totalCost: number | null;
  updatedAt: string;
};

export type StandaloneEstimateSummaryRecord = {
  id: string;
  title: string;
  projectName: string | null;
  projectNumber: string | null;
  locationLine1: string | null;
  locationLine2: string | null;
  bidStatus: StandaloneEstimateBidStatus;
  contractPrice: number | null;
  archived: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  activeVariant: EstimateVariantSummary | null;
};

export type StandaloneEstimateRecord = StandaloneEstimateSummaryRecord;

export type StandaloneEstimateVariantRecord = {
  id: string;
  estimateId: string;
  templateKey: EstimateTemplateKey;
  templateVersion: string;
  variantKey: string;
  variantLabel: string | null;
  variantStatus: EstimateVariantStatus;
  data: EstimateDraft;
  subtotal: number | null;
  totalCost: number | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StandaloneEstimateDetail = {
  estimate: StandaloneEstimateRecord;
  variant: StandaloneEstimateVariantRecord;
  computed: EstimateComputed;
};
