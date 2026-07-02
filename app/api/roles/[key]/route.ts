import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requirePermission, resolvePermissionActorId } from "@/lib/permissions";
import { requireRolePermissionManagementEnabled } from "@/lib/rolePermissionManagementGuard";
import { getDashboardRole, updateDashboardRole } from "@/lib/roleService";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ key: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const feature = requireRolePermissionManagementEnabled();
  if (!feature.ok) return feature.response;

  const session = await getServerSession(authOptions);
  const auth = await requirePermission(session, "users.view");
  if (!auth.ok) return auth.response;

  const { key } = await context.params;
  const role = await getDashboardRole(key);
  if (!role) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }

  return NextResponse.json({ role });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const feature = requireRolePermissionManagementEnabled();
  if (!feature.ok) return feature.response;

  const session = await getServerSession(authOptions);
  const auth = await requirePermission(session, "users.permissions.edit");
  if (!auth.ok) return auth.response;

  const { key } = await context.params;
  const body = await request.json();

  try {
    const role = await updateDashboardRole({
      key,
      name: typeof body?.name === "string" ? body.name : undefined,
      description:
        body?.description === null || typeof body?.description === "string"
          ? body.description
          : undefined,
      colorClass:
        body?.colorClass === null || typeof body?.colorClass === "string"
          ? body.colorClass
          : undefined,
      isActive: typeof body?.isActive === "boolean" ? body.isActive : undefined,
      actorUserId: await resolvePermissionActorId(session),
    });
    return NextResponse.json({ role });
  } catch (error) {
    const message = (error as Error).message;
    const status = message === "Role not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
