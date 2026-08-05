import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type {
  CrmEntityType,
  CrmTaskRecord,
  CrmTaskStatus,
} from "@/lib/crm/crmTypes";

function toTaskRecord(row: {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  status: string;
  assigneeEmail: string | null;
  entityType: string | null;
  entityId: string | null;
  accountId: string | null;
  createdBy: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): CrmTaskRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    status: row.status as CrmTaskStatus,
    assigneeEmail: row.assigneeEmail,
    entityType: (row.entityType as CrmEntityType | null) ?? null,
    entityId: row.entityId,
    accountId: row.accountId,
    createdBy: row.createdBy,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCrmTasks(filters: {
  assigneeEmail?: string | null;
  entityType?: CrmEntityType | null;
  entityId?: string | null;
  status?: CrmTaskStatus | null;
}): Promise<CrmTaskRecord[]> {
  const where: Prisma.CrmTaskWhereInput = {
    ...(filters.assigneeEmail ? { assigneeEmail: filters.assigneeEmail } : {}),
    ...(filters.entityType && filters.entityId
      ? { entityType: filters.entityType, entityId: filters.entityId }
      : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };

  const rows = await prisma.crmTask.findMany({
    where,
    // Open first, then by soonest due date (nulls last), newest first as tiebreak.
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return rows.map(toTaskRecord);
}

export async function createCrmTask(input: {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  assigneeEmail?: string | null;
  entityType?: CrmEntityType | null;
  entityId?: string | null;
  accountId?: string | null;
  createdBy?: string | null;
}): Promise<CrmTaskRecord> {
  const row = await prisma.crmTask.create({
    data: {
      title: input.title.trim(),
      description: input.description?.trim() || null,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      assigneeEmail: input.assigneeEmail?.trim() || null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      accountId: input.accountId ?? null,
      createdBy: input.createdBy ?? null,
    },
  });
  return toTaskRecord(row);
}

export async function updateCrmTask(
  id: string,
  input: {
    title?: string;
    description?: string | null;
    dueDate?: string | null;
    assigneeEmail?: string | null;
    status?: CrmTaskStatus;
  },
): Promise<CrmTaskRecord> {
  const data: Prisma.CrmTaskUpdateInput = {
    ...(input.title !== undefined ? { title: input.title.trim() } : {}),
    ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
    ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? new Date(input.dueDate) : null } : {}),
    ...(input.assigneeEmail !== undefined ? { assigneeEmail: input.assigneeEmail?.trim() || null } : {}),
  };
  if (input.status !== undefined) {
    data.status = input.status;
    data.completedAt = input.status === "DONE" ? new Date() : null;
  }

  const row = await prisma.crmTask.update({ where: { id }, data });
  return toTaskRecord(row);
}

export async function deleteCrmTask(id: string): Promise<void> {
  await prisma.crmTask.delete({ where: { id } });
}
