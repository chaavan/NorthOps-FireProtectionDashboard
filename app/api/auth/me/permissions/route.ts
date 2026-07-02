import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PERMISSION_GROUPS, PERMISSION_HIERARCHY } from "@/lib/permissionCatalog";
import {
  getEffectivePermissionsForSession,
  getJobPermissionOverrides,
  mergeJobScopedPermissions,
} from "@/lib/permissions";
import { normalizeListContextForLookup } from "@/lib/jobListContext";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { error: "Unauthorized - Please sign in" },
      { status: 401 },
    );
  }

  const details = await getEffectivePermissionsForSession(session);
  if (!details) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // When called with a jobNumber, fold in this user's job-scoped permission
  // overrides for that job/list so the UI reflects them the same way the
  // server's hasPermission check does (not just the user's global role).
  const jobNumber = request.nextUrl.searchParams.get("jobNumber")?.trim();
  let permissions = details.permissions;
  if (jobNumber && !details.isDeveloper && !details.isSuperAdmin) {
    const userEmail = session.user.email?.trim().toLowerCase();
    if (userEmail) {
      const listNumber = normalizeListContextForLookup(
        request.nextUrl.searchParams.get("listNumber"),
      );
      const overrides = await getJobPermissionOverrides(userEmail, jobNumber, listNumber);
      permissions = mergeJobScopedPermissions(details.permissions, overrides);
    }
  }

  return NextResponse.json({
    groups: PERMISSION_GROUPS,
    hierarchy: PERMISSION_HIERARCHY,
    ...details,
    permissions,
  });
}
