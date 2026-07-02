import { prisma } from '@/lib/prisma';
import { NO_PARTS_PLACEHOLDER_PART_NUMBER } from '@/lib/jobImportConstants';

type CanonicalJobListDate = {
  jobNumber: string;
  listNumber: string;
  deliveryDate: Date;
  listedBy: string | null;
};

type CanonicalJobListMetadata = CanonicalJobListDate & {
  jobName: string;
  area: string | null;
  partNumber: string;
};

export function getJobListDeliveryDateKey(jobNumber: string, listNumber: string | null): string {
  const normalizedListNumber = listNumber?.trim() || '1';
  return `${jobNumber.trim()}|${normalizedListNumber}`;
}

/**
 * The Edit Job modal and calendar should agree on a single delivery date for a
 * job/list, even if legacy rows temporarily disagree.
 */
export async function getCanonicalJobListDate(
  jobNumber: string,
  listNumber: string,
  partNumber?: string | null,
): Promise<CanonicalJobListDate | null> {
  const normalizedJobNumber = jobNumber.trim();
  const normalizedListNumber = listNumber.trim() || '1';
  const normalizedPartNumber = partNumber?.trim();

  if (!normalizedJobNumber) return null;

  return await prisma.job.findFirst({
    where: {
      jobNumber: normalizedJobNumber,
      listNumber: normalizedListNumber,
      ...(normalizedPartNumber ? { partNumber: normalizedPartNumber } : {}),
    },
    orderBy: [{ lineOrder: 'asc' }, { partNumber: 'asc' }],
    select: {
      jobNumber: true,
      listNumber: true,
      deliveryDate: true,
      listedBy: true,
    },
  });
}

export async function getCanonicalDeliveryDate(
  jobNumber: string,
  listNumber: string,
): Promise<Date | null> {
  const jobDate = await getCanonicalJobListDate(jobNumber, listNumber);
  return jobDate?.deliveryDate ?? null;
}

export async function getCanonicalDeliveryDateMap(): Promise<Map<string, Date>> {
  const rows = await prisma.job.findMany({
    orderBy: [
      { jobNumber: 'asc' },
      { listNumber: 'asc' },
      { lineOrder: 'asc' },
      { partNumber: 'asc' },
    ],
    select: {
      jobNumber: true,
      listNumber: true,
      deliveryDate: true,
      partNumber: true,
    },
  });

  const datesByJobList = new Map<string, Date>();
  for (const row of rows) {
    const key = getJobListDeliveryDateKey(row.jobNumber, row.listNumber);
    if (row.partNumber !== NO_PARTS_PLACEHOLDER_PART_NUMBER && !datesByJobList.has(key)) {
      datesByJobList.set(key, row.deliveryDate);
    }
  }

  for (const row of rows) {
    const key = getJobListDeliveryDateKey(row.jobNumber, row.listNumber);
    if (!datesByJobList.has(key)) {
      datesByJobList.set(key, row.deliveryDate);
    }
  }

  return datesByJobList;
}

export async function getCanonicalJobListMetadata(
  jobNumber: string,
  listNumber: string,
): Promise<CanonicalJobListMetadata | null> {
  const normalizedJobNumber = jobNumber.trim();
  const normalizedListNumber = listNumber.trim() || '1';

  if (!normalizedJobNumber) return null;

  const select = {
    jobNumber: true,
    listNumber: true,
    deliveryDate: true,
    listedBy: true,
    jobName: true,
    area: true,
    partNumber: true,
  } as const;

  const realRow = await prisma.job.findFirst({
    where: {
      jobNumber: normalizedJobNumber,
      listNumber: normalizedListNumber,
      partNumber: { not: NO_PARTS_PLACEHOLDER_PART_NUMBER },
    },
    orderBy: [{ lineOrder: 'asc' }, { partNumber: 'asc' }],
    select,
  });

  if (realRow) return realRow;

  return await prisma.job.findFirst({
    where: {
      jobNumber: normalizedJobNumber,
      listNumber: normalizedListNumber,
    },
    orderBy: [{ lineOrder: 'asc' }, { partNumber: 'asc' }],
    select,
  });
}

export async function getCanonicalJobListMetadataMap(): Promise<Map<string, CanonicalJobListMetadata>> {
  const rows = await prisma.job.findMany({
    orderBy: [
      { jobNumber: 'asc' },
      { listNumber: 'asc' },
      { lineOrder: 'asc' },
      { partNumber: 'asc' },
    ],
    select: {
      jobNumber: true,
      listNumber: true,
      deliveryDate: true,
      listedBy: true,
      jobName: true,
      area: true,
      partNumber: true,
    },
  });

  const metadataByJobList = new Map<string, CanonicalJobListMetadata>();
  for (const row of rows) {
    const key = getJobListDeliveryDateKey(row.jobNumber, row.listNumber);
    if (row.partNumber !== NO_PARTS_PLACEHOLDER_PART_NUMBER && !metadataByJobList.has(key)) {
      metadataByJobList.set(key, row);
    }
  }

  for (const row of rows) {
    const key = getJobListDeliveryDateKey(row.jobNumber, row.listNumber);
    if (!metadataByJobList.has(key)) {
      metadataByJobList.set(key, row);
    }
  }

  return metadataByJobList;
}
