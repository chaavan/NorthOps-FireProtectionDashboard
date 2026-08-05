import { prisma } from "@/lib/prisma";
import type { CrmEntityType, CrmTagRecord } from "@/lib/crm/crmTypes";

function toTagRecord(row: { id: string; name: string; color: string }): CrmTagRecord {
  return { id: row.id, name: row.name, color: row.color };
}

export async function listCrmTags(): Promise<CrmTagRecord[]> {
  const rows = await prisma.crmTag.findMany({ orderBy: { name: "asc" } });
  return rows.map(toTagRecord);
}

export async function createCrmTag(input: { name: string; color?: string }): Promise<CrmTagRecord> {
  const name = input.name.trim();
  const existing = await prisma.crmTag.findUnique({ where: { name } });
  if (existing) return toTagRecord(existing);
  const row = await prisma.crmTag.create({
    data: { name, color: input.color?.trim() || "#3b82f6" },
  });
  return toTagRecord(row);
}

export async function deleteCrmTag(id: string): Promise<void> {
  await prisma.crmTag.delete({ where: { id } });
}

export async function listTagsForEntity(
  entityType: CrmEntityType,
  entityId: string,
): Promise<CrmTagRecord[]> {
  const rows = await prisma.crmEntityTag.findMany({
    where: { entityType, entityId },
    include: { tag: true },
    orderBy: { tag: { name: "asc" } },
  });
  return rows.map((row) => toTagRecord(row.tag));
}

export async function addTagToEntity(input: {
  tagId: string;
  entityType: CrmEntityType;
  entityId: string;
}): Promise<void> {
  await prisma.crmEntityTag.upsert({
    where: {
      tagId_entityType_entityId: {
        tagId: input.tagId,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    },
    create: { tagId: input.tagId, entityType: input.entityType, entityId: input.entityId },
    update: {},
  });
}

export async function removeTagFromEntity(input: {
  tagId: string;
  entityType: CrmEntityType;
  entityId: string;
}): Promise<void> {
  await prisma.crmEntityTag.deleteMany({
    where: { tagId: input.tagId, entityType: input.entityType, entityId: input.entityId },
  });
}
