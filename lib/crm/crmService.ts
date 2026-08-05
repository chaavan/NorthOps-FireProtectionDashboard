import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  CRM_OPPORTUNITY_STAGES,
  type CrmAccountDetail,
  type CrmAccountRollup,
  type CrmContactRecord,
  type CrmDashboardPayload,
  type CrmOpportunityRecord,
  type CrmOpportunityStage,
  type CrmPipelineStageSummary,
  type CrmRenewalCalendarItem,
  type CrmRepPerformance,
  type CrmTagRecord,
  crmStageLabel,
  opportunityStageFromEstimateBidStatus,
} from "@/lib/crm/crmTypes";
import { listTagsForEntity } from "@/lib/crm/crmTagService";
import { logCrmActivity } from "@/lib/crm/crmActivityLog";

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function daysUntil(date: Date): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function renewalUrgency(days: number): "critical" | "warning" | "normal" {
  if (days <= 30) return "critical";
  if (days <= 90) return "warning";
  return "normal";
}

// The Renewal Calendar tab looks further ahead than an account rollup's
// "upcoming renewals" count, which is scoped to the actionable/urgent window
// (matching renewalUrgency's "warning" threshold). Named here so the two
// windows read as an intentional choice, not a data inconsistency.
const RENEWAL_CALENDAR_WINDOW_DAYS = 180;
const RENEWAL_ROLLUP_WINDOW_DAYS = 90;

// syncCrmOpportunitiesFromEstimate only ever derives QUOTED/SENT/WON/LOST from
// the estimate's bid status. Once a rep has manually scheduled or finalized an
// opportunity, a later unrelated estimate edit must not silently regress it.
const STAGES_LOCKED_FROM_AUTO_SYNC = new Set<CrmOpportunityStage>(["SCHEDULED", "WON", "LOST"]);

