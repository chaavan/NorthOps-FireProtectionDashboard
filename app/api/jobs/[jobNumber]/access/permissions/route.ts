import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, resolveSessionUserRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { activeUserWhere } from "@/lib/activeUsers";
import { isPermissionKey, type PermissionKey } from "@/lib/permissionCatalog";
import {
  JOB_OVERRIDABLE_KEYS,
  getEffectivePermissionsForSession,
  getEffectivePermissionsForUser,
  hasPermission,
  resolvePermissionActorId,
  type PermissionOverrideState,
} from "@/lib/permissions";
import { bypassesJobAccessList } from "@/lib/jobScopedAccess";
import { normalizeListContextForLookup } from "@/lib/jobListContext";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobNumber: string }> };

function normalizeOverrideState(value: unknown): PermissionOverrideState | null {
  if (value === "DEFAULT" || value === "ALLOW" || value === "DENY") return value;
  return null;
}

async function canManageJobAccessNow(
  session: any,
  jobNumber: string,
  listNumber: string,
): Promise<boolean> {
  const role = (await resolveSessionUserRole(session)) ?? (session?.user as any)?.role;
  const permissionDetails = await getEffectivePermissionsForSession(session);
  if (bypassesJobAccessList(role, permissionDetails)) return true;
  return hasPermission(session, "job.access.manage", { jobNumber, listNumber });
}

async function loadTargetUser(email: string) {
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, ...activeUserWhere },
    select: { id: true, email: true, name: true, role: true, isSuperAdmin: true },
  });
}

async function assertUserHasJobAccess(
  jobNumber: string,
  listNumber: string,
  userEmail: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse<{ error: string }> }> {
  const access = await prisma.jobAccess.findUnique({
    where: {
      jobNumber_listNumber_userEmail: {
        jobNumber,
        listNumber,
        userEmail,
      },
    },
  });
  if (!access) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "User must be on this job's access list before managing job permissions",
        },
        { status: 400 },
      ),
    };
  }
  return { ok: true };
}

async function buildResponseBody(
  targetUser: { id: string; email: string; name: string | null; role: string; isSuperAdmin: boolean },
  jobNumber: string,
  listNumber: string,
) {
  const details = await getEffectivePermissionsForUser(targetUser);
  // Full effective permission set (not just the job-overridable subset) so
  // the UI can correctly grey out an override when its global dependency
  // (e.g. jobs.view) isn't met, without a separate lookup.
  const basePermissions = details.permissions;

  const overrideRows = await prisma.jobPermissionOverride.findMany({
    where: { jobNumber, listNumber, userEmail: targetUser.email.toLowerCase() },
    select: { permissionKey: true, effect: true },
  });
  const overrides: Partial<Record<PermissionKey, "ALLOW" | "DENY">> = {};
  for (const row of overrideRows) {
    if (isPermissionKey(row.permissionKey)) {
      overrides[row.permissionKey] = row.effect;
    }
  }

  return {
    user: {
      email: targetUser.email,
      name: targetUser.name,
      role: targetUser.role,
      isDeveloper: false,
      isSuperAdmin: details.isSuperAdmin,
    },
    basePermissions,
    overrides,
  };
}

