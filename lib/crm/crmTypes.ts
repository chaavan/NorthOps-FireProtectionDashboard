export const CRM_CONTACT_ROLES = [
  "PROPERTY_MANAGER",
  "FACILITIES_DIRECTOR",
  "GC",
  "ARCHITECT",
  "BUILDING_OWNER",
  "OTHER",
] as const;

export type CrmContactRole = (typeof CRM_CONTACT_ROLES)[number];

export const CRM_DEFICIENCY_STATUSES = [
  "OPEN",
  "QUOTED",
  "REPAIRED",
  "DECLINED",
] as const;

export type CrmDeficiencyStatus = (typeof CRM_DEFICIENCY_STATUSES)[number];

export const CRM_OPPORTUNITY_STAGES = [
  "DEFICIENCY_IDENTIFIED",
  "QUOTED",
  "SENT",
  "WON",
  "LOST",
  "SCHEDULED",
] as const;

export type CrmOpportunityStage = (typeof CRM_OPPORTUNITY_STAGES)[number];

export const CRM_OPPORTUNITY_TYPES = [
  "SERVICE_DEFICIENCY",
  "NEW_BUSINESS_BID",
  "RENEWAL",
] as const;

export type CrmOpportunityType = (typeof CRM_OPPORTUNITY_TYPES)[number];

export const CRM_RENEWAL_STATUSES = [
  "ACTIVE",
  "PENDING_RENEWAL",
  "RENEWED",
  "LOST",
  "EXPIRED",
] as const;

export type CrmRenewalStatus = (typeof CRM_RENEWAL_STATUSES)[number];

// --- HubSpot-style basics: entities, activities, tasks ---

export const CRM_ENTITY_TYPES = [
  "ACCOUNT",
  "CONTACT",
  "OPPORTUNITY",
  "DEFICIENCY",
] as const;

export type CrmEntityType = (typeof CRM_ENTITY_TYPES)[number];

export const CRM_ACTIVITY_TYPES = [
  "NOTE",
  "CALL",
  "EMAIL",
  "MEETING",
  "STAGE_CHANGE",
  "SYSTEM",
] as const;

export type CrmActivityType = (typeof CRM_ACTIVITY_TYPES)[number];

/** Activity types a user can log manually (excludes system-generated ones). */
export const CRM_LOGGABLE_ACTIVITY_TYPES = [
  "NOTE",
  "CALL",
  "EMAIL",
  "MEETING",
] as const satisfies readonly CrmActivityType[];

export const CRM_TASK_STATUSES = ["OPEN", "DONE"] as const;

export type CrmTaskStatus = (typeof CRM_TASK_STATUSES)[number];

export type CrmPipelineStageSummary = {
  stage: CrmOpportunityStage;
  label: string;
  count: number;
  value: number;
};

export type CrmRenewalCalendarItem = {
  id: string;
  accountId: string;
  accountName: string;
  locationName: string | null;
  contractName: string;
  renewalDate: string;
  daysUntilRenewal: number;
  annualValue: number | null;
  status: string;
  salesRepEmail: string | null;
  urgency: "critical" | "warning" | "normal";
};

export type CrmRepPerformance = {
  salesRepEmail: string;
  openDeficiencies: number;
  quotedNotSent: number;
  sentOpen: number;
  wonCount: number;
  lostCount: number;
  winRate: number | null;
  pipelineValue: number;
};

export type CrmAccountRollup = {
  id: string;
  name: string;
  accountType: string;
  salesRepEmail: string | null;
  locationCount: number;
  openDeficiencies: number;
  activeOpportunities: number;
  upcomingRenewals: number;
  locations: Array<{
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    openDeficiencies: number;
    upcomingRenewals: number;
  }>;
};

export type CrmDashboardPayload = {
  pipeline: CrmPipelineStageSummary[];
  renewals: CrmRenewalCalendarItem[];
  repPerformance: CrmRepPerformance[];
  accountRollups: CrmAccountRollup[];
};

export type CrmOpportunityRecord = {
  id: string;
  title: string;
  stage: CrmOpportunityStage;
  opportunityType: CrmOpportunityType;
  value: number | null;
  salesRepEmail: string | null;
  scheduledAt: string | null;
  account: { id: string; name: string };
  location: { id: string; name: string } | null;
  deficiency: { id: string; title: string; status: string } | null;
  estimate: {
    id: string;
    title: string;
    bidStatus: string;
    totalCost: number | null;
  } | null;
};

export function crmStageLabel(stage: string): string {
  switch (stage) {
    case "DEFICIENCY_IDENTIFIED":
      return "Deficiency Identified";
    case "QUOTED":
      return "Quoted";
    case "SENT":
      return "Sent";
    case "WON":
      return "Won";
    case "LOST":
      return "Lost";
    case "SCHEDULED":
      return "Scheduled";
    default:
      return stage;
  }
}

export function crmContactRoleLabel(role: string): string {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function crmActivityTypeLabel(type: string): string {
  switch (type) {
    case "NOTE":
      return "Note";
    case "CALL":
      return "Call";
    case "EMAIL":
      return "Email";
    case "MEETING":
      return "Meeting";
    case "STAGE_CHANGE":
      return "Stage change";
    case "SYSTEM":
      return "System";
    default:
      return type;
  }
}

// --- Record shapes returned by the new CRM APIs ---

export type CrmContactRecord = {
  id: string;
  accountId: string;
  locationId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  isPrimary: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  account?: { id: string; name: string } | null;
  location?: { id: string; name: string } | null;
};

export type CrmActivityRecord = {
  id: string;
  entityType: CrmEntityType;
  entityId: string;
  accountId: string | null;
  activityType: CrmActivityType;
  subject: string | null;
  body: string | null;
  occurredAt: string;
  createdBy: string | null;
  createdAt: string;
};

export type CrmTaskRecord = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: CrmTaskStatus;
  assigneeEmail: string | null;
  entityType: CrmEntityType | null;
  entityId: string | null;
  accountId: string | null;
  createdBy: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CrmTagRecord = {
  id: string;
  name: string;
  color: string;
};

export type CrmAttachmentRecord = {
  id: string;
  entityType: CrmEntityType;
  entityId: string;
  fileName: string | null;
  contentType: string;
  sizeBytes: number;
  createdBy: string | null;
  createdAt: string;
  url: string | null;
};

export type CrmAccountDetail = {
  id: string;
  name: string;
  accountType: string;
  salesRepEmail: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  locations: Array<{
    id: string;
    name: string;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    isPrimary: boolean;
  }>;
  contacts: CrmContactRecord[];
  opportunities: Array<{
    id: string;
    title: string;
    stage: CrmOpportunityStage;
    value: number | null;
    salesRepEmail: string | null;
  }>;
  renewals: Array<{
    id: string;
    contractName: string;
    renewalDate: string;
    annualValue: number | null;
    status: string;
  }>;
  deficiencies: Array<{
    id: string;
    title: string;
    severity: string;
    status: string;
    estimatedValue: number | null;
  }>;
  tags: CrmTagRecord[];
};

export function opportunityStageFromEstimateBidStatus(
  bidStatus: string | null | undefined,
): CrmOpportunityStage | null {
  switch (bidStatus) {
    case "DRAFT":
      return "QUOTED";
    case "SENT":
      return "SENT";
    case "WON":
      return "WON";
    case "LOST":
      return "LOST";
    default:
      return null;
  }
}
