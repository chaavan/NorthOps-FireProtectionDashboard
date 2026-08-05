import { prisma } from "@/lib/prisma";
import {
  createPresignedGetUrl,
  createPresignedPutUrl,
  deleteR2Object,
} from "@/lib/r2";
import type { CrmAttachmentRecord, CrmEntityType } from "@/lib/crm/crmTypes";

function extFromContentType(contentType: string): string {
  if (contentType === "application/pdf") return "pdf";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/png") return "png";
  if (contentType === "image/jpeg") return "jpg";
  const suffix = contentType.includes("/") ? contentType.split("/")[1] : "";
  const normalized = suffix.split(";")[0].toLowerCase().replace(/[^a-z0-9]+/g, "");
  return normalized || "bin";
}

/** Build an R2 key + presigned PUT URL for a new CRM attachment upload. */
export async function createCrmAttachmentUploadTarget(input: {
  entityType: CrmEntityType;
  entityId: string;
  contentType: string;
}): Promise<{ uploadUrl: string; r2Key: string }> {
  const uuid = crypto.randomUUID();
  const ext = extFromContentType(input.contentType);
  const r2Key = `crm/${input.entityType.toLowerCase()}/${encodeURIComponent(input.entityId)}/${uuid}.${ext}`;
  const uploadUrl = await createPresignedPutUrl({ key: r2Key, contentType: input.contentType });
  return { uploadUrl, r2Key };
}

export async function createCrmAttachmentRecord(input: {
  entityType: CrmEntityType;
  entityId: string;
  accountId?: string | null;
  r2Key: string;
  contentType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  fileName?: string | null;
  createdBy?: string | null;
}): Promise<CrmAttachmentRecord> {
  const row = await prisma.crmAttachment.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      accountId: input.accountId ?? null,
      r2Key: input.r2Key,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      width: input.width ?? null,
      height: input.height ?? null,
      fileName: input.fileName?.trim() || null,
      createdBy: input.createdBy ?? null,
    },
  });
  return {
    id: row.id,
    entityType: row.entityType as CrmEntityType,
    entityId: row.entityId,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    url: null,
  };
}

export async function listCrmAttachments(
  entityType: CrmEntityType,
  entityId: string,
): Promise<CrmAttachmentRecord[]> {
  const rows = await prisma.crmAttachment.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      entityType: row.entityType as CrmEntityType,
      entityId: row.entityId,
      fileName: row.fileName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      url: await createPresignedGetUrl({ key: row.r2Key }).catch(() => null),
    })),
  );
}

export async function deleteCrmAttachment(id: string): Promise<void> {
  const row = await prisma.crmAttachment.findUnique({ where: { id }, select: { r2Key: true } });
  if (!row) return;
  await deleteR2Object({ key: row.r2Key }).catch(() => undefined);
  await prisma.crmAttachment.delete({ where: { id } });
}
