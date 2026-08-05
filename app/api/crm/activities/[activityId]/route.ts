import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit } from "@/lib/crm/crmAccess";
import { deleteCrmActivity, updateCrmActivity } from "@/lib/crm/crmActivityLog";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ activityId: string }> },
) {
  try {
    const { activityId } = await params;
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    const body = (await request.json()) as {
      subject?: string | null;
      body?: string | null;
      occurredAt?: string | null;
    };
    const activity = await updateCrmActivity(activityId, body);
    return NextResponse.json({ activity });
  } catch (error) {
    console.error("Error in /api/crm/activities/[activityId] PATCH:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ activityId: string }> },
) {
  try {
    const { activityId } = await params;
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    await deleteCrmActivity(activityId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error in /api/crm/activities/[activityId] DELETE:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
