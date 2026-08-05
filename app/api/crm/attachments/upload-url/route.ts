import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit } from "@/lib/crm/crmAccess";
import { isR2Configured } from "@/lib/r2";
import { createCrmAttachmentUploadTarget } from "@/lib/crm/crmAttachmentService";
import { CRM_ENTITY_TYPES, type CrmEntityType } from "@/lib/crm/crmTypes";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    if (!isR2Configured()) {
      return NextResponse.json(
        { error: "File storage (R2) is not configured. Please contact support." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as {
      entityType?: string;
      entityId?: string;
      contentType?: string;
    };
    if (!body.entityType || !CRM_ENTITY_TYPES.includes(body.entityType as CrmEntityType)) {
      return NextResponse.json({ error: "Valid entityType is required" }, { status: 400 });
    }
    if (!body.entityId?.trim() || !body.contentType?.trim()) {
      return NextResponse.json({ error: "entityId and contentType are required" }, { status: 400 });
    }

    const target = await createCrmAttachmentUploadTarget({
      entityType: body.entityType as CrmEntityType,
      entityId: body.entityId,
      contentType: body.contentType,
    });
    return NextResponse.json(target);
  } catch (error) {
    console.error("Error in /api/crm/attachments/upload-url POST:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
