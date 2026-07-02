import { NextResponse } from "next/server";
import { hasPermission, getEffectivePermissionsForSession } from "@/lib/permissions";
import { bypassesJobAccessList } from "@/lib/jobScopedAccess";
import { isJobPreorderEnabled } from "@/lib/featureFlags";
import { canAccessJob, jobHasAccessRecords } from "@/lib/jobAccess";

type SessionUser = {
  email?: string | null;
  role?: string;
};

export function jobPreorderFeatureDisabledResponse(): NextResponse | null {
  if (isJobPreorderEnabled()) return null;
  return NextResponse.json(
    { error: "Job pre-order is disabled" },
    { status: 404 },
  );
}

function resolveListContext(
  listNumberContext: string | null | undefined,
  listNumber: string | null | undefined,
): string {
  const a = listNumberContext?.trim();
  if (a) return a;
  const b = listNumber?.trim();
  if (b) return b;
  return "1";
}

/**
 * Read job pre-orders: any dashboard viewer with job access (when access records exist).
 */
export async function assertJobPreorderReadAccess(params: {
  sessionUser: SessionUser | undefined;
  jobNumber: string;
  listNumberContext?: string | null;
  listNumber?: string | null;
}): Promise<NextResponse | null> {
  const sessionUser = params.sessionUser;
  if (!sessionUser) {
    return NextResponse.json(
      { error: "Unauthorized - Please sign in" },
      { status: 401 },
    );
  }
  const role = sessionUser.role;
  const listContext = resolveListContext(params.listNumberContext, params.listNumber);
  if (
    !(await hasPermission(
      { user: sessionUser },
      "job.preorder.view",
      { jobNumber: params.jobNumber, listNumber: listContext },
    ))
  ) {
    return NextResponse.json(
      { error: "Forbidden - You do not have permission to view job pre-orders" },
      { status: 403 },
    );
  }
  const userEmail = sessionUser.email?.trim().toLowerCase();
  if (!userEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const permissionDetails = await getEffectivePermissionsForSession({ user: sessionUser });
  const bypassJobAccess = bypassesJobAccessList(role, permissionDetails);
  if (!bypassJobAccess) {
    const hasRecords = await jobHasAccessRecords(params.jobNumber, listContext);
    if (hasRecords) {
      const hasAccess = await canAccessJob(userEmail, params.jobNumber, listContext);
      if (!hasAccess) {
        return NextResponse.json(
          { error: "Forbidden - You do not have access to this job" },
          { status: 403 },
        );
      }
    }
    // No access records means the job is open - fall through and allow.
  }
  return null;
}

/**
 * Mutate job pre-orders: same gate as /api/jobs/update (overview editors + job access).
 */
export async function assertJobPreorderWriteAccess(params: {
  sessionUser: SessionUser | undefined;
  jobNumber: string;
  listNumberContext?: string | null;
  listNumber?: string | null;
}): Promise<NextResponse | null> {
  const sessionUser = params.sessionUser;
  if (!sessionUser) {
    return NextResponse.json(
      { error: "Unauthorized - Please sign in" },
      { status: 401 },
    );
  }
  const role = sessionUser.role;
  const userEmail = sessionUser.email?.trim().toLowerCase();
  if (!userEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const listContext = resolveListContext(params.listNumberContext, params.listNumber);

  if (
    !(await hasPermission(
      { user: sessionUser },
      "job.preorder.edit",
      { jobNumber: params.jobNumber, listNumber: listContext },
    ))
  ) {
    return NextResponse.json(
      { error: "Forbidden - You do not have permission to edit job pre-orders" },
      { status: 403 },
    );
  }

  const permissionDetails = await getEffectivePermissionsForSession({ user: sessionUser });
  const bypassJobAccess = bypassesJobAccessList(role, permissionDetails);
  if (!bypassJobAccess) {
    const hasRecords = await jobHasAccessRecords(params.jobNumber, listContext);
    if (hasRecords) {
      const hasAccess = await canAccessJob(userEmail, params.jobNumber, listContext);
      if (!hasAccess) {
        return NextResponse.json(
          { error: "Forbidden - You do not have access to this job" },
          { status: 403 },
        );
      }
    }
    // No access records means the job is open - fall through and allow.
  }

  return null;
}
