import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requirePermission, resolvePermissionActorId } from "@/lib/permissions";
import { requireRolePermissionManagementEnabled } from "@/lib/rolePermissionManagementGuard";
import {
  createDashboardRole,
  listDashboardRoles,
} from "@/lib/roleService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const feature = requireRolePermissionManagementEnabled();
  if (!feature.ok) return feature.response;

  const session = await getServerSession(authOptions);
  const auth = await requirePermission(session, "users.view");
  if (!auth.ok) return auth.response;

  const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "true";
  const includeUserCounts = request.nextUrl.searchParams.get("includeUserCounts") === "true";

  if (includeArchived) {
    const manageAuth = await requirePermission(session, "users.permissions.edit");
    if (!manageAuth.ok) return manageAuth.response;
  }

  const roles = await listDashboardRoles({ includeArchived, includeUserCounts });
  return NextResponse.json({ roles });
}

export async function POST(request: NextRequest) {
  const feature = requireRolePermissionManagementEnabled();
  if (!feature.ok) return feature.response;

  const session = await getServerSession(authOptions);
  const auth = await requirePermission(session, "users.permissions.edit");
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const name = typeof body?.name === "string" ? body.name : "";
  const colorClass = typeof body?.colorClass === "string" ? body.colorClass : null;

  try {
    const role = await createDashboardRole({
      name,
      colorClass,
      actorUserId: await resolvePermissionActorId(session),
    });
    return NextResponse.json({ role });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