export async function getCrmDashboard(filters?: {
  salesRepEmail?: string | null;
}): Promise<CrmDashboardPayload> {
  const repFilter = filters?.salesRepEmail?.trim() || undefined;

  const opportunityWhere: Prisma.CrmOpportunityWhereInput = repFilter
    ? { salesRepEmail: repFilter }
    : {};

  const [opportunities, renewals, deficiencies, accounts] = await Promise.all([
    prisma.crmOpportunity.findMany({
      where: opportunityWhere,
      include: {
        estimate: {
          include: {
            variants: {
              orderBy: { updatedAt: "desc" },
              take: 1,
            },
          },
        },
      },
    }),
    prisma.crmRenewal.findMany({
      where: {
        ...(repFilter ? { salesRepEmail: repFilter } : {}),
        status: { in: ["ACTIVE", "PENDING_RENEWAL"] },
        renewalDate: {
          lte: new Date(Date.now() + RENEWAL_CALENDAR_WINDOW_DAYS * 24 * 60 * 60 * 1000),
        },
      },
      include: {
        account: true,
        location: true,
      },
      orderBy: { renewalDate: "asc" },
      take: 100,
    }),
    prisma.crmDeficiency.findMany({
      where: {
        ...(repFilter ? { salesRepEmail: repFilter } : {}),
        status: { in: ["OPEN", "QUOTED"] },
      },
      select: {
        id: true,
        status: true,
        estimatedValue: true,
        salesRepEmail: true,
      },
    }),
    prisma.crmAccount.findMany({
      where: repFilter ? { salesRepEmail: repFilter } : undefined,
      include: {
        locations: true,
        deficiencies: {
          where: { status: { in: ["OPEN", "QUOTED"] } },
          select: { id: true, locationId: true },
        },
        opportunities: {
          where: { stage: { notIn: ["WON", "LOST", "SCHEDULED"] } },
          select: { id: true },
        },
        renewals: {
          where: {
            status: { in: ["ACTIVE", "PENDING_RENEWAL"] },
            renewalDate: { lte: new Date(Date.now() + RENEWAL_ROLLUP_WINDOW_DAYS * 24 * 60 * 60 * 1000) },
          },
          select: { id: true, locationId: true },
        },
      },
      orderBy: { name: "asc" },
      take: 50,
    }),
  ]);

  const pipeline: CrmPipelineStageSummary[] = CRM_OPPORTUNITY_STAGES.map((stage) => {
    const stageOpps = opportunities.filter((opp) => opp.stage === stage);
    const value = stageOpps.reduce((sum, opp) => {
      const estimateTotal = decimalToNumber(opp.estimate?.variants[0]?.totalCost);
      return sum + (decimalToNumber(opp.value) ?? estimateTotal ?? 0);
    }, 0);
    return {
      stage,
      label: crmStageLabel(stage),
      count: stageOpps.length,
      value,
    };
  });

  const renewalItems: CrmRenewalCalendarItem[] = renewals.map((renewal) => {
    const days = daysUntil(renewal.renewalDate);
    return {
      id: renewal.id,
      accountId: renewal.accountId,
      accountName: renewal.account.name,
      locationName: renewal.location?.name ?? null,
      contractName: renewal.contractName,
      renewalDate: renewal.renewalDate.toISOString(),
      daysUntilRenewal: days,
      annualValue: decimalToNumber(renewal.annualValue),
      status: renewal.status,
      salesRepEmail: renewal.salesRepEmail,
      urgency: renewalUrgency(days),
    };
  });

  const repEmails = new Set<string>();
  for (const opp of opportunities) {
    if (opp.salesRepEmail) repEmails.add(opp.salesRepEmail);
  }
  for (const def of deficiencies) {
    if (def.salesRepEmail) repEmails.add(def.salesRepEmail);
  }

  const repPerformance: CrmRepPerformance[] = Array.from(repEmails).map((salesRepEmail) => {
    const repOpps = opportunities.filter((opp) => opp.salesRepEmail === salesRepEmail);
    const repDefs = deficiencies.filter((def) => def.salesRepEmail === salesRepEmail);
    // Use wonAt/lostAt rather than the current `stage` — stage keeps moving
    // after a win (e.g. WON -> SCHEDULED once ops picks it up), but a closed
    // deal must stay counted as closed and out of open pipeline value.
    const won = repOpps.filter((opp) => opp.wonAt !== null).length;
    const lost = repOpps.filter((opp) => opp.lostAt !== null).length;
    const closed = won + lost;
    const pipelineValue = repOpps
      .filter((opp) => opp.wonAt === null && opp.lostAt === null)
      .reduce((sum, opp) => sum + (decimalToNumber(opp.value) ?? 0), 0);

    return {
      salesRepEmail,
      openDeficiencies: repDefs.filter((def) => def.status === "OPEN").length,
      quotedNotSent: repOpps.filter((opp) => opp.stage === "QUOTED").length,
      sentOpen: repOpps.filter((opp) => opp.stage === "SENT").length,
      wonCount: won,
      lostCount: lost,
      winRate: closed > 0 ? Math.round((won / closed) * 100) : null,
      pipelineValue,
    };
  });

  const accountRollups: CrmAccountRollup[] = accounts.map((account) => ({
    id: account.id,
    name: account.name,
    accountType: account.accountType,
    salesRepEmail: account.salesRepEmail,
    locationCount: account.locations.length,
    openDeficiencies: account.deficiencies.length,
    activeOpportunities: account.opportunities.length,
    upcomingRenewals: account.renewals.length,
    locations: account.locations.map((location) => ({
      id: location.id,
      name: location.name,
      city: location.city,
      state: location.state,
      openDeficiencies: account.deficiencies.filter((def) => def.locationId === location.id).length,
      upcomingRenewals: account.renewals.filter((renewal) => renewal.locationId === location.id).length,
    })),
  }));

  return {
    pipeline,
    renewals: renewalItems,
    repPerformance: repPerformance.sort((a, b) => b.pipelineValue - a.pipelineValue),
    accountRollups,
  };
}

