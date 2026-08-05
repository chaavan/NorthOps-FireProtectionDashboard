import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enforceCrmEdit } from "@/lib/crm/crmAccess";
import { deleteCrmTask, updateCrmTask } from "@/lib/crm/crmTaskService";
import { CRM_TASK_STATUSES, type CrmTaskStatus } from "@/lib/crm/crmTypes";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    const body = (await request.json()) as {
      title?: string;
      description?: string | null;
      dueDate?: string | null;
      assigneeEmail?: string | null;
      status?: string;
    };

    if (body.status !== undefined && !CRM_TASK_STATUSES.includes(body.status as CrmTaskStatus)) {
      return NextResponse.json({ error: `Invalid status: ${body.status}` }, { status: 400 });
    }

    const task = await updateCrmTask(taskId, { ...body, status: body.status as CrmTaskStatus | undefined });
    return NextResponse.json({ task });
  } catch (error) {
    console.error("Error in /api/crm/tasks/[taskId] PATCH:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const session = await getServerSession(authOptions);
    const access = await enforceCrmEdit(session);
    if (!access.ok) return access.response;

    await deleteCrmTask(taskId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error in /api/crm/tasks/[taskId] DELETE:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
