import "server-only";

import { activeUserWhere } from "@/lib/activeUsers";
import { JOB_ACCESS_SOURCES, setJobAccess } from "@/lib/jobAccess";
import { normalizeListContextForLookup } from "@/lib/jobListContext";
import { prisma } from "@/lib/prisma";
import { canAutoAddJobAccessForJobType, hasJobTypeVisibility } from "@/lib/permissionCatalog";
import { isAdmin } from "@/lib/auth";
import {
  getEffectivePermissionsForUser,
  isDeveloperPermissionEmail,
  type EffectivePermissionDetails,
} from "@/lib/permissions";

export type JobTypeAccessImpactUser = {
  email: string;
  name: string | null;
  role: string | null;
  source: string;
};

export type JobTypeAccessImpact = {
  autoRemoved: JobTypeAccessImpactUser[];
  autoAdded: JobTypeAccessImpactUser[];
  manualMismatches: JobTypeAccessImpactUser[];
  editorWouldLoseAccess: boolean;
};

export function shouldAutoAddUserToJob(params: {
  details: Pick<EffectivePermissionDetails, "permissions" | "isDeveloper" | "isSuperAdmin">;
  isServiceJob: boolean;
}): boolean {
  const { details, isServiceJob } = params;
  if (details.isDeveloper || details.isSuperAdmin) return false;
  return canAutoAddJobAccessForJobType(details.permissions, isServiceJob);
}

export async function autoAddEligibleUsersToJob(params: {
  jobNumber: string;
  listNumber?: string | null;
  isServiceJob: boolean;
}): Promise<string[]> {
  const normalizedJobNumber = params.jobNumber.trim();
  if (!normalizedJobNumber) return [];

  const listNumber = normalizeListContextForLookup(params.listNumber);
  const users = await prisma.user.findMany({
    where: activeUserWhere,
    select: {
      id: true,
      email: true,
      role: true,
      isSuperAdmin: true,
    },
  });

  const grantedEmails: string[] = [];
  for (const user of users) {
    if (isDeveloperPermissionEmail(user.email) || user.isSuperAdmin) continue;

    const details = await getEffectivePermissionsForUser(user);
    if (!shouldAutoAddUserToJob({ details, isServiceJob: params.isServiceJob })) {
      continue;
    }

    const email = user.email.trim().toLowerCase();
    await setJobAccess(
      normalizedJobNumber,
      email,
      listNumber,
      JOB_ACCESS_SOURCES.AUTO_ALL_JOBS,
    );
    grantedEmails.push(email);
  }

  return grantedEmails;
}

export async function backfillAutoAddForAllJobs(): Promise<{
  jobListsProcessed: number;
  grantsCreated: number;
}> {
  const [deliveries, accessRows] = await Promise.all([
    prisma.delivery.findMany({
      select: { jobNumber: true, listNumber: true, isServiceJob: true },
    }),
    prisma.jobAccess.findMany({
      select: { jobNumber: true, listNumber: true },
      distinct: ["jobNumber", "listNumber"],
    }),
  ]);

  const jobLists = new Map<string, { jobNumber: string; listNumber: string; isServiceJob: boolean }>();
  for (const row of deliveries) {
    const key = `${row.jobNumber}\0${row.listNumber}`;
    jobLists.set(key, {
      jobNumber: row.jobNumber,
      listNumber: row.listNumber,
      isServiceJob: row.isServiceJob,
    });
  }
  for (const row of accessRows) {
    const key = `${row.jobNumber}\0${row.listNumber}`;
    if (!jobLists.has(key)) {
      jobLists.set(key, {
        jobNumber: row.jobNumber,
        listNumber: row.listNumber,
        isServiceJob: false,
      });
    }
  }

  let grantsCreated = 0;
  for (const entry of jobLists.values()) {
    const granted = await autoAddEligibleUsersToJob({
      jobNumber: entry.jobNumber,
      listNumber: entry.listNumber,
      isServiceJob: entry.isServiceJob,
    });
    grantsCreated += granted.length;
  }

  return {
    jobListsProcessed: jobLists.size,
    grantsCreated,
  };
}

function canViewJobTypeFromDetails(
  details: Pick<EffectivePermissionDetails, "permissions" | "isDeveloper" | "isSuperAdmin">,
  isServiceJob: boolean,
): boolean {
  if (details.isDeveloper || details.isSuperAdmin) return true;
  if (!hasJobTypeVisibility(details.permissions)) return false;
  return isServiceJob
    ? details.permissions["jobs.view_service_jobs"] === true
    : details.permissions["jobs.view_contract_jobs"] === true;
}

