import "server-only";

import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { canAccessJob, jobHasAccessRecords } from "@/lib/jobAccess";
import { hasPermission } from "@/lib/permissions";
import type { PermissionKey } from "@/lib/permissionCatalog";

type SessionLike =
  | {
      user?: {
        role?: string | null;
        email?: string | null;
      } | null;
    }
  | null
  | undefined;

function getSessionUserEmail(session: SessionLike): string | null {
  return session?.user?.email?.trim().toLowerCase() || null;
}

export async function enforceJobAccess(params: {
  jobNumber: string;
  listNumberContext?: string | null;
  session: SessionLike;
}): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const { jobNumber, listNumberContext, session } = params;
  const userRole = session?.user?.role;
  const userEmail = getSessionUserEmail(session);
  const isUserAdmin = isAdmin(userRole || undefined);

  if (!isUserAdmin) {
    if (!userEmail) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Forbidden - Missing user email" }, { status: 403 }),
      };
    }
    const hasRecords = await jobHasAccessRecords(jobNumber, listNumberContext);
    if (hasRecords) {
      const hasAccess = await canAccessJob(userEmail, jobNumber, listNumberContext);
      if (!hasAccess) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: "Forbidden - You do not have access to this job" },
            { status: 403 },
          ),
        };
      }
    }
  }

  return { ok: true };
}

export async function requireJobScopedPermission(
  session: SessionLike,
  permissionKey: PermissionKey,
  jobNumber: string,
  listNumberContext?: string | null,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized - Please sign in" }, { status: 401 }),
    };
  }

  if (
    !(await hasPermission(session, permissionKey, {
      jobNumber,
      listNumber: listNumberContext,
    }))
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden - You do not have permission" },
        { status: 403 },
      ),
    };
  }

  const access = await enforceJobAccess({ jobNumber, listNumberContext, session });
  if (!access.ok) return access;

  return { ok: true };
}