/**
 * GET /api/jobs/[jobNumber]/access/permissions?userEmail=&listNumber=
 * Returns a person's normal (role-derived) permissions for the job-overridable
 * keys, plus any JobPermissionOverride rows already set for them on this
 * job/list.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized - Please sign in" }, { status: 401 });
  }

  const { jobNumber: rawJobNumber } = await context.params;
  const jobNumber = rawJobNumber?.trim();
  if (!jobNumber) {
    return NextResponse.json({ error: "jobNumber is required" }, { status: 400 });
  }

  const searchParams = request.nextUrl.searchParams;
  const targetEmail = searchParams.get("userEmail")?.trim().toLowerCase();
  const listNumber = normalizeListContextForLookup(searchParams.get("listNumber"));
  if (!targetEmail) {
    return NextResponse.json({ error: "userEmail is required" }, { status: 400 });
  }

  if (!(await canManageJobAccessNow(session, jobNumber, listNumber))) {
    return NextResponse.json(
      { error: "Forbidden - You do not have permission to manage access for this job" },
      { status: 403 },
    );
  }

  const targetUser = await loadTargetUser(targetEmail);
  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const accessCheck = await assertUserHasJobAccess(
    jobNumber,
    listNumber,
    targetUser.email.toLowerCase(),
  );
  if (!accessCheck.ok) {
    return accessCheck.response;
  }

  return NextResponse.json(await buildResponseBody(targetUser, jobNumber, listNumber));
}

/**
 * PUT /api/jobs/[jobNumber]/access/permissions
 * Body: { userEmail: string, listNumber?: string, overrides: Record<PermissionKey, 'DEFAULT'|'ALLOW'|'DENY'> }
 *
 * Writes only JobPermissionOverride rows for the given job/list/user.
 * Never modifies PermissionOverride or rolePermissionTemplate.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized - Please sign in" }, { status: 401 });
  }

  const { jobNumber: rawJobNumber } = await context.params;
  const jobNumber = rawJobNumber?.trim();
  if (!jobNumber) {
    return NextResponse.json({ error: "jobNumber is required" }, { status: 400 });
  }

  const body = await request.json();
  const targetEmail = typeof body?.userEmail === "string" ? body.userEmail.trim().toLowerCase() : null;
  const listNumber = normalizeListContextForLookup(
    typeof body?.listNumber === "string" ? body.listNumber : null,
  );
  if (!targetEmail) {
    return NextResponse.json({ error: "userEmail is required" }, { status: 400 });
  }

  if (!(await canManageJobAccessNow(session, jobNumber, listNumber))) {
    return NextResponse.json(
      { error: "Forbidden - You do not have permission to manage access for this job" },
      { status: 403 },
    );
  }

  const targetUser = await loadTargetUser(targetEmail);
  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const accessCheck = await assertUserHasJobAccess(
    jobNumber,
    listNumber,
    targetUser.email.toLowerCase(),
  );
  if (!accessCheck.ok) {
    return accessCheck.response;
  }

  const rawOverrides = body?.overrides;
  const overrideEntries: Array<[PermissionKey, PermissionOverrideState]> = [];
  if (rawOverrides && typeof rawOverrides === "object" && !Array.isArray(rawOverrides)) {
    for (const [key, value] of Object.entries(rawOverrides)) {
      if (!isPermissionKey(key) || !JOB_OVERRIDABLE_KEYS.has(key)) {
        return NextResponse.json({ error: `${key} is not a job-overridable permission` }, { status: 400 });
      }
      const state = normalizeOverrideState(value);
      if (!state) {
        return NextResponse.json({ error: `Invalid override state for ${key}` }, { status: 400 });
      }
      overrideEntries.push([key, state]);
    }
  }

  const actorUserId = await resolvePermissionActorId(session);

  await prisma.$transaction(async (tx) => {
    for (const [permissionKey, state] of overrideEntries) {
      if (state === "DEFAULT") {
        await tx.jobPermissionOverride.deleteMany({
          where: { jobNumber, listNumber, userEmail: targetEmail, permissionKey },
        });
      } else {
        await tx.jobPermissionOverride.upsert({
          where: {
            jobNumber_listNumber_userEmail_permissionKey: {
              jobNumber,
              listNumber,
              userEmail: targetEmail,
              permissionKey,
            },
          },
          update: { effect: state, changedByUserId: actorUserId },
          create: {
            jobNumber,
            listNumber,
            userEmail: targetEmail,
            permissionKey,
            effect: state,
            changedByUserId: actorUserId,
          },
        });
      }
    }
  });

  return NextResponse.json(await buildResponseBody(targetUser, jobNumber, listNumber));
}
