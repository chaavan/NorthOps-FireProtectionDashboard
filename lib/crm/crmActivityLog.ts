import { prisma } from "@/lib/prisma";
import type {
  CrmActivityRecord,
  CrmActivityType,
  CrmEntityType,
} from "@/lib/crm/crmTypes";

function toActivityRecord(row: {
  id: string;
  entityType: string;
  entityId: string;
  accountId: string | null;
  activityType: string;
  subject: string | null;
  body: string | null;
  occurredAt: Date;
  createdBy: string | null;
  createdAt: Date;
}): CrmActivityRecord {
  return {
    id: row.id,
    entityType: row.entityType as CrmEntityType,
    entityId: row.entityId,
    accountId: row.accountId,
    activityType: row.activityType as CrmActivityType,
    subject: row.subject,
    body: row.body,
    occurredAt: row.occurredAt.toISOString(),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Append a timeline entry. Mirrors the actor/contextId ledger convention used
 * by lib/inventoryLedger.ts. Called both by manual logging (NOTE/CALL/EMAIL/
 * MEETING) and by mutations that record STAGE_CHANGE/SYSTEM events.
 */
export async function logCrmActivity(input: {
  entityType: CrmEntityType;
  entityId: string;
  accountId?: string | null;
  activityType: CrmActivityType;
  subject?: string | null;
  body?: string | null;
  occurredAt?: Date | string | null;
  createdBy?: string | null;
}): Promise<CrmActivityRecord> {
  const occurredAt =
    input.occurredAt instanceof Date
      ? input.occurredAt
      : input.occurredAt
        ? new Date(input.occurredAt)
        : undefined;

  const row = await prisma.crmActivity.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      accountId: input.accountId ?? null,
      activityType: input.activityType,
      subject: input.subject?.trim() || null,
      body: input.body?.trim() || null,
      ...(occurredAt ? { occurredAt } : {}),
      createdBy: input.createdBy ?? null,
    },
  });
  return toActivityRecord(row);
}

export async function listCrmActivities(filters: {
  entityType?: CrmEntityType | null;
  entityId?: string | null;
  accountId?: string | null;
}): Promise<CrmActivityRecord[]> {
  const where =
    filters.entityType && filters.entityId
      ? { entityType: filters.entityType, entityId: filters.entityId }
      : filters.accountId
        ? { accountId: filters.accountId }
        : null;

  // Never return the whole table when no scope is supplied.
  if (!where) return [];

  const rows = await prisma.crmActivity.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: 200,
  });
  return rows.map(toActivityRecord);
}

export async function updateCrmActivity(
  id: string,
  input: { subject?: string | null; body?: string | null; occurredAt?: string | null },
): Promise<CrmActivityRecord> {
  const row = await prisma.crmActivity.update({
    where: { id },
    data: {
      ...(input.subject !== undefined ? { subject: input.subject?.trim() || null } : {}),
      ...(input.body !== undefined ? { body: input.body?.trim() || null } : {}),
      ...(input.occurredAt !== undefined && input.occurredAt
        ? { occurredAt: new Date(input.occurredAt) }
        : {}),
    },
  });
  return toActivityRecord(row);
}

export async function deleteCrmActivity(id: string): Promise<void> {
  await prisma.crmActivity.delete({ where: { id } });
}
