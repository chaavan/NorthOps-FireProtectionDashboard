import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit, enforceCrmView } from "@/lib/crm/crmAccess";
import { createCrmTask, listCrmTasks } from "@/lib/crm/crmTaskService";
import type { CrmEntityType, CrmTaskStatus } from "@/lib/crm/crmTypes";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmView(session);
    if (!access.ok) return access.response;

    const params = request.nextUrl.searchParams;
    // `mine=1` scopes to the signed-in user's assigned tasks.
    const assigneeEmail = params.get("mine") === "1" ? access.userEmail : params.get("assigneeEmail");

    const tasks = await listCrmTasks({
      assigneeEmail,
      entityType: params.get("entityType") as CrmEntityType | null,
      entityId: params.get("entityId"),
      status: params.get("status") as CrmTaskStatus | null,
    });
    return NextResponse.json({ tasks });
  } catch (error) {
    console.error("Error in /api/crm/tasks GET:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    const body = (await request.json()) as {
      title?: string;
      description?: string | null;
      dueDate?: string | null;
      assigneeEmail?: string | null;
      entityType?: CrmEntityType | null;
      entityId?: string | null;
      accountId?: string | null;
    };

    if (!body.title?.trim()) {
      return NextResponse.json({ error: "Task title is required" }, { status: 400 });
    }

    const task = await createCrmTask({
      title: body.title,
      description: body.description,
      dueDate: body.dueDate,
      // Default the assignee to the creator so tasks land in someone's "mine" list.
      assigneeEmail: body.assigneeEmail ?? access.userEmail,
      entityType: body.entityType,
      entityId: body.entityId,
      accountId: body.accountId,
      createdBy: access.userEmail,
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    console.error("Error in /api/crm/tasks POST:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
