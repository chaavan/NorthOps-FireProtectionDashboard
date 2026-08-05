import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit, enforceCrmView } from "@/lib/crm/crmAccess";
import {
  createCrmAttachmentRecord,
  listCrmAttachments,
} from "@/lib/crm/crmAttachmentService";
import { CRM_ENTITY_TYPES, type CrmEntityType } from "@/lib/crm/crmTypes";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmView(session);
    if (!access.ok) return access.response;

    const entityType = request.nextUrl.searchParams.get("entityType");
    const entityId = request.nextUrl.searchParams.get("entityId");
    if (!entityType || !CRM_ENTITY_TYPES.includes(entityType as CrmEntityType) || !entityId) {
      return NextResponse.json({ error: "Valid entityType and entityId are required" }, { status: 400 });
    }

    const attachments = await listCrmAttachments(entityType as CrmEntityType, entityId);
    return NextResponse.json({ attachments });
  } catch (error) {
    console.error("Error in /api/crm/attachments GET:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    const body = (await request.json()) as {
      entityType?: string;
      entityId?: string;
      accountId?: string | null;
      r2Key?: string;
      contentType?: string;
      sizeBytes?: number;
      width?: number | null;
      height?: number | null;
      fileName?: string | null;
    };

    if (
      !body.entityType ||
      !CRM_ENTITY_TYPES.includes(body.entityType as CrmEntityType) ||
      !body.entityId?.trim() ||
      !body.r2Key?.trim() ||
      !body.contentType?.trim() ||
      typeof body.sizeBytes !== "number"
    ) {
      return NextResponse.json({ error: "Missing required attachment fields" }, { status: 400 });
    }

    const attachment = await createCrmAttachmentRecord({
      entityType: body.entityType as CrmEntityType,
      entityId: body.entityId,
      accountId: body.accountId ?? null,
      r2Key: body.r2Key,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      width: body.width ?? null,
      height: body.height ?? null,
      fileName: body.fileName ?? null,
      createdBy: access.userEmail,
    });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    console.error("Error in /api/crm/attachments POST:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
