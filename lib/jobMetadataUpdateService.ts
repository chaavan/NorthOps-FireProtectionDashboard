import { prisma } from '@/lib/prisma';
import { cache, cacheKeys } from '@/lib/cache';
import { updateDeliveryRecord } from '@/lib/deliveryDatabase';
import { normalizeListNumber } from '@/lib/jobListContext';
import { parseDateInputInAppTimeZone } from '@/lib/timezone';

type ExistingJobMetadataUpdateInput = {
  jobNumber: string;
  listNumber: string;
  area?: string | null;
  locationShipTo?: string | null;
  stocklistDeliveryShipDate?: string | null;
  listedBy?: string | null;
  deliveryDate?: string | null;
};

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

export async function updateExistingJobMetadata(
  input: ExistingJobMetadataUpdateInput,
): Promise<void> {
  const jobNumber = input.jobNumber.trim();
  const listNumber = normalizeListNumber(input.listNumber);
  const parsedStocklistDate = input.stocklistDeliveryShipDate
    ? parseDateInputInAppTimeZone(input.stocklistDeliveryShipDate)
    : null;
  const parsedDeliveryDate = input.deliveryDate
    ? parseDateInputInAppTimeZone(input.deliveryDate)
    : null;

  if (input.stocklistDeliveryShipDate && !parsedStocklistDate) {
    throw new Error('Invalid stocklistDeliveryShipDate format.');
  }
  if (input.deliveryDate && !parsedDeliveryDate) {
    throw new Error('Invalid deliveryDate format.');
  }

  await prisma.job.updateMany({
    where: {
      jobNumber,
      listNumber,
    },
    data: {
      area: trimOrNull(input.area),
      locationShipTo: trimOrNull(input.locationShipTo),
      stocklistDeliveryShipDate: parsedStocklistDate,
      listedBy: trimOrNull(input.listedBy),
      ...(parsedDeliveryDate ? { deliveryDate: parsedDeliveryDate } : {}),
      updatedAt: new Date(),
    },
  });

  try {
    await updateDeliveryRecord(
      jobNumber,
      {
        address: trimOrNull(input.locationShipTo),
        jobArea: trimOrNull(input.area),
        ...(parsedDeliveryDate ? { date: input.deliveryDate! } : {}),
      },
      listNumber,
    );
  } catch (error) {
    console.error('Error updating delivery record from import metadata sync:', error);
  }

  cache.delete(cacheKeys.jobDetails(jobNumber, listNumber));
  cache.delete(cacheKeys.jobsList());
  cache.delete(cacheKeys.calendar());
  cache.delete(cacheKeys.delivery(jobNumber, listNumber));
}
