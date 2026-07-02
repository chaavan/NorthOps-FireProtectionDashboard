import type {
  EstimateConfidenceLevel,
  EstimateDraft,
  EstimateLookupCategory,
  EstimateProjectSection,
  EstimateSalesType,
} from "@/lib/estimateTypes";

export const ESTIMATE_LOOKUP_CATEGORIES: EstimateLookupCategory[] = [
  "building_type",
  "job_type",
];

export const CONFIDENCE_LEVELS: Array<{
  value: EstimateConfidenceLevel;
  label: string;
  shortLabel: string;
}> = [
  { value: 1, label: "Highly Confident", shortLabel: "Highly" },
  { value: 2, label: "Confident", shortLabel: "Confident" },
  { value: 3, label: "Neutral", shortLabel: "Neutral" },
  { value: 4, label: "Low Confidence", shortLabel: "Low" },
  { value: 5, label: "Unlikely", shortLabel: "Unlikely" },
];

export const SALES_TYPE_OPTIONS: Array<{ value: EstimateSalesType; label: string }> = [
  { value: "COMPETITIVE", label: "Competitive" },
  { value: "NEGOTIATED", label: "Negotiated" },
];

export const METADATA_FIELD_LABELS = {
  buildingType: "Building Type",
  jobType: "Job Type",
  salesType: "Sales Type",
  confidenceLevel: "Confidence Level",
} as const;

export function defaultEstimateProjectMetadata(): Pick<
  EstimateProjectSection,
  | "buildingTypeOptionId"
  | "buildingTypeOther"
  | "jobTypeOptionId"
  | "jobTypeOther"
  | "salesType"
  | "confidenceLevel"
> {
  return {
    buildingTypeOptionId: null,
    buildingTypeOther: null,
    jobTypeOptionId: null,
    jobTypeOther: null,
    salesType: null,
    confidenceLevel: null,
  };
}

export function normalizeEstimateProjectSection(
  project: Partial<EstimateProjectSection> | null | undefined,
): EstimateProjectSection {
  const base = project ?? ({} as Partial<EstimateProjectSection>);
  const metadata = defaultEstimateProjectMetadata();

  return {
    date: typeof base.date === "string" ? base.date : "",
    estimator: typeof base.estimator === "string" ? base.estimator : "",
    projectName: typeof base.projectName === "string" ? base.projectName : "",
    systemLabel: typeof base.systemLabel === "string" ? base.systemLabel : "",
    projectLocationLine1:
      typeof base.projectLocationLine1 === "string" ? base.projectLocationLine1 : "",
    projectLocationLine2:
      typeof base.projectLocationLine2 === "string" ? base.projectLocationLine2 : "",
    bidDueDate: typeof base.bidDueDate === "string" ? base.bidDueDate : "",
    squareFootage:
      typeof base.squareFootage === "number" && Number.isFinite(base.squareFootage)
        ? base.squareFootage
        : null,
    buildingTypeOptionId:
      typeof base.buildingTypeOptionId === "string" && base.buildingTypeOptionId.trim()
        ? base.buildingTypeOptionId.trim()
        : null,
    buildingTypeOther:
      typeof base.buildingTypeOther === "string" && base.buildingTypeOther.trim()
        ? base.buildingTypeOther.trim()
        : null,
    jobTypeOptionId:
      typeof base.jobTypeOptionId === "string" && base.jobTypeOptionId.trim()
        ? base.jobTypeOptionId.trim()
        : null,
    jobTypeOther:
      typeof base.jobTypeOther === "string" && base.jobTypeOther.trim()
        ? base.jobTypeOther.trim()
        : null,
    salesType:
      base.salesType === "COMPETITIVE" || base.salesType === "NEGOTIATED"
        ? base.salesType
        : null,
    confidenceLevel:
      base.confidenceLevel === 1 ||
      base.confidenceLevel === 2 ||
      base.confidenceLevel === 3 ||
      base.confidenceLevel === 4 ||
      base.confidenceLevel === 5
        ? base.confidenceLevel
        : null,
  };
}

export function hasBuildingType(project: EstimateProjectSection): boolean {
  return Boolean(project.buildingTypeOptionId || project.buildingTypeOther);
}

export function hasJobType(project: EstimateProjectSection): boolean {
  return Boolean(project.jobTypeOptionId || project.jobTypeOther);
}

export function validateMetadataForSent(draft: EstimateDraft): {
  ok: boolean;
  missingFields: string[];
} {
  const project = normalizeEstimateProjectSection(draft.project);
  const missingFields: string[] = [];

  if (!hasBuildingType(project)) {
    missingFields.push(METADATA_FIELD_LABELS.buildingType);
  }
  if (!hasJobType(project)) {
    missingFields.push(METADATA_FIELD_LABELS.jobType);
  }
  if (!project.salesType) {
    missingFields.push(METADATA_FIELD_LABELS.salesType);
  }
  if (!project.confidenceLevel) {
    missingFields.push(METADATA_FIELD_LABELS.confidenceLevel);
  }

  return { ok: missingFields.length === 0, missingFields };
}

export function resolveLookupTypeLabel(params: {
  optionId: string | null;
  other: string | null;
  optionsById: Map<string, string>;
}): string | null {
  if (params.other) return params.other;
  if (params.optionId && params.optionsById.has(params.optionId)) {
    return params.optionsById.get(params.optionId) ?? null;
  }
  return null;
}

export function confidenceLevelLabel(
  level: EstimateConfidenceLevel | null | undefined,
): string | null {
  if (!level) return null;
  return CONFIDENCE_LEVELS.find((item) => item.value === level)?.label ?? null;
}

export function salesTypeLabel(
  salesType: EstimateSalesType | null | undefined,
): string | null {
  if (!salesType) return null;
  return SALES_TYPE_OPTIONS.find((item) => item.value === salesType)?.label ?? null;
}

export class EstimateMetadataValidationError extends Error {
  missingFields: string[];

  constructor(message: string, missingFields: string[]) {
    super(message);
    this.name = "EstimateMetadataValidationError";
    this.missingFields = missingFields;
  }
}

export class EstimateContractPriceRequiredError extends Error {
  constructor() {
    super("Contract price is required when marking an estimate as Won.");
    this.name = "EstimateContractPriceRequiredError";
  }
}

/** Draft percents are whole numbers (25 = 25%). Legacy values may be Excel decimals (0.25). */
export function draftPercentToDisplay(value: number | null | undefined): number | "" {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  if (value > 0 && value <= 1) return Math.round(value * 10000) / 100;
  return value;
}

export function normalizeDraftPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (value > 0 && value <= 1) return Math.round(value * 10000) / 100;
  return value;
}

export function percentFromTemplateCell(value: number | null): number {
  if (value === null) return 0;
  return normalizeDraftPercent(value) ?? 0;
}
