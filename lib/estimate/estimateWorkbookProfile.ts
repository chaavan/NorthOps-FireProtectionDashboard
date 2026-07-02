import { softwareConfig } from "@/lib/softwareConfig";

export type EstimateWorkbookProfileId = "tfp" | "northops";

export type EstimateWorkbookFeeTiers = {
  basePermitFee: number;
  tierFees: [number, number, number, number];
  extraFeeThreshold: number;
  extraFeeStep: number;
  extraFeeRate: number;
};

export type EstimateWorkbookProfile = {
  id: EstimateWorkbookProfileId;
  templateDisplayName: string;
  workDayHours: number;
  productionRateScale: number;
  feeTiers: EstimateWorkbookFeeTiers;
  shopRowLabels: Record<number, string>;
  fieldCostDescription: string;
  shopCostDescription: string;
  designCostDescription: string;
};

const TFP_PROFILE: EstimateWorkbookProfile = {
  id: "tfp",
  templateDisplayName: "System 1",
  workDayHours: 16,
  productionRateScale: 1,
  feeTiers: {
    basePermitFee: 70,
    tierFees: [30, 45, 60, 70],
    extraFeeThreshold: 15000,
    extraFeeStep: 3000,
    extraFeeRate: 17,
  },
  shopRowLabels: {
    75: "TFP Line & Main Fab",
    76: "TFP Riser Fab",
    77: "TFP Pump Fab",
    78: "TFP Fab",
  },
  fieldCostDescription:
    "Rows 13-72 from System 1. Green cells are locked calculations; yellow cells are optional inputs and adjustable rates.",
  shopCostDescription:
    "Rows 73-83 from System 1. Fabrication and trucking auto-calculate from upstream inputs; yellow cells indicate manual overrides.",
  designCostDescription:
    "Rows 85-97 from System 1. Calculation basis, design hours, and travel auto-derive; yellow cells indicate manual overrides.",
};

const NORTHOPS_PROFILE: EstimateWorkbookProfile = {
  id: "northops",
  templateDisplayName: "NorthOps Standard",
  workDayHours: 8,
  productionRateScale: 1.12,
  feeTiers: {
    basePermitFee: 100,
    tierFees: [40, 60, 80, 100],
    extraFeeThreshold: 18000,
    extraFeeStep: 4000,
    extraFeeRate: 15,
  },
  shopRowLabels: {
    75: "Line & Main Fab",
    76: "Riser Fab",
    77: "Pump Fab",
    78: "General Fab",
  },
  fieldCostDescription:
    "Field labor production rates and piping workload. Green cells are locked calculations; yellow cells are adjustable inputs.",
  shopCostDescription:
    "Shop fabrication and trucking. Auto-calculated from upstream inputs; yellow cells indicate manual overrides.",
  designCostDescription:
    "Design hours, travel, and site visits. Auto-derived from project inputs; yellow cells indicate manual overrides.",
};

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveProfileId(): EstimateWorkbookProfileId {
  const explicit = process.env.NEXT_PUBLIC_ESTIMATE_WORKBOOK_PROFILE?.trim().toLowerCase();
  if (explicit === "northops" || explicit === "tfp") {
    return explicit;
  }
  if (softwareConfig.id === "northops-fire") {
    return "northops";
  }
  return "tfp";
}

export function getEstimateWorkbookProfile(): EstimateWorkbookProfile {
  const id = resolveProfileId();
  const base = id === "northops" ? NORTHOPS_PROFILE : TFP_PROFILE;
  const workDayHours = envNumber("NEXT_PUBLIC_ESTIMATE_WORK_DAY_HOURS", base.workDayHours);
  const productionRateScale = envNumber(
    "NEXT_PUBLIC_ESTIMATE_PRODUCTION_RATE_SCALE",
    base.productionRateScale,
  );

  if (workDayHours === base.workDayHours && productionRateScale === base.productionRateScale) {
    return base;
  }

  return {
    ...base,
    workDayHours,
    productionRateScale,
  };
}

export function scaleDefaultProductionRate(baseRate: number): number {
  const { productionRateScale } = getEstimateWorkbookProfile();
  return Math.round(baseRate * productionRateScale);
}

export function productionPeriodToHourlyRate(periodRate: number): number {
  const { workDayHours } = getEstimateWorkbookProfile();
  if (!Number.isFinite(periodRate) || periodRate <= 0) return 0;
  return periodRate / workDayHours;
}

export function hoursToWorkDays(hours: number): number {
  const { workDayHours } = getEstimateWorkbookProfile();
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.ceil(hours / workDayHours);
}

/** Mirrors the sprinkler minutes ↔ production-rate UI conversion (96 = 16 × 6). */
export function sprinklersDisplayFactor(): number {
  const { workDayHours } = getEstimateWorkbookProfile();
  return workDayHours * 6;
}

export function rewriteWorkDayFormula(formula: string): string {
  const { workDayHours } = getEstimateWorkbookProfile();
  if (workDayHours === 16 || !formula.startsWith("=")) {
    return formula;
  }

  let result = formula;
  result = result.replace(/\/16(?![0-9])/g, `/${workDayHours}`);
  result = result.replace(/(?<![A-Z])\*16(?![0-9])/gi, `*${workDayHours}`);
  result = result.replace(/^=16\*/i, `=${workDayHours}*`);
  result = result.replace(/(?<![A-Z0-9])16\//g, `${workDayHours}/`);
  return result;
}

export function getWorkbookTemplateDisplayName(fallback = "Workbook"): string {
  return getEstimateWorkbookProfile().templateDisplayName || fallback;
}

export function calculateProfileAutomaticFees(params: {
  feeBase: number;
  totalSprinklers: number;
  sprinklerFeeRate?: number | null;
}): number {
  const { feeTiers } = getEstimateWorkbookProfile();

  if (params.feeBase < 1) {
    return 0;
  }

  const tierFee =
    params.feeBase < 3000
      ? feeTiers.tierFees[0]
      : params.feeBase < 8000
        ? feeTiers.tierFees[1]
        : params.feeBase < 11000
          ? feeTiers.tierFees[2]
          : feeTiers.tierFees[3];
  const extraFee =
    Math.ceil(Math.max(params.feeBase - feeTiers.extraFeeThreshold, 0) / feeTiers.extraFeeStep) *
    feeTiers.extraFeeRate;
  const sprinklerFee =
    Math.max(0, params.totalSprinklers) * Math.max(0, params.sprinklerFeeRate ?? 0);

  return Number(
    (feeTiers.basePermitFee + tierFee + extraFee + sprinklerFee).toFixed(2),
  );
}
