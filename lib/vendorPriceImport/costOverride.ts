import { Prisma } from '@prisma/client';
import { catalogCostsEqual } from '@/lib/partCostLedger';
import { computePercentChange } from './percentChange';

export function normalizeImportCost(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error('Price must be a non-negative number.');
  }
  return Math.round(num * 100) / 100;
}

export function isManuallyAdjustedCost(
  proposedCost: number,
  costAfter: number | null | undefined,
): boolean {
  if (costAfter === null || costAfter === undefined) return false;
  return !catalogCostsEqual(proposedCost, costAfter);
}

export type MatchedLineCostFields = {
  matchStatus: 'MATCHED' | 'NO_COST_CHANGE';
  costBefore: Prisma.Decimal;
  costAfter: Prisma.Decimal;
  percentChange: Prisma.Decimal | null;
  selected: boolean;
};

export function applyCostAfterForPart(
  part: { id: string; cost: Prisma.Decimal },
  costAfterValue: number,
): MatchedLineCostFields {
  const costBefore = part.cost;
  const costAfter = new Prisma.Decimal(normalizeImportCost(costAfterValue));

  if (catalogCostsEqual(costBefore, costAfter)) {
    return {
      matchStatus: 'NO_COST_CHANGE',
      costBefore,
      costAfter,
      percentChange: null,
      selected: false,
    };
  }

  const pct = computePercentChange(Number(costBefore), Number(costAfter));
  return {
    matchStatus: 'MATCHED',
    costBefore,
    costAfter,
    percentChange: pct === null ? null : new Prisma.Decimal(pct),
    selected: true,
  };
}
