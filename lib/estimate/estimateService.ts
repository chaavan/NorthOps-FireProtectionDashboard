import { Prisma } from "@prisma/client";
import { withDbRetry } from "@/lib/dbRetry";
import { prisma } from "@/lib/prisma";
import { getPricingForParts } from "@/lib/partsDatabase";
import type {
  EstimateComputed,
  EstimateConfidenceLevel,
  EstimateDraft,
  EstimateSalesType,
  EstimateVariantStatus,
  EstimateVariantSummary,
  StandaloneEstimateBidStatus,
  StandaloneEstimateDetail,
  StandaloneEstimateRecord,
  StandaloneEstimateSummaryRecord,
  StandaloneEstimateVariantRecord,
} from "@/lib/estimateTypes";
import {
  buildMaterialCatalogRowMetadata,
  createDefaultEstimateDraft,
  SYSTEM1_TEMPLATE_KEY,
  SYSTEM1_TEMPLATE_VERSION,
} from "@/lib/estimate/system1Template";
import { computeEstimateFromDraft } from "@/lib/estimate/estimateEngine";
import { applyMaterialCatalogDefaultsToDraft } from "@/lib/estimate/materialCatalogService";
import {
  EstimateContractPriceRequiredError,
  EstimateMetadataValidationError,
  normalizeEstimateProjectSection,
  validateMetadataForSent,
} from "@/lib/estimate/estimateMetadata";
import type { JobDetailsResponse } from "@/lib/types";

export const DEFAULT_ESTIMATE_VARIANT_KEY = "base";
const STANDALONE_LIST_LABEL = "Standalone";
export const ACTIVE_STANDALONE_ESTIMATE_STATUSES: StandaloneEstimateBidStatus[] = [
  "DRAFT",
  "SENT",
];
export const ARCHIVED_STANDALONE_ESTIMATE_STATUSES: StandaloneEstimateBidStatus[] = [
  "WON",
  "LOST",
  "ARCHIVED",
];
export const ALL_STANDALONE_ESTIMATE_STATUSES: StandaloneEstimateBidStatus[] = [
  ...ACTIVE_STANDALONE_ESTIMATE_STATUSES,
  ...ARCHIVED_STANDALONE_ESTIMATE_STATUSES,
];

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value == null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeVariantKey(value: string | null | undefined): string {
  if (!value) {
    return DEFAULT_ESTIMATE_VARIANT_KEY;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_ESTIMATE_VARIANT_KEY;
  }
  return (
    trimmed
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || DEFAULT_ESTIMATE_VARIANT_KEY
  );
}

function normalizeVariantStatus(value: string | null | undefined): EstimateVariantStatus {
  if (value === "final" || value === "archived") {
    return value;
  }
  return "draft";
}

function normalizeStandaloneEstimateBidStatus(
  value: string | null | undefined,
  archived?: boolean | null,
): StandaloneEstimateBidStatus {
  const normalized = value?.trim().toUpperCase();
  if (
    normalized === "DRAFT" ||
    normalized === "SENT" ||
    normalized === "WON" ||
    normalized === "LOST" ||
    normalized === "ARCHIVED"
  ) {
    return normalized;
  }
  return archived ? "ARCHIVED" : "DRAFT";
}

function isPastStandaloneEstimateStatus(status: StandaloneEstimateBidStatus) {
  return ARCHIVED_STANDALONE_ESTIMATE_STATUSES.includes(status);
}

function normalizePartKey(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/[\s\t\r\n]+/g, "").toUpperCase().trim();
  return normalized || null;
}

function standaloneEstimateNumber(record: {
  id: string;
  projectNumber?: string | null;
}) {
  return record.projectNumber?.trim() || `EST-${record.id.slice(-6).toUpperCase()}`;
}

function activeVariantFromRecord(record: any): EstimateVariantSummary | null {
  const variants = Array.isArray(record.variants) ? record.variants : [];
  const active =
    variants.find((variant: any) => variant.variantKey === DEFAULT_ESTIMATE_VARIANT_KEY) ??
    variants[0] ??
    null;
  if (!active) {
    return null;
  }
  return {
    variantKey: active.variantKey ?? DEFAULT_ESTIMATE_VARIANT_KEY,
    variantLabel: active.variantLabel ?? null,
    variantStatus: normalizeVariantStatus(active.variantStatus ?? null),
    subtotal: toNullableNumber(active.subtotal),
    totalCost: toNullableNumber(active.totalCost),
    updatedAt: active.updatedAt.toISOString(),
  };
}

function serializeEstimateRecord(record: any): StandaloneEstimateRecord {
  return {
    id: record.id,
    title: record.title,
    projectName: record.projectName ?? null,
    projectNumber: record.projectNumber ?? null,
    locationLine1: record.locationLine1 ?? null,
    locationLine2: record.locationLine2 ?? null,
    bidStatus: normalizeStandaloneEstimateBidStatus(record.bidStatus, record.archived),
    contractPrice: toNullableNumber(record.contractPrice),
    archived: Boolean(record.archived),
    createdBy: record.createdBy ?? null,
    updatedBy: record.updatedBy ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    activeVariant: activeVariantFromRecord(record),
  };
}