export async function computeJobTypeAccessImpact(params: {
  jobNumber: string;
  listNumber?: string | null;
  isServiceJob: boolean;
  editorEmail?: string | null;
}): Promise<JobTypeAccessImpact> {
  const normalizedJobNumber = params.jobNumber.trim();
  const listNumber = normalizeListContextForLookup(params.listNumber);
  const editorEmail = params.editorEmail?.trim().toLowerCase() || null;

  const [accessRows, users] = await Promise.all([
    prisma.jobAccess.findMany({
      where: { jobNumber: normalizedJobNumber, listNumber },
      select: { userEmail: true, source: true },
    }),
    prisma.user.findMany({
      where: activeUserWhere,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isSuperAdmin: true,
      },
    }),
  ]);

  const usersByEmail = new Map(users.map((user) => [user.email.trim().toLowerCase(), user]));
  const accessEmails = new Set(accessRows.map((row) => row.userEmail.trim().toLowerCase()));
  const detailsByEmail = new Map<string, EffectivePermissionDetails>();

  const getDetails = async (email: string) => {
    const normalized = email.trim().toLowerCase();
    const cached = detailsByEmail.get(normalized);
    if (cached) return cached;
    const user = usersByEmail.get(normalized);
    if (!user) return null;
    const details = await getEffectivePermissionsForUser(user);
    detailsByEmail.set(normalized, details);
    return details;
  };

  const serialize = (email: string, source: string): JobTypeAccessImpactUser => {
    const user = usersByEmail.get(email.trim().toLowerCase());
    return {
      email: email.trim().toLowerCase(),
      name: user?.name || null,
      role: user?.role || null,
      source,
    };
  };

  const autoRemoved: JobTypeAccessImpactUser[] = [];
  const manualMismatches: JobTypeAccessImpactUser[] = [];

  for (const row of accessRows) {
    const email = row.userEmail.trim().toLowerCase();
    const source = row.source || JOB_ACCESS_SOURCES.MANUAL;
    const user = usersByEmail.get(email);
    if (!user) continue;

    const details = await getDetails(email);
    if (!details) continue;

    if (source === JOB_ACCESS_SOURCES.AUTO_ALL_JOBS) {
      if (!shouldAutoAddUserToJob({ details, isServiceJob: params.isServiceJob })) {
        autoRemoved.push(serialize(email, source));
      }
      continue;
    }

    if (
      email !== editorEmail &&
      !isAdmin(user.role) &&
      !details.isDeveloper &&
      !details.isSuperAdmin &&
      !canViewJobTypeFromDetails(details, params.isServiceJob)
    ) {
      manualMismatches.push(serialize(email, source));
    }
  }

  const autoAdded: JobTypeAccessImpactUser[] = [];
  for (const user of users) {
    const email = user.email.trim().toLowerCase();
    if (accessEmails.has(email)) continue;
    if (isDeveloperPermissionEmail(user.email) || user.isSuperAdmin) continue;

    const details = await getDetails(email);
    if (!details) continue;
    if (shouldAutoAddUserToJob({ details, isServiceJob: params.isServiceJob })) {
      autoAdded.push(serialize(email, JOB_ACCESS_SOURCES.AUTO_ALL_JOBS));
    }
  }

  let editorWouldLoseAccess = false;
  if (editorEmail) {
    const editor = usersByEmail.get(editorEmail);
    if (!editor) {
      editorWouldLoseAccess = true;
    } else if (!isAdmin(editor.role)) {
      const details = await getDetails(editorEmail);
      editorWouldLoseAccess = details
        ? !details.isDeveloper &&
          !details.isSuperAdmin &&
          !canViewJobTypeFromDetails(details, params.isServiceJob)
        : true;
    }
  }

  return {
    autoRemoved,
    autoAdded,
    manualMismatches,
    editorWouldLoseAccess,
  };
}

export async function applyJobTypeAccessRebalance(params: {
  jobNumber: string;
  listNumber?: string | null;
  impact: Pick<JobTypeAccessImpact, "autoRemoved" | "autoAdded">;
}): Promise<void> {
  const normalizedJobNumber = params.jobNumber.trim();
  const listNumber = normalizeListContextForLookup(params.listNumber);

  if (params.impact.autoRemoved.length > 0) {
    await prisma.$transaction(
      params.impact.autoRemoved.map((entry) =>
        prisma.jobAccess.deleteMany({
          where: {
            jobNumber: normalizedJobNumber,
            listNumber,
            userEmail: entry.email,
            source: JOB_ACCESS_SOURCES.AUTO_ALL_JOBS,
          },
        }),
      ),
    );
  }

  for (const entry of params.impact.autoAdded) {
    await setJobAccess(
      normalizedJobNumber,
      entry.email,
      listNumber,
      JOB_ACCESS_SOURCES.AUTO_ALL_JOBS,
    );
  }
}
