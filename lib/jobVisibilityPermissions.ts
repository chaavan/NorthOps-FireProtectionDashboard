import "server-only";

import { prisma } from "@/lib/prisma";
import type { EffectivePermissionDetails } from "@/lib/permissions";

export type JobVisibilityPermissions = {
  canViewJobs: boolean;
  canViewContractJobs: boolean;
  canViewServiceJobs: boolean;
};

export function getJobVisibilityPermissions(
  details: EffectivePermissionDetails | null,
): JobVisibilityPermissions {
  const hasAll = details?.isDeveloper === true || details?.isSuperAdmin === true;
  const canViewContractJobs =
    hasAll || details?.permissions["jobs.view_contract_jobs"] === true;
  const canViewServiceJobs =
    hasAll || details?.permissions["jobs.view_service_jobs"] === true;
  return {
    canViewJobs:
      hasAll ||
      details?.permissions["jobs.view"] === true ||
      canViewContractJobs ||
      canViewServiceJobs,
    canViewContractJobs,
    canViewServiceJobs,
  };
}

export function canAccessJobLists(visibility: JobVisibilityPermissions): boolean {
  return (
    visibility.canViewJobs &&
    (visibility.canViewContractJobs || visibility.canViewServiceJobs)
  );
}

export function canViewJobType(
  visibility: JobVisibilityPermissions,
  isServiceJob: boolean,
): boolean {
  if (!visibility.canViewJobs) return false;
  return isServiceJob
    ? visibility.canViewServiceJobs
    : visibility.canViewContractJobs;
}

export async function getJobListTypeMap(
  jobNumbers: string[],
): Promise<Map<string, { hasContract: boolean; hasService: boolean }>> {
  const normalizedJobNumbers = Array.from(
    new Set(jobNumbers.map((jobNumber) => jobNumber.trim()).filter(Boolean)),
  );
  const typeMap = new Map<string, { hasContract: boolean; hasService: boolean }>();
  if (normalizedJobNumbers.length === 0) return typeMap;

  const deliveries = await prisma.delivery.findMany({
    where: { jobNumber: { in: normalizedJobNumbers } },
    select: { jobNumber: true, isServiceJob: true },
  });

  for (const delivery of deliveries) {
    const current =
      typeMap.get(delivery.jobNumber) ?? { hasContract: false, hasService: false };
    if (delivery.isServiceJob) {
      current.hasService = true;
    } else {
      current.hasContract = true;
    }
    typeMap.set(delivery.jobNumber, current);
  }

  for (const jobNumber of normalizedJobNumbers) {
    if (!typeMap.has(jobNumber)) {
      typeMap.set(jobNumber, { hasContract: true, hasService: false });
    }
  }

  return typeMap;
}

export async function canViewJobByNumber(params: {
  jobNumber: string;
  listNumber?: string | null;
  visibility: JobVisibilityPermissions;
}): Promise<boolean> {
  const { jobNumber, listNumber, visibility } = params;
  if (!visibility.canViewJobs) return false;

  const normalizedJobNumber = jobNumber.trim();
  const normalizedListNumber = listNumber?.trim();
  if (normalizedListNumber) {
    const delivery = await prisma.delivery.findFirst({
      where: {
        jobNumber: normalizedJobNumber,
        listNumber: normalizedListNumber,
      },
      select: { isServiceJob: true },
    });

    return canViewJobType(visibility, delivery?.isServiceJob === true);
  }

  const deliveries = await prisma.delivery.findMany({
    where: { jobNumber: normalizedJobNumber },
    select: { isServiceJob: true },
  });

  if (deliveries.length === 0) {
    return canViewJobType(visibility, false);
  }

  const hasDeniedList = deliveries.some(
    (delivery) => !canViewJobType(visibility, delivery.isServiceJob === true),
  );
  if (hasDeniedList) return false;

  return true;
}
