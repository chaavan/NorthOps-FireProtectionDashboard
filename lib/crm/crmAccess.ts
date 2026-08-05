import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/permissions";
import { isCrmEnabled } from "@/lib/featureFlags";
import type { PermissionKey } from "@/lib/permissionCatalog";

export async function enforceCrmPermission(
  session: any,
  permissionKey: PermissionKey,
  actionLabel = "access CRM",
) {
  // Defence in depth. proxy.ts already 404s /api/crm/* when the module is off,
  // but every route in this module calls one of these helpers first, so the gate
  // also holds if the proxy is ever restructured. 404 rather than 403 so a
  // disabled module does not advertise its own existence.
  if (!isCrmEnabled()) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }

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

export async function enforceCrmView(session: any) {
  return enforceCrmPermission(session, "crm.view", "view CRM");
}

export async function enforceCrmEdit(session: any) {
  return enforceCrmPermission(session, "crm.edit", "edit CRM records");
}
