import { prisma } from "@/lib/prisma";
import type {
  EstimateLookupCategory,
  EstimateLookupOptionRecord,
} from "@/lib/estimateTypes";
import { ESTIMATE_LOOKUP_CATEGORIES } from "@/lib/estimate/estimateMetadata";

export function normalizeLookupKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeLookupLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function isEstimateLookupCategory(value: string): value is EstimateLookupCategory {
  return ESTIMATE_LOOKUP_CATEGORIES.includes(value as EstimateLookupCategory);
}

function serializeLookupOption(record: {
  id: string;
  category: string;
  label: string;
  normalizedKey: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: Date;
}): EstimateLookupOptionRecord {
  return {
    id: record.id,
    category: record.category as EstimateLookupCategory,
    label: record.label,
    normalizedKey: record.normalizedKey,
    isActive: record.isActive,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
  };
}

export async function listEstimateLookupOptions(params: {
  category: EstimateLookupCategory;
}): Promise<EstimateLookupOptionRecord[]> {
  const records = await prisma.estimateLookupOption.findMany({
    where: {
      category: params.category,
      isActive: true,
    },
    orderBy: [{ label: "asc" }],
  });
  return records.map(serializeLookupOption);
}

export async function createEstimateLookupOption(params: {
  category: EstimateLookupCategory;
  label: string;
  createdBy?: string | null;
}): Promise<EstimateLookupOptionRecord> {
  const label = normalizeLookupLabel(params.label);
  if (!label) {
    throw new Error("Label is required.");
  }

  const normalizedKey = normalizeLookupKey(label);
  const existing = await prisma.estimateLookupOption.findUnique({
    where: {
      category_normalizedKey: {
        category: params.category,
        normalizedKey,
      },
    },
  });

  if (existing) {
    if (!existing.isActive) {
      const reactivated = await prisma.estimateLookupOption.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          label,
          createdBy: params.createdBy ?? existing.createdBy,
        },
      });
      return serializeLookupOption(reactivated);
    }
    return serializeLookupOption(existing);
  }

  const created = await prisma.estimateLookupOption.create({
    data: {
      category: params.category,
      label,
      normalizedKey,
      createdBy: params.createdBy ?? null,
    },
  });
  return serializeLookupOption(created);
}

export async function getEstimateLookupOptionsByIds(
  ids: string[],
): Promise<Map<string, EstimateLookupOptionRecord>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const records = await prisma.estimateLookupOption.findMany({
    where: { id: { in: uniqueIds } },
  });

  return new Map(records.map((record) => [record.id, serializeLookupOption(record)]));
}
