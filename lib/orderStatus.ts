/**
 * Helper functions for determining order/receive status at the line and job level.
 * Used by the Pending to Receive API and related admin order flows.
 */

export interface JobLineForStatus {
  jobNumber: string;
  listNumber: string | null;
  partNumber: string;
  ordered: boolean | null;
  quantityOrdered: number | null;
  quantityReceivedFromOrder: number | null;
  receivedFromOrder: boolean | null;
  pickupFromSupplier: boolean | null;
  supplierDeliveryToJobsite: boolean | null;
  /** True when the line has been marked as delivered (Delivery tab "Mark as Delivered") */
  delivered?: boolean | null;
}

/**
 * Returns true if the line is fully received from the vendor.
 * Uses quantityOrderedFromPO when provided (from PurchaseOrder aggregation), otherwise falls back to line.quantityOrdered.
 */
export function isLineFullyReceived(
  line: JobLineForStatus,
  quantityOrderedFromPO?: number | null
): boolean {
  const quantityOrdered = quantityOrderedFromPO ?? line.quantityOrdered ?? null;
  const quantityReceived = line.quantityReceivedFromOrder ?? 0;

  if (quantityOrdered === null || quantityOrdered === undefined) {
    return line.receivedFromOrder === true;
  }
  return quantityReceived >= quantityOrdered;
}

/**
 * Returns true if the line is fully received and transit is considered complete.
 * For our purposes: once fully received, the item is in hand / at jobsite, so transit is done.
 */
export function isLineDelivered(
  line: JobLineForStatus,
  quantityOrderedFromPO?: number | null
): boolean {
  return isLineFullyReceived(line, quantityOrderedFromPO);
}

/**
 * Returns true if the line is effectively closed (no longer an outstanding vendor order).
 * Cancelled, not ordered, or zero quantity ordered.
 */
export function isLineClosed(line: JobLineForStatus): boolean {
  if (line.ordered !== true) return true;
  const qtyOrdered = line.quantityOrdered ?? 0;
  return qtyOrdered <= 0;
}

/**
 * Returns true when ALL vendor-ordered lines for the job have been marked as delivered
 * (Delivery tab "Mark as Delivered"). Items stay in Pending to Receive until then,
 * even when fully received from the vendor, so the user can revert if needed.
 */
export function isJobFullyDelivered(
  jobLines: JobLineForStatus[],
  getQuantityOrderedFromPO: (jobNumber: string, listNumber: string | null, partNumber: string) => number | null,
  isInPurchaseOrder: (jobNumber: string, listNumber: string | null, partNumber: string) => boolean
): boolean {
  if (jobLines.length === 0) return true;

  for (const line of jobLines) {
    if (!isInPurchaseOrder(line.jobNumber, line.listNumber, line.partNumber)) continue;
    if (isLineClosed(line)) continue;
    const qtyFromPO = getQuantityOrderedFromPO(line.jobNumber, line.listNumber, line.partNumber);
    const qtyOrdered = qtyFromPO ?? line.quantityOrdered ?? 0;
    if (qtyOrdered <= 0) continue;
    // Job leaves Pending to Receive only when every vendor line has been marked delivered
    if (line.delivered !== true) return false;
  }
  return true;
}
