import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/permissions";
import type { PermissionKey } from "@/lib/permissionCatalog";

export async function enforceStandaloneEstimatePermission(
  session: any,
  permissionKey: PermissionKey,
  actionLabel = "access this estimate area",
) {
  if (!session?.user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Unauthorized - Please sign in" },
        { status: 401 },
      ),
    };
  }

  if (!(await hasPermission(session, permissionKey))) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: `Forbidden - Permission required to ${actionLabel}` },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    userEmail: ((session.user as any).email as string | undefined) ?? null,
  };
}

export async function enforceStandaloneEstimateAccess(session: any) {
  return enforceStandaloneEstimatePermission(session, "estimates.view", "view estimates");
}