function serializeVariantRecord(record: any): StandaloneEstimateVariantRecord {
  return {
    id: record.id,
    estimateId: record.estimateId,
    templateKey: record.templateKey,
    templateVersion: record.templateVersion,
    variantKey: record.variantKey ?? DEFAULT_ESTIMATE_VARIANT_KEY,
    variantLabel: record.variantLabel ?? null,
    variantStatus: normalizeVariantStatus(record.variantStatus ?? null),
    data: record.data as EstimateDraft,
    subtotal: toNullableNumber(record.subtotal),
    totalCost: toNullableNumber(record.totalCost),
    createdBy: record.createdBy ?? null,
    updatedBy: record.updatedBy ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function buildSyntheticJobDetailsForEstimate(record: {
  id: string;
  title: string;
  projectName?: string | null;
  projectNumber?: string | null;
  locationLine1?: string | null;
  locationLine2?: string | null;
  createdBy?: string | null;
}): JobDetailsResponse {
  return {
    jobNumber: standaloneEstimateNumber(record),
    jobName: record.projectName?.trim() || record.title,
    lineItems: [],
    jobMeta: {
      listNumber: STANDALONE_LIST_LABEL,
      area: record.locationLine2 ?? null,
      locationShipTo: record.locationLine1 ?? null,
      stocklistDeliveryShipDate: null,
      listedBy: record.createdBy ?? null,
      listedByName: record.createdBy ?? null,
    },
  };
}

function createDefaultStandaloneDraft(record: {
  id: string;
  title: string;
  projectName?: string | null;
  projectNumber?: string | null;
  locationLine1?: string | null;
  locationLine2?: string | null;
  createdBy?: string | null;
}): EstimateDraft {
  const draft = createDefaultEstimateDraft(buildSyntheticJobDetailsForEstimate(record));
  return {
    ...draft,
    meta: {
      ...draft.meta,
      jobNumber: standaloneEstimateNumber(record),
      listNumber: STANDALONE_LIST_LABEL,
      jobName: record.projectName?.trim() || record.title,
      templateKey: SYSTEM1_TEMPLATE_KEY,
      templateVersion: SYSTEM1_TEMPLATE_VERSION,
    },
    project: {
      ...draft.project,
      projectName: record.projectName?.trim() || record.title,
      systemLabel: record.projectNumber?.trim() || STANDALONE_LIST_LABEL,
      projectLocationLine1: record.locationLine1 ?? "",
      projectLocationLine2: record.locationLine2 ?? "",
    },
    materials: {
      visibleLines: [],
      vendorAdjustments: [],
      workbookCatalog: {
        rows: buildMaterialCatalogRowMetadata(),
        cellOverrides: {},
      },
    },
  };
}

function synchronizeDraftWithEstimate(
  draft: EstimateDraft,
  record: {
    id: string;
    title: string;
    projectName?: string | null;
    projectNumber?: string | null;
    locationLine1?: string | null;
    locationLine2?: string | null;
  },
): EstimateDraft {
  return {
    ...draft,
    meta: {
      ...draft.meta,
      jobNumber: standaloneEstimateNumber(record),
      listNumber: STANDALONE_LIST_LABEL,
      jobName: record.projectName?.trim() || record.title,
      templateKey: SYSTEM1_TEMPLATE_KEY,
      templateVersion: SYSTEM1_TEMPLATE_VERSION,
    },
    project: {
      ...normalizeEstimateProjectSection(draft.project),
      projectName: draft.project.projectName || record.projectName || record.title,
      systemLabel: draft.project.systemLabel || record.projectNumber || STANDALONE_LIST_LABEL,
      projectLocationLine1:
        draft.project.projectLocationLine1 || record.locationLine1 || "",
      projectLocationLine2:
        draft.project.projectLocationLine2 || record.locationLine2 || "",
    },
    rates: {
      adjustedRates: draft.rates?.adjustedRates ?? {},
    },
    materials: {
      visibleLines: Array.isArray(draft.materials?.visibleLines)
        ? draft.materials.visibleLines
        : [],
      vendorAdjustments: Array.isArray(draft.materials?.vendorAdjustments)
        ? draft.materials.vendorAdjustments
        : [],
      workbookCatalog: {
        rows: Array.isArray(draft.materials?.workbookCatalog?.rows)
          ? draft.materials.workbookCatalog.rows
          : buildMaterialCatalogRowMetadata(),
        cellOverrides: draft.materials?.workbookCatalog?.cellOverrides ?? {},
      },
    },
    subsAndFees: {
      miscellaneousCosts: draft.subsAndFees?.miscellaneousCosts ?? {},
      miscellaneousLabels: draft.subsAndFees?.miscellaneousLabels ?? {},
    },
    summary: draft.summary ?? null,
    parity: draft.parity ?? null,
    changeOrders: Array.isArray(draft.changeOrders) ? draft.changeOrders : [],
  };
}

async function buildPricingLookup(draft: EstimateDraft) {
  const partNumbers = Array.from(
    new Set(
      draft.materials.visibleLines
        .map((line) => line.partNumber?.trim() || null)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const rawLookup = await getPricingForParts(partNumbers);
  const lookup = new Map<string, { cost: number; supplier: string }>();
  rawLookup.forEach((value, key) => {
    lookup.set(key, value);
    const normalized = normalizePartKey(key);
    if (normalized) {
      lookup.set(normalized, value);
    }
  });
  return lookup;
}

async function computeWithPricing(draft: EstimateDraft): Promise<EstimateComputed> {
  const pricingLookup = await buildPricingLookup(draft);
  return computeEstimateFromDraft(draft, pricingLookup);
}

async function findEstimateOrThrow(estimateId: string) {
  return prisma.standaloneEstimate.findUniqueOrThrow({
    where: { id: estimateId },
    include: {
      variants: {
        where: { variantStatus: { not: "archived" } },
        orderBy: [{ variantKey: "asc" }],
      },
    },
  });
}

async function getPrimaryVariantDraft(estimateId: string): Promise<EstimateDraft> {
  const estimate = await findEstimateOrThrow(estimateId);
  const variant =
    estimate.variants.find((item) => item.variantKey === DEFAULT_ESTIMATE_VARIANT_KEY) ??
    estimate.variants[0];
  if (!variant) {
    throw new Error("Estimate variant not found.");
  }
  return synchronizeDraftWithEstimate(variant.data as EstimateDraft, estimate);
}

async function ensureVariantRecord(params: {
  estimateId: string;
  variantKey?: string | null;
  variantLabel?: string | null;
  copyFromVariantKey?: string | null;
  userEmail?: string | null;
}) {
  const estimate = await findEstimateOrThrow(params.estimateId);
  const variantKey = normalizeVariantKey(params.variantKey ?? null);
  const existing = await prisma.standaloneEstimateVariant.findFirst({
    where: {
      estimateId: estimate.id,
      templateKey: SYSTEM1_TEMPLATE_KEY,
      variantKey,
    },
  });
  if (existing) {
    return existing;
  }

  let seedDraft = createDefaultStandaloneDraft(estimate);
  let shouldApplyCatalogDefaults = true;
  if (params.copyFromVariantKey) {
    const source = await prisma.standaloneEstimateVariant.findFirst({
      where: {
        estimateId: estimate.id,
        templateKey: SYSTEM1_TEMPLATE_KEY,
        variantKey: normalizeVariantKey(params.copyFromVariantKey),
      },
    });
    if (source) {
      seedDraft = source.data as EstimateDraft;
      shouldApplyCatalogDefaults = false;
    }
  }

  const synchronized = synchronizeDraftWithEstimate(
    shouldApplyCatalogDefaults ? await applyMaterialCatalogDefaultsToDraft(seedDraft) : seedDraft,
    estimate,
  );
  const computed = await computeWithPricing(synchronized);
  const label =
    typeof params.variantLabel === "string" && params.variantLabel.trim().length > 0
      ? params.variantLabel.trim()
      : variantKey === DEFAULT_ESTIMATE_VARIANT_KEY
        ? "Base"
        : variantKey.replace(/[-_]+/g, " ");

  try {
    return await prisma.standaloneEstimateVariant.create({
      data: {
        estimateId: estimate.id,
        templateKey: SYSTEM1_TEMPLATE_KEY,
        templateVersion: SYSTEM1_TEMPLATE_VERSION,
        variantKey,
        variantLabel: label,
        variantStatus: "draft",
        data: computed.draft,
        subtotal: computed.summary.subtotal,
        totalCost: computed.summary.totalCost,
        createdBy: params.userEmail ?? null,
        updatedBy: params.userEmail ?? null,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const raced = await prisma.standaloneEstimateVariant.findFirst({
        where: {
          estimateId: estimate.id,
          templateKey: SYSTEM1_TEMPLATE_KEY,
          variantKey,
        },
      });
      if (raced) {
        return raced;
      }
    }
    throw error;
  }
}

export async function listStandaloneEstimates(params: {
  search?: string | null;
  includeArchived?: boolean;
  bidStatuses?: StandaloneEstimateBidStatus[];
} = {}): Promise<StandaloneEstimateSummaryRecord[]> {
  const search = params.search?.trim();
  const where: any = {};
  const bidStatuses =
    params.bidStatuses && params.bidStatuses.length > 0
      ? params.bidStatuses
      : params.includeArchived
        ? ALL_STANDALONE_ESTIMATE_STATUSES
        : ACTIVE_STANDALONE_ESTIMATE_STATUSES;
  where.bidStatus = { in: bidStatuses };
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { projectName: { contains: search, mode: "insensitive" } },
      { projectNumber: { contains: search, mode: "insensitive" } },
      { locationLine1: { contains: search, mode: "insensitive" } },
      { locationLine2: { contains: search, mode: "insensitive" } },
    ];
  }

  const estimates = await prisma.standaloneEstimate.findMany({
    where,
    include: {
      variants: {
        where: { variantStatus: { not: "archived" } },
        orderBy: [{ variantKey: "asc" }],
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  return estimates.map(serializeEstimateRecord);
}

async function applyStandaloneSetupDraftFields(params: {
  detail: StandaloneEstimateDetail;
  projectDate?: string | null;
  systemLabel?: string | null;
  estimator?: string | null;
  bidDueDate?: string | null;
  squareFootage?: number | null;
  buildingTypeOptionId?: string | null;
  buildingTypeOther?: string | null;
  jobTypeOptionId?: string | null;
  jobTypeOther?: string | null;
  salesType?: EstimateSalesType | null;
  confidenceLevel?: EstimateConfidenceLevel | null;
  userEmail?: string | null;
}): Promise<StandaloneEstimateDetail> {
  const hasProjectDate = typeof params.projectDate === "string" && params.projectDate.trim() !== "";
  const hasSystemLabel = typeof params.systemLabel === "string" && params.systemLabel.trim() !== "";
  const hasEstimator = typeof params.estimator === "string" && params.estimator.trim() !== "";
  const hasBidDueDate = typeof params.bidDueDate === "string" && params.bidDueDate.trim() !== "";
  const hasSquareFootage =
    typeof params.squareFootage === "number" && Number.isFinite(params.squareFootage);
  const hasBuildingTypeOptionId =
    typeof params.buildingTypeOptionId === "string" && params.buildingTypeOptionId.trim() !== "";
  const hasBuildingTypeOther =
    typeof params.buildingTypeOther === "string" && params.buildingTypeOther.trim() !== "";
  const hasJobTypeOptionId =
    typeof params.jobTypeOptionId === "string" && params.jobTypeOptionId.trim() !== "";
  const hasJobTypeOther =
    typeof params.jobTypeOther === "string" && params.jobTypeOther.trim() !== "";
  const hasSalesType = params.salesType === "COMPETITIVE" || params.salesType === "NEGOTIATED";
  const hasConfidenceLevel =
    params.confidenceLevel === 1 ||
    params.confidenceLevel === 2 ||
    params.confidenceLevel === 3 ||
    params.confidenceLevel === 4 ||
    params.confidenceLevel === 5;

  if (
    !hasProjectDate &&
    !hasSystemLabel &&
    !hasEstimator &&
    !hasBidDueDate &&
    !hasSquareFootage &&
    !hasBuildingTypeOptionId &&
    !hasBuildingTypeOther &&
    !hasJobTypeOptionId &&
    !hasJobTypeOther &&
    !hasSalesType &&
    !hasConfidenceLevel
  ) {
    return params.detail;
  }

  const currentProject = params.detail.variant.data.project;

  return saveStandaloneEstimate({
    estimateId: params.detail.estimate.id,
    variantKey: params.detail.variant.variantKey,
    title: params.detail.estimate.title,
    projectName: params.detail.estimate.projectName,
    projectNumber: params.detail.estimate.projectNumber,
    locationLine1: params.detail.estimate.locationLine1,
    locationLine2: params.detail.estimate.locationLine2,
    userEmail: params.userEmail ?? null,
    draft: {
      ...params.detail.variant.data,
      project: {
        ...currentProject,
        date: hasProjectDate
          ? params.projectDate!.trim()
          : currentProject.date,
        systemLabel: hasSystemLabel
          ? params.systemLabel!.trim()
          : currentProject.systemLabel,
        estimator: hasEstimator ? params.estimator!.trim() : currentProject.estimator,
        bidDueDate: hasBidDueDate
          ? params.bidDueDate!.trim()
          : currentProject.bidDueDate,
        squareFootage: hasSquareFootage
          ? Math.max(0, params.squareFootage!)
          : currentProject.squareFootage,
        buildingTypeOptionId: hasBuildingTypeOptionId
          ? params.buildingTypeOptionId!.trim()
          : hasBuildingTypeOther
            ? null
            : currentProject.buildingTypeOptionId,
        buildingTypeOther: hasBuildingTypeOther
          ? params.buildingTypeOther!.trim()
          : hasBuildingTypeOptionId
            ? null
            : currentProject.buildingTypeOther,
        jobTypeOptionId: hasJobTypeOptionId
          ? params.jobTypeOptionId!.trim()
          : hasJobTypeOther
            ? null
            : currentProject.jobTypeOptionId,
        jobTypeOther: hasJobTypeOther
          ? params.jobTypeOther!.trim()
          : hasJobTypeOptionId
            ? null
            : currentProject.jobTypeOther,
        salesType: hasSalesType ? params.salesType! : currentProject.salesType,
        confidenceLevel: hasConfidenceLevel
          ? params.confidenceLevel!
          : currentProject.confidenceLevel,
      },
    },
  });
}

export async function createStandaloneEstimate(params: {
  title: string;
  projectName?: string | null;
  projectNumber?: string | null;
  locationLine1?: string | null;
  locationLine2?: string | null;
  projectDate?: string | null;
  systemLabel?: string | null;
  estimator?: string | null;
  bidDueDate?: string | null;
  squareFootage?: number | null;
  buildingTypeOptionId?: string | null;
  buildingTypeOther?: string | null;
  jobTypeOptionId?: string | null;
  jobTypeOther?: string | null;
  salesType?: EstimateSalesType | null;
  confidenceLevel?: EstimateConfidenceLevel | null;
  copyFromEstimateId?: string | null;
  userEmail?: string | null;
}): Promise<StandaloneEstimateDetail> {
  const actorEmail = params.userEmail?.trim() || "system@local";
  const title = params.title.trim() || "Untitled Estimate";

  if (params.copyFromEstimateId) {
    const source = await findEstimateOrThrow(params.copyFromEstimateId);
    const created = await prisma.standaloneEstimate.create({
      data: {
        title,
        projectName: params.projectName ?? source.projectName,
        projectNumber: params.projectNumber ?? source.projectNumber,
        locationLine1: params.locationLine1 ?? source.locationLine1,
        locationLine2: params.locationLine2 ?? source.locationLine2,
        bidStatus: "DRAFT",
        archived: false,
        createdBy: actorEmail,
        updatedBy: actorEmail,
      },
      include: { variants: true },
    });

    const sourceVariants = await prisma.standaloneEstimateVariant.findMany({
      where: {
        estimateId: source.id,
        variantStatus: { not: "archived" },
      },
      orderBy: [{ variantKey: "asc" }],
    });

    for (const sourceVariant of sourceVariants) {
      const draft = synchronizeDraftWithEstimate(
        sourceVariant.data as EstimateDraft,
        created,
      );
      const computed = await computeWithPricing(draft);
      await prisma.standaloneEstimateVariant.create({
        data: {
          estimateId: created.id,
          templateKey: sourceVariant.templateKey,
          templateVersion: sourceVariant.templateVersion,
          variantKey: sourceVariant.variantKey,
          variantLabel: sourceVariant.variantLabel,
          variantStatus: normalizeVariantStatus(sourceVariant.variantStatus),
          data: computed.draft,
          subtotal: computed.summary.subtotal,
          totalCost: computed.summary.totalCost,
          createdBy: actorEmail,
          updatedBy: actorEmail,
        },
      });
    }

    const copied = await getStandaloneEstimate({
      estimateId: created.id,
      variantKey: DEFAULT_ESTIMATE_VARIANT_KEY,
      userEmail: actorEmail,
    });
    return applyStandaloneSetupDraftFields({
      detail: copied,
      projectDate: params.projectDate ?? null,
      systemLabel: params.systemLabel ?? null,
      estimator: params.estimator ?? null,
      bidDueDate: params.bidDueDate ?? null,
      squareFootage: params.squareFootage ?? null,
      buildingTypeOptionId: params.buildingTypeOptionId ?? null,
      buildingTypeOther: params.buildingTypeOther ?? null,
      jobTypeOptionId: params.jobTypeOptionId ?? null,
      jobTypeOther: params.jobTypeOther ?? null,
      salesType: params.salesType ?? null,
      confidenceLevel: params.confidenceLevel ?? null,
      userEmail: actorEmail,
    });
  }

  const created = await prisma.standaloneEstimate.create({
    data: {
      title,
      projectName: params.projectName?.trim() || title,
      projectNumber: params.projectNumber?.trim() || null,
      locationLine1: params.locationLine1?.trim() || null,
      locationLine2: params.locationLine2?.trim() || null,
      bidStatus: "DRAFT",
      archived: false,
      createdBy: actorEmail,
      updatedBy: actorEmail,
    },
    include: { variants: true },
  });

  await ensureVariantRecord({
    estimateId: created.id,
    variantKey: DEFAULT_ESTIMATE_VARIANT_KEY,
    userEmail: actorEmail,
  });

  const detail = await getStandaloneEstimate({
    estimateId: created.id,
    variantKey: DEFAULT_ESTIMATE_VARIANT_KEY,
    userEmail: actorEmail,
  });
  return applyStandaloneSetupDraftFields({
    detail,
    projectDate: params.projectDate ?? null,
    systemLabel: params.systemLabel ?? null,
    estimator: params.estimator ?? null,
    bidDueDate: params.bidDueDate ?? null,
    squareFootage: params.squareFootage ?? null,
    buildingTypeOptionId: params.buildingTypeOptionId ?? null,
    buildingTypeOther: params.buildingTypeOther ?? null,
    jobTypeOptionId: params.jobTypeOptionId ?? null,
    jobTypeOther: params.jobTypeOther ?? null,
    salesType: params.salesType ?? null,
    confidenceLevel: params.confidenceLevel ?? null,
    userEmail: actorEmail,
  });
}

export async function getStandaloneEstimate(params: {
  estimateId: string;
  variantKey?: string | null;
  variantLabel?: string | null;
  copyFromVariantKey?: string | null;
  userEmail?: string | null;
}): Promise<StandaloneEstimateDetail> {
  return withDbRetry(async () => {
    const variant = await ensureVariantRecord(params);
    const estimate = await findEstimateOrThrow(params.estimateId);
    const synchronizedDraft = synchronizeDraftWithEstimate(
      variant.data as EstimateDraft,
      estimate,
    );
    const computed = await computeWithPricing(synchronizedDraft);

    if (JSON.stringify(computed.draft) !== JSON.stringify(variant.data)) {
      await prisma.standaloneEstimateVariant.update({
        where: { id: variant.id },
        data: {
          data: computed.draft,
          subtotal: computed.summary.subtotal,
          totalCost: computed.summary.totalCost,
          updatedBy: params.userEmail ?? variant.updatedBy ?? variant.createdBy,
        },
      });
    }

    const [freshEstimate, freshVariant] = await Promise.all([
      findEstimateOrThrow(params.estimateId),
      prisma.standaloneEstimateVariant.findUniqueOrThrow({
        where: { id: variant.id },
      }),
    ]);

    return {
      estimate: serializeEstimateRecord(freshEstimate),
      variant: serializeVariantRecord(freshVariant),
      computed,
    };
  });
}

export async function saveStandaloneEstimate(params: {
  estimateId: string;
  variantKey?: string | null;
  draft: EstimateDraft;
  title?: string | null;
  projectName?: string | null;
  projectNumber?: string | null;
  locationLine1?: string | null;
  locationLine2?: string | null;
  userEmail?: string | null;
}): Promise<StandaloneEstimateDetail> {
  const estimate = await findEstimateOrThrow(params.estimateId);
  const variant = await ensureVariantRecord({
    estimateId: params.estimateId,
    variantKey: params.variantKey ?? null,
    userEmail: params.userEmail ?? null,
  });

  const projectName =
    typeof params.projectName === "string"
      ? params.projectName.trim() || null
      : params.draft.project.projectName?.trim() || estimate.projectName;

  const title =
    typeof params.title === "string" && params.title.trim().length > 0
      ? params.title.trim()
      : projectName || estimate.title;

  const updatedEstimate = await prisma.standaloneEstimate.update({
    where: { id: params.estimateId },
    data: {
      title,
      projectName,
      projectNumber:
        typeof params.projectNumber === "string"
          ? params.projectNumber.trim() || null
          : estimate.projectNumber,
      locationLine1:
        typeof params.locationLine1 === "string"
          ? params.locationLine1.trim() || null
          : estimate.locationLine1,
      locationLine2:
        typeof params.locationLine2 === "string"
          ? params.locationLine2.trim() || null
          : estimate.locationLine2,
      updatedBy: params.userEmail ?? null,
    },
  });

  const synchronizedDraft = synchronizeDraftWithEstimate(params.draft, updatedEstimate);
  const computed = await computeWithPricing(synchronizedDraft);

  await prisma.standaloneEstimateVariant.update({
    where: { id: variant.id },
    data: {
      data: computed.draft,
      subtotal: computed.summary.subtotal,
      totalCost: computed.summary.totalCost,
      updatedBy: params.userEmail ?? null,
    },
  });

  return getStandaloneEstimate({
    estimateId: params.estimateId,
    variantKey: variant.variantKey,
    userEmail: params.userEmail ?? null,
  });
}

export async function saveStandaloneEstimateInfo(params: {
  estimateId: string;
  variantKey?: string | null;
  project: EstimateDraft["project"];
  title?: string | null;
  projectName?: string | null;
  projectNumber?: string | null;
  locationLine1?: string | null;
  locationLine2?: string | null;
  userEmail?: string | null;
}): Promise<StandaloneEstimateDetail> {
  const estimate = await findEstimateOrThrow(params.estimateId);
  const variant = await ensureVariantRecord({
    estimateId: params.estimateId,
    variantKey: params.variantKey ?? null,
    userEmail: params.userEmail ?? null,
  });

  const existingDraft = variant.data as EstimateDraft;
  const mergedProject = normalizeEstimateProjectSection({
    ...existingDraft.project,
    ...params.project,
  });

  const projectName =
    typeof params.projectName === "string"
      ? params.projectName.trim() || null
      : mergedProject.projectName?.trim() || estimate.projectName;

  const title =
    typeof params.title === "string" && params.title.trim().length > 0
      ? params.title.trim()
      : projectName || estimate.title;

  const updatedEstimate = await prisma.standaloneEstimate.update({
    where: { id: params.estimateId },
    data: {
      title,
      projectName,
      projectNumber:
        typeof params.projectNumber === "string"
          ? params.projectNumber.trim() || null
          : estimate.projectNumber,
      locationLine1:
        typeof params.locationLine1 === "string"
          ? params.locationLine1.trim() || null
          : estimate.locationLine1,
      locationLine2:
        typeof params.locationLine2 === "string"
          ? params.locationLine2.trim() || null
          : estimate.locationLine2,
      updatedBy: params.userEmail ?? null,
    },
  });

  const draftWithProject: EstimateDraft = {
    ...existingDraft,
    project: {
      ...mergedProject,
      projectName:
        mergedProject.projectName ||
        updatedEstimate.projectName ||
        updatedEstimate.title,
      systemLabel:
        mergedProject.systemLabel ||
        updatedEstimate.projectNumber ||
        STANDALONE_LIST_LABEL,
      projectLocationLine1:
        mergedProject.projectLocationLine1 || updatedEstimate.locationLine1 || "",
      projectLocationLine2:
        mergedProject.projectLocationLine2 || updatedEstimate.locationLine2 || "",
    },
  };

  const synchronizedDraft = synchronizeDraftWithEstimate(
    draftWithProject,
    updatedEstimate,
  );
  const computed = await computeWithPricing(synchronizedDraft);

  await prisma.standaloneEstimateVariant.update({
    where: { id: variant.id },
    data: {
      data: computed.draft,
      subtotal: computed.summary.subtotal,
      totalCost: computed.summary.totalCost,
      updatedBy: params.userEmail ?? null,
    },
  });

  return getStandaloneEstimate({
    estimateId: params.estimateId,
    variantKey: variant.variantKey,
    userEmail: params.userEmail ?? null,
  });
}

export async function updateStandaloneEstimateMetadata(params: {
  estimateId: string;
  title?: string | null;
  projectName?: string | null;
  projectNumber?: string | null;
  locationLine1?: string | null;
  locationLine2?: string | null;
  contractPrice?: number | null;
  userEmail?: string | null;
}): Promise<StandaloneEstimateRecord> {
  const existing = await findEstimateOrThrow(params.estimateId);
  const contractPrice =
    typeof params.contractPrice === "number" && Number.isFinite(params.contractPrice)
      ? Math.max(0, params.contractPrice)
      : params.contractPrice === null
        ? null
        : undefined;

  const projectName =
    typeof params.projectName === "string"
      ? params.projectName.trim() || null
      : existing.projectName;

  const title =
    typeof params.title === "string" && params.title.trim().length > 0
      ? params.title.trim()
      : projectName || existing.title;

  const updated = await prisma.standaloneEstimate.update({
    where: { id: existing.id },
    data: {
      title,
      projectName,
      projectNumber:
        typeof params.projectNumber === "string"
          ? params.projectNumber.trim() || null
          : existing.projectNumber,
      locationLine1:
        typeof params.locationLine1 === "string"
          ? params.locationLine1.trim() || null
          : existing.locationLine1,
      locationLine2:
        typeof params.locationLine2 === "string"
          ? params.locationLine2.trim() || null
          : existing.locationLine2,
      ...(contractPrice !== undefined ? { contractPrice } : {}),
      updatedBy: params.userEmail ?? null,
    },
    include: {
      variants: {
        where: { variantStatus: { not: "archived" } },
        orderBy: [{ variantKey: "asc" }],
      },
    },
  });
  return serializeEstimateRecord(updated);
}

export async function updateStandaloneEstimateBidStatus(params: {
  estimateId: string;
  bidStatus: StandaloneEstimateBidStatus;
  contractPrice?: number | null;
  userEmail?: string | null;
}): Promise<StandaloneEstimateRecord> {
  const existing = await findEstimateOrThrow(params.estimateId);
  const currentStatus = normalizeStandaloneEstimateBidStatus(
    existing.bidStatus,
    existing.archived,
  );
  const bidStatus = normalizeStandaloneEstimateBidStatus(params.bidStatus, false);

  if (bidStatus === "SENT" && currentStatus !== "SENT") {
    const draft = await getPrimaryVariantDraft(params.estimateId);
    const validation = validateMetadataForSent(draft);
    if (!validation.ok) {
      throw new EstimateMetadataValidationError(
        `Complete estimate info before marking as Sent: ${validation.missingFields.join(", ")}`,
        validation.missingFields,
      );
    }
  }

  let contractPrice: number | null | undefined;
  if (bidStatus === "WON") {
    if (
      typeof params.contractPrice !== "number" ||
      !Number.isFinite(params.contractPrice) ||
      params.contractPrice <= 0
    ) {
      throw new EstimateContractPriceRequiredError();
    }
    contractPrice = Math.max(0, params.contractPrice);
  }

  const updated = await prisma.standaloneEstimate.update({
    where: { id: params.estimateId },
    data: {
      bidStatus,
      archived: isPastStandaloneEstimateStatus(bidStatus),
      ...(contractPrice !== undefined ? { contractPrice } : {}),
      updatedBy: params.userEmail ?? null,
    },
    include: {
      variants: {
        where: { variantStatus: { not: "archived" } },
        orderBy: [{ variantKey: "asc" }],
      },
    },
  });
  return serializeEstimateRecord(updated);
}

export async function restoreStandaloneEstimate(params: {
  estimateId: string;
  userEmail?: string | null;
}): Promise<StandaloneEstimateRecord> {
  return updateStandaloneEstimateBidStatus({
    estimateId: params.estimateId,
    bidStatus: "DRAFT",
    userEmail: params.userEmail ?? null,
  });
}

export async function archiveStandaloneEstimate(params: {
  estimateId: string;
  userEmail?: string | null;
}): Promise<{ estimateId: string; archived: boolean }> {
  await prisma.standaloneEstimate.update({
    where: { id: params.estimateId },
    data: {
      bidStatus: "ARCHIVED",
      archived: true,
      updatedBy: params.userEmail ?? null,
    },
  });
  return { estimateId: params.estimateId, archived: true };
}

export async function deleteStandaloneEstimate(params: {
  estimateId: string;
}): Promise<{ estimateId: string; deleted: boolean }> {
  const existing = await prisma.standaloneEstimate.findUnique({
    where: { id: params.estimateId },
    select: { id: true },
  });
  if (!existing) {
    throw new Error("Estimate not found");
  }

  await prisma.standaloneEstimate.delete({
    where: { id: params.estimateId },
  });

  return { estimateId: params.estimateId, deleted: true };
}

export async function recalculateStandaloneEstimateDraft(
  draft: EstimateDraft,
): Promise<EstimateComputed> {
  return computeWithPricing(draft);
}

export async function listStandaloneEstimateVariants(params: {
  estimateId: string;
}): Promise<EstimateVariantSummary[]> {
  const records = await prisma.standaloneEstimateVariant.findMany({
    where: {
      estimateId: params.estimateId,
      templateKey: SYSTEM1_TEMPLATE_KEY,
    },
    orderBy: [{ variantKey: "asc" }],
  });
  return records.map((record) => ({
    variantKey: record.variantKey ?? DEFAULT_ESTIMATE_VARIANT_KEY,
    variantLabel: record.variantLabel ?? null,
    variantStatus: normalizeVariantStatus(record.variantStatus ?? null),
    subtotal: toNullableNumber(record.subtotal),
    totalCost: toNullableNumber(record.totalCost),
    updatedAt: record.updatedAt.toISOString(),
  }));
}

export async function createStandaloneEstimateVariant(params: {
  estimateId: string;
  variantKey: string;
  variantLabel?: string | null;
  copyFromVariantKey?: string | null;
  userEmail?: string | null;
}): Promise<StandaloneEstimateDetail> {
  const variant = await ensureVariantRecord(params);
  return getStandaloneEstimate({
    estimateId: params.estimateId,
    variantKey: variant.variantKey,
    userEmail: params.userEmail ?? null,
  });
}

export async function updateStandaloneEstimateVariant(params: {
  estimateId: string;
  variantKey: string;
  label?: string | null;
  status?: EstimateVariantStatus | null;
}): Promise<StandaloneEstimateVariantRecord> {
  const variantKey = normalizeVariantKey(params.variantKey);
  const existing = await prisma.standaloneEstimateVariant.findFirst({
    where: {
      estimateId: params.estimateId,
      templateKey: SYSTEM1_TEMPLATE_KEY,
      variantKey,
    },
  });
  if (!existing) {
    throw new Error(`Variant "${variantKey}" does not exist for this estimate`);
  }

  const updated = await prisma.standaloneEstimateVariant.update({
    where: { id: existing.id },
    data: {
      variantLabel:
        typeof params.label === "string"
          ? params.label.trim() || null
          : existing.variantLabel,
      variantStatus: params.status
        ? normalizeVariantStatus(params.status)
        : normalizeVariantStatus(existing.variantStatus ?? null),
    },
  });

  return serializeVariantRecord(updated);
}

export async function deleteStandaloneEstimateVariant(params: {
  estimateId: string;
  variantKey: string;
}): Promise<{ variantKey: string; deleted: boolean }> {
  const variantKey = normalizeVariantKey(params.variantKey);
  const variants = await prisma.standaloneEstimateVariant.findMany({
    where: {
      estimateId: params.estimateId,
      templateKey: SYSTEM1_TEMPLATE_KEY,
      variantStatus: { not: "archived" },
    },
    orderBy: [{ variantKey: "asc" }],
  });
  if (variants.length <= 1) {
    throw new Error("An estimate must keep at least one sheet");
  }
  const existing = variants.find((variant) => variant.variantKey === variantKey);
  if (!existing) {
    throw new Error(`Variant "${variantKey}" does not exist for this estimate`);
  }
  await prisma.standaloneEstimateVariant.delete({
    where: { id: existing.id },
  });
  return { variantKey, deleted: true };
}