export async function listCrmOpportunities(filters?: {
  salesRepEmail?: string | null;
  stage?: string | null;
}): Promise<CrmOpportunityRecord[]> {
  const rows = await prisma.crmOpportunity.findMany({
    where: {
      ...(filters?.salesRepEmail ? { salesRepEmail: filters.salesRepEmail } : {}),
      ...(filters?.stage ? { stage: filters.stage } : {}),
    },
    include: {
      account: true,
      location: true,
      deficiency: true,
      estimate: {
        include: {
          variants: { orderBy: { updatedAt: "desc" }, take: 1 },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    stage: row.stage as CrmOpportunityStage,
    opportunityType: row.opportunityType as CrmOpportunityRecord["opportunityType"],
    value: decimalToNumber(row.value),
    salesRepEmail: row.salesRepEmail,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    account: { id: row.account.id, name: row.account.name },
    location: row.location ? { id: row.location.id, name: row.location.name } : null,
    deficiency: row.deficiency
      ? { id: row.deficiency.id, title: row.deficiency.title, status: row.deficiency.status }
      : null,
    estimate: row.estimate
      ? {
          id: row.estimate.id,
          title: row.estimate.title,
          bidStatus: row.estimate.bidStatus,
          totalCost: decimalToNumber(row.estimate.variants[0]?.totalCost),
        }
      : null,
  }));
}

export async function createCrmAccount(input: {
  name: string;
  accountType?: string;
  salesRepEmail?: string | null;
  notes?: string | null;
  locationName: string;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  createdBy?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const account = await tx.crmAccount.create({
      data: {
        name: input.name.trim(),
        accountType: input.accountType?.trim() || "direct",
        salesRepEmail: input.salesRepEmail?.trim() || null,
        notes: input.notes?.trim() || null,
        createdBy: input.createdBy ?? null,
        updatedBy: input.createdBy ?? null,
      },
    });

    const location = await tx.crmAccountLocation.create({
      data: {
        accountId: account.id,
        name: input.locationName.trim(),
        addressLine1: input.addressLine1?.trim() || null,
        city: input.city?.trim() || null,
        state: input.state?.trim() || null,
        postalCode: input.postalCode?.trim() || null,
        isPrimary: true,
      },
    });

    return { account, location };
  });
}

export async function createCrmInspectionWithDeficiencies(input: {
  accountId: string;
  locationId?: string | null;
  inspectionType?: string;
  inspectedAt?: string | null;
  inspectorName?: string | null;
  salesRepEmail?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  deficiencies: Array<{
    title: string;
    description?: string | null;
    severity?: string;
    estimatedValue?: number | null;
  }>;
}) {
  return prisma.$transaction(async (tx) => {
    const inspection = await tx.crmInspection.create({
      data: {
        accountId: input.accountId,
        locationId: input.locationId || null,
        inspectionType: input.inspectionType || "ANNUAL",
        status: "COMPLETED",
        inspectedAt: input.inspectedAt ? new Date(input.inspectedAt) : new Date(),
        inspectorName: input.inspectorName?.trim() || null,
        notes: input.notes?.trim() || null,
        createdBy: input.createdBy ?? null,
      },
    });

    const created: Array<{ deficiency: any; opportunity: any }> = [];

    for (const item of input.deficiencies) {
      const deficiency = await tx.crmDeficiency.create({
        data: {
          inspectionId: inspection.id,
          accountId: input.accountId,
          locationId: input.locationId || null,
          title: item.title.trim(),
          description: item.description?.trim() || null,
          severity: item.severity || "MAJOR",
          status: "OPEN",
          estimatedValue: item.estimatedValue ?? null,
          salesRepEmail: input.salesRepEmail?.trim() || null,
          createdBy: input.createdBy ?? null,
        },
      });

      const opportunity = await tx.crmOpportunity.create({
        data: {
          accountId: input.accountId,
          locationId: input.locationId || null,
          deficiencyId: deficiency.id,
          title: item.title.trim(),
          opportunityType: "SERVICE_DEFICIENCY",
          stage: "DEFICIENCY_IDENTIFIED",
          value: item.estimatedValue ?? null,
          salesRepEmail: input.salesRepEmail?.trim() || null,
          createdBy: input.createdBy ?? null,
          updatedBy: input.createdBy ?? null,
        },
      });

      created.push({ deficiency, opportunity });
    }

    return { inspection, created };
  });
}

export async function linkDeficienciesToEstimate(input: {
  estimateId: string;
  deficiencyIds: string[];
  updatedBy?: string | null;
}) {
  if (input.deficiencyIds.length === 0) {
    throw new Error("At least one deficiency is required");
  }

  const estimate = await prisma.standaloneEstimate.findUnique({
    where: { id: input.estimateId },
    include: {
      variants: { orderBy: { updatedAt: "desc" }, take: 1 },
    },
  });
  if (!estimate) throw new Error("Estimate not found");

  const deficiencies = await prisma.crmDeficiency.findMany({
    where: { id: { in: input.deficiencyIds } },
  });
  if (deficiencies.length !== input.deficiencyIds.length) {
    throw new Error("One or more deficiencies were not found");
  }

  const totalCost = decimalToNumber(estimate.variants[0]?.totalCost);
  const stage =
    opportunityStageFromEstimateBidStatus(estimate.bidStatus) ?? ("QUOTED" as CrmOpportunityStage);

  return prisma.$transaction(async (tx) => {
    for (const deficiencyId of input.deficiencyIds) {
      await tx.crmEstimateDeficiency.upsert({
        where: {
          estimateId_deficiencyId: {
            estimateId: input.estimateId,
            deficiencyId,
          },
        },
        create: {
          estimateId: input.estimateId,
          deficiencyId,
        },
        update: {},
      });

      await tx.crmDeficiency.update({
        where: { id: deficiencyId },
        data: { status: "QUOTED" },
      });
    }

    const updatedOpportunities = [];
    for (const deficiency of deficiencies) {
      const existing = await tx.crmOpportunity.findFirst({
        where: { deficiencyId: deficiency.id },
        orderBy: { createdAt: "desc" },
      });

      if (existing) {
        const updated = await tx.crmOpportunity.update({
          where: { id: existing.id },
          data: {
            estimateId: input.estimateId,
            stage,
            value: totalCost ?? decimalToNumber(existing.value),
            updatedBy: input.updatedBy ?? null,
            ...(stage === "WON" && !existing.wonAt ? { wonAt: new Date() } : {}),
            ...(stage === "LOST" && !existing.lostAt ? { lostAt: new Date() } : {}),
          },
        });
        updatedOpportunities.push(updated);
      } else {
        const created = await tx.crmOpportunity.create({
          data: {
            accountId: deficiency.accountId,
            locationId: deficiency.locationId,
            deficiencyId: deficiency.id,
            estimateId: input.estimateId,
            title: deficiency.title,
            opportunityType: "SERVICE_DEFICIENCY",
            stage,
            value: totalCost ?? decimalToNumber(deficiency.estimatedValue),
            salesRepEmail: deficiency.salesRepEmail,
            createdBy: input.updatedBy ?? null,
            updatedBy: input.updatedBy ?? null,
            ...(stage === "WON" ? { wonAt: new Date() } : {}),
            ...(stage === "LOST" ? { lostAt: new Date() } : {}),
          },
        });
        updatedOpportunities.push(created);
      }
    }

    return {
      estimateId: input.estimateId,
      opportunities: updatedOpportunities,
    };
  });
}

export async function updateCrmOpportunityStage(input: {
  opportunityId: string;
  stage: CrmOpportunityStage;
  scheduledAt?: string | null;
  lostReason?: string | null;
  updatedBy?: string | null;
}) {
  const previous = await prisma.crmOpportunity.findUnique({
    where: { id: input.opportunityId },
    select: { stage: true },
  });

  const data: Prisma.CrmOpportunityUpdateInput = {
    stage: input.stage,
    updatedBy: input.updatedBy ?? null,
  };

  if (input.stage === "SCHEDULED" && input.scheduledAt) {
    data.scheduledAt = new Date(input.scheduledAt);
  }
  if (input.stage === "WON") {
    data.wonAt = new Date();
  }
  if (input.stage === "LOST") {
    data.lostAt = new Date();
    data.lostReason = input.lostReason?.trim() || null;
  }

  const opportunity = await prisma.crmOpportunity.update({
    where: { id: input.opportunityId },
    data,
    include: { deficiency: true },
  });

  if (opportunity.deficiencyId && input.stage === "WON") {
    await prisma.crmDeficiency.update({
      where: { id: opportunity.deficiencyId },
      data: { status: "REPAIRED" },
    });
  }
  if (opportunity.deficiencyId && input.stage === "LOST") {
    await prisma.crmDeficiency.update({
      where: { id: opportunity.deficiencyId },
      data: { status: "DECLINED" },
    });
  }

  if (previous && previous.stage !== input.stage) {
    await logCrmActivity({
      entityType: "OPPORTUNITY",
      entityId: opportunity.id,
      accountId: opportunity.accountId,
      activityType: "STAGE_CHANGE",
      subject: `Stage: ${crmStageLabel(previous.stage)} → ${crmStageLabel(input.stage)}`,
      body: input.stage === "LOST" && input.lostReason ? `Reason: ${input.lostReason.trim()}` : null,
      createdBy: input.updatedBy ?? null,
    });
  }

  return opportunity;
}

export async function updateCrmOpportunityFields(
  opportunityId: string,
  input: {
    title?: string;
    value?: number | null;
    salesRepEmail?: string | null;
    updatedBy?: string | null;
  },
) {
  return prisma.crmOpportunity.update({
    where: { id: opportunityId },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.salesRepEmail !== undefined ? { salesRepEmail: input.salesRepEmail?.trim() || null } : {}),
      updatedBy: input.updatedBy ?? null,
    },
  });
}

