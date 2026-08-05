import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit, enforceCrmView } from "@/lib/crm/crmAccess";
import { listCrmActivities, logCrmActivity } from "@/lib/crm/crmActivityLog";
import {
  CRM_ENTITY_TYPES,
  CRM_LOGGABLE_ACTIVITY_TYPES,
  type CrmActivityType,
  type CrmEntityType,
} from "@/lib/crm/crmTypes";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmView(session);
    if (!access.ok) return access.response;

    const params = request.nextUrl.searchParams;
    const entityType = params.get("entityType") as CrmEntityType | null;
    const entityId = params.get("entityId");
    const accountId = params.get("accountId");

    const activities = await listCrmActivities({ entityType, entityId, accountId });
    return NextResponse.json({ activities });
  } catch (error) {
    console.error("Error in /api/crm/activities GET:", error);
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
      activityType?: string;
      subject?: string | null;
      body?: string | null;
      occurredAt?: string | null;
    };

    if (!body.entityType || !CRM_ENTITY_TYPES.includes(body.entityType as CrmEntityType)) {
      return NextResponse.json({ error: "Valid entityType is required" }, { status: 400 });
    }
    if (!body.entityId?.trim()) {
      return NextResponse.json({ error: "entityId is required" }, { status: 400 });
    }
    const activityType = (body.activityType || "NOTE") as CrmActivityType;
    if (!CRM_LOGGABLE_ACTIVITY_TYPES.includes(activityType as (typeof CRM_LOGGABLE_ACTIVITY_TYPES)[number])) {
      return NextResponse.json({ error: `Cannot log activity type: ${activityType}` }, { status: 400 });
    }
    if (!body.body?.trim() && !body.subject?.trim()) {
      return NextResponse.json({ error: "Activity needs a subject or body" }, { status: 400 });
    }

    const activity = await logCrmActivity({
      entityType: body.entityType as CrmEntityType,
      entityId: body.entityId,
      accountId: body.accountId ?? null,
      activityType,
      subject: body.subject,
      body: body.body,
      occurredAt: body.occurredAt,
      createdBy: access.userEmail,
    });

    return NextResponse.json({ activity }, { status: 201 });
  } catch (error) {
    console.error("Error in /api/crm/activities POST:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
