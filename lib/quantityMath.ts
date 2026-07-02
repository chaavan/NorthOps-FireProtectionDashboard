import { isJobPreorderEnabled } from "@/lib/featureFlags";

export type RemainingQuantityInput = {
  needed?: number | null;
  fab?: number | null;
  shop?: number | null;
  preorder?: number | null;
  vendor?: number | null;
};

export function toNonNegativeInt(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

export function clampFab(
  fab: number | null | undefined,
  needed: number | null | undefined,
): number {
  const normalizedNeeded = toNonNegativeInt(needed);
  const normalizedFab = toNonNegativeInt(fab);
  return Math.min(normalizedFab, normalizedNeeded);
}

export function getRemainingQty(input: RemainingQuantityInput): number {
  const needed = toNonNegativeInt(input.needed);
  const fab = clampFab(input.fab, needed);
  const shop = toNonNegativeInt(input.shop);
  const preorder = isJobPreorderEnabled()
    ? toNonNegativeInt(input.preorder)
    : 0;
  const vendor = toNonNegativeInt(input.vendor);
  return Math.max(0, needed - fab - shop - preorder - vendor);
}

/**
 * Vendor qty that counts against remaining: only what has actually been received
 * (`quantityReceivedFromOrder`), not the full open order qty.
 * Partial 29/30 → 29; open 0/30 → 0; fully received 30/30 → 30.
 */
export function getVendorReceivedForRemaining(
  quantityReceivedFromOrder: number | null | undefined,
): number {
  return toNonNegativeInt(quantityReceivedFromOrder);
}

export function hasRemainingQty(input: RemainingQuantityInput): boolean {
  return getRemainingQty(input) > 0;
}

export function getEffectiveNeedBeforeOrdering(
  input: RemainingQuantityInput,
): number {
  return getRemainingQty(input);
}

/** Qty still to pull from shop after FAB, shop pulls, job pre-order, and vendor commitment. */
export function getShopPullNeededQty(input: {
  needed?: number | null;
  fab?: number | null;
  shop?: number | null;
  preorder?: number | null;
  vendorAllocation?: number | null;
}): number {
  const needed = toNonNegativeInt(input.needed);
  const fab = clampFab(input.fab, needed);
  const shop = toNonNegativeInt(input.shop);
  const preorder = isJobPreorderEnabled()
    ? toNonNegativeInt(input.preorder)
    : 0;
  const vendorAllocation = toNonNegativeInt(input.vendorAllocation);
  return Math.max(0, needed - fab - shop - preorder - vendorAllocation);
}