export async function createCrmOpportunity(input: {
  accountId: string;
  locationId?: string | null;
  title: string;
  opportunityType?: string;
  value?: number | null;
  salesRepEmail?: string | null;
  createdBy?: string | null;
}) {
  const opportunity = await prisma.crmOpportunity.create({
    data: {
      accountId: input.accountId,
      locationId: input.locationId || null,
      title: input.title.trim(),
      opportunityType: input.opportunityType?.trim() || "NEW_BUSINESS_BID",
      stage: "DEFICIENCY_IDENTIFIED",
      value: input.value ?? null,
      salesRepEmail: input.salesRepEmail?.trim() || null,
      createdBy: input.createdBy ?? null,
      updatedBy: input.createdBy ?? null,
    },
  });
  await logCrmActivity({
    entityType: "OPPORTUNITY",
    entityId: opportunity.id,
    accountId: opportunity.accountId,
    activityType: "SYSTEM",
    subject: "Opportunity created",
    createdBy: input.createdBy ?? null,
  });
  return opportunity;
}

export async function syncCrmOpportunitiesFromEstimate(estimateId: string, updatedBy?: string | null) {
  const estimate = await prisma.standaloneEstimate.findUnique({
    where: { id: estimateId },
    include: { variants: { orderBy: { updatedAt: "desc" }, take: 1 } },
  });
  if (!estimate) return [];

  const mappedStage = opportunityStageFromEstimateBidStatus(estimate.bidStatus);
  if (!mappedStage) return [];

  const totalCost = decimalToNumber(estimate.variants[0]?.totalCost);
  const opportunities = await prisma.crmOpportunity.findMany({
    where: { estimateId },
  });

  const updated = [];
  for (const opportunity of opportunities) {
    if (STAGES_LOCKED_FROM_AUTO_SYNC.has(opportunity.stage as CrmOpportunityStage)) {
      continue;
    }

    const row = await prisma.crmOpportunity.update({
      where: { id: opportunity.id },
      data: {
        stage: mappedStage,
        value: totalCost ?? opportunity.value,
        updatedBy: updatedBy ?? null,
        ...(mappedStage === "WON" ? { wonAt: new Date() } : {}),
        ...(mappedStage === "LOST" ? { lostAt: new Date() } : {}),
      },
    });
    updated.push(row);

    if (opportunity.deficiencyId) {
      if (mappedStage === "WON") {
        await prisma.crmDeficiency.update({
          where: { id: opportunity.deficiencyId },
          data: { status: "REPAIRED" },
        });
      } else if (mappedStage === "LOST") {
        await prisma.crmDeficiency.update({
          where: { id: opportunity.deficiencyId },
          data: { status: "DECLINED" },
        });
      } else if (mappedStage === "QUOTED" || mappedStage === "SENT") {
        await prisma.crmDeficiency.update({
          where: { id: opportunity.deficiencyId },
          data: { status: "QUOTED" },
        });
      }
    }
  }

  return updated;
}

