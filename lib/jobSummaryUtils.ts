import type { JobLineItem } from "./types";
import { getRemainingQty, getVendorReceivedForRemaining, toNonNegativeInt } from "./quantityMath";

export type LineFilter = "all" | "pulled" | "ordered" | "remaining" | "fab";

/**
 * Live job pre-order overrides for a single line item.
 * Only pulled-from-pool qty affects remaining; open pipeline qty is informational.
 */
export type PreorderTotalsForItem = {
  /** Qty this list line has pulled from the job received pre-order pool. */
  pulled?: number;
  /** Job-wide qty still on order (not received) — does not reduce remaining. */
  open?: number;
};

export function isOrdered(item: JobLineItem): boolean {
  if (typeof item.ordered === "string") {
    return item.ordered.toLowerCase() === "yes";
  }
  return item.ordered === true;
}

export function isReceived(item: JobLineItem): boolean {
  if (typeof item.receivedFromOrder === "string") {
    return item.receivedFromOrder.toLowerCase() === "yes";
  }
  return item.receivedFromOrder === true;
}

export function isBackordered(item: JobLineItem): boolean {
  return isOrdered(item) && !isReceived(item);
}

function getJobPreorderPulled(
  item: JobLineItem,
  preorder?: PreorderTotalsForItem,
): number {
  if (preorder?.pulled !== undefined) {
    return toNonNegativeInt(preorder.pulled);
  }
  return toNonNegativeInt(item.quantityPulledFromPreorder ?? item.quantityPreordered);
}

function getVendorCommitted(item: JobLineItem): number {
  return getVendorReceivedForRemaining(item.quantityReceivedFromOrder);
}

export function isPickupTransitPending(item: JobLineItem): boolean {
  return (
    isOrdered(item) &&
    !isReceived(item) &&
    item.pickupFromSupplier === true
  );
}

export function isDeliveryTransitPending(item: JobLineItem): boolean {
  return (
    isOrdered(item) &&
    !isReceived(item) &&
    item.supplierDeliveryToJobsite === true
  );
}

/**
 * Remaining qty considering all ways a row can be taken care of:
 * FAB, shop pulls, vendor RECEIVED qty, and job pre-orders RECEIVED qty.
 * When `preorder` overrides aren't supplied, falls back to the static
 * `item.quantityPreordered` field.
 */
export function getRemainingForItem(
  item: JobLineItem,
  preorder?: PreorderTotalsForItem,
): number {
  const jobPo = getJobPreorderPulled(item, preorder);
  return getRemainingQty({
    needed: item.quantityNeeded,
    fab: item.quantityFab,
    shop: item.quantityPulled,
    preorder: jobPo,
    vendor: getVendorCommitted(item),
  });
}

export function isTakenCareOf(
  item: JobLineItem,
  preorder?: PreorderTotalsForItem,
): boolean {
  return (
    toNonNegativeInt(item.quantityNeeded) > 0 &&
    getRemainingForItem(item, preorder) <= 0
  );
}

/** Fully pulled = shop + RECEIVED job pre-order + vendor receipts ≥ needed. */
export function isFullyPulled(
  item: JobLineItem,
  preorder?: PreorderTotalsForItem,
): boolean {
  const needed = toNonNegativeInt(item.quantityNeeded);
  const shopPulled = toNonNegativeInt(item.quantityPulled);
  const receivedJobPo = getJobPreorderPulled(item, preorder);
  const vendorPulled = toNonNegativeInt(item.quantityReceivedFromOrder);
  return shopPulled + receivedJobPo + vendorPulled >= needed && needed > 0;
}

/** Any qty has been physically pulled from the shop. */
export function hasShopPull(item: JobLineItem): boolean {
  return toNonNegativeInt(item.quantityPulled) > 0;
}

/** True when there is an OPEN (non-cancelled, not yet received) job pre-order line. */
export function hasOpenJobPreorder(preorder?: PreorderTotalsForItem): boolean {
  return toNonNegativeInt(preorder?.open) > 0;
}

/** Combined "ordered" predicate: vendor PO marked ordered OR an open job pre-order exists. */
export function isOrderedOrPreordered(
  item: JobLineItem,
  preorder?: PreorderTotalsForItem,
): boolean {
  return isOrdered(item) || hasOpenJobPreorder(preorder);
}

export function hasFab(item: JobLineItem): boolean {
  const fab = toNonNegativeInt(item.quantityFab);
  return fab > 0;
}
