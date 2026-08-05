import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit } from "@/lib/crm/crmAccess";
import { deleteCrmTag } from "@/lib/crm/crmTagService";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ tagId: string }> },
) {
  try {
    const { tagId } = await params;
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    await deleteCrmTag(tagId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error in /api/crm/tags/[tagId] DELETE:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
