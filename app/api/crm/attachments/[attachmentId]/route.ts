import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit } from "@/lib/crm/crmAccess";
import { deleteCrmAttachment } from "@/lib/crm/crmAttachmentService";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  try {
    const { attachmentId } = await params;
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    await deleteCrmAttachment(attachmentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error in /api/crm/attachments/[attachmentId] DELETE:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