export async function createCrmRenewal(input: {
  accountId: string;
  locationId?: string | null;
  contractName: string;
  serviceType?: string;
  renewalDate: string;
  annualValue?: number | null;
  salesRepEmail?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}) {
  const days = daysUntil(new Date(input.renewalDate));
  const status = days < 0 ? "EXPIRED" : days <= 90 ? "PENDING_RENEWAL" : "ACTIVE";

  return prisma.crmRenewal.create({
    data: {
      accountId: input.accountId,
      locationId: input.locationId || null,
      contractName: input.contractName.trim(),
      serviceType: input.serviceType || "INSPECTION_TESTING",
      renewalDate: new Date(input.renewalDate),
      annualValue: input.annualValue ?? null,
      status,
      salesRepEmail: input.salesRepEmail?.trim() || null,
      notes: input.notes?.trim() || null,
      createdBy: input.createdBy ?? null,
    },
  });
}

export async function listCrmAccounts() {
  return prisma.crmAccount.findMany({
    include: {
      locations: true,
      _count: {
        select: {
          contacts: true,
          deficiencies: true,
          opportunities: true,
          renewals: true,
        },
      },
    },
    orderBy: { name: "asc" },
    take: 200,
  });
}

export async function listEstimatesForCrmLink(search?: string | null) {
  return prisma.standaloneEstimate.findMany({
    where: {
      archived: false,
      ...(search?.trim()
        ? {
            OR: [
              { title: { contains: search.trim(), mode: "insensitive" } },
              { projectName: { contains: search.trim(), mode: "insensitive" } },
              { projectNumber: { contains: search.trim(), mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      variants: { orderBy: { updatedAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
}

export async function listCrmAccountsForSelect(search?: string | null) {
  const term = search?.trim();
  return prisma.crmAccount.findMany({
    where: term
      ? {
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { salesRepEmail: { contains: term, mode: "insensitive" } },
          ],
        }
      : undefined,
    select: { id: true, name: true, accountType: true, salesRepEmail: true },
    orderBy: { name: "asc" },
    take: 200,
  });
}

export async function getCrmAccountDetail(accountId: string): Promise<CrmAccountDetail | null> {
  const account = await prisma.crmAccount.findUnique({
    where: { id: accountId },
    include: {
      locations: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      contacts: {
        include: { location: { select: { id: true, name: true } } },
        orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
      },
      opportunities: { orderBy: { updatedAt: "desc" } },
      renewals: { orderBy: { renewalDate: "asc" } },
      deficiencies: { orderBy: { updatedAt: "desc" } },
    },
  });
  if (!account) return null;

  const tags: CrmTagRecord[] = await listTagsForEntity("ACCOUNT", accountId);

  const contacts: CrmContactRecord[] = account.contacts.map((contact) => ({
    id: contact.id,
    accountId: contact.accountId,
    locationId: contact.locationId,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    role: contact.role,
    isPrimary: contact.isPrimary,
    notes: contact.notes,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
    account: { id: account.id, name: account.name },
    location: contact.location ? { id: contact.location.id, name: contact.location.name } : null,
  }));

  return {
    id: account.id,
    name: account.name,
    accountType: account.accountType,
    salesRepEmail: account.salesRepEmail,
    notes: account.notes,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
    locations: account.locations.map((location) => ({
      id: location.id,
      name: location.name,
      addressLine1: location.addressLine1,
      city: location.city,
      state: location.state,
      postalCode: location.postalCode,
      isPrimary: location.isPrimary,
    })),
    contacts,
    opportunities: account.opportunities.map((opp) => ({
      id: opp.id,
      title: opp.title,
      stage: opp.stage as CrmOpportunityStage,
      value: decimalToNumber(opp.value),
      salesRepEmail: opp.salesRepEmail,
    })),
    renewals: account.renewals.map((renewal) => ({
      id: renewal.id,
      contractName: renewal.contractName,
      renewalDate: renewal.renewalDate.toISOString(),
      annualValue: decimalToNumber(renewal.annualValue),
      status: renewal.status,
    })),
    deficiencies: account.deficiencies.map((def) => ({
      id: def.id,
      title: def.title,
      severity: def.severity,
      status: def.status,
      estimatedValue: decimalToNumber(def.estimatedValue),
    })),
    tags,
  };
}

export async function updateCrmAccount(
  accountId: string,
  input: {
    name?: string;
    accountType?: string;
    salesRepEmail?: string | null;
    notes?: string | null;
    updatedBy?: string | null;
  },
) {
  return prisma.crmAccount.update({
    where: { id: accountId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.accountType !== undefined ? { accountType: input.accountType.trim() || "direct" } : {}),
      ...(input.salesRepEmail !== undefined ? { salesRepEmail: input.salesRepEmail?.trim() || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      updatedBy: input.updatedBy ?? null,
    },
  });
}

export async function deleteCrmAccount(accountId: string): Promise<void> {
  // account-scoped activities/tasks/attachments cascade via FK; entity-tags and
  // opportunity-anchored rows are cleaned by app logic where needed.
  await prisma.crmAccount.delete({ where: { id: accountId } });
}
