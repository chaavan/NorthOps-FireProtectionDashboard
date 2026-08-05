export function isEstimateTabEnabled() {
  return process.env.NEXT_PUBLIC_ENABLE_ESTIMATE_TAB === "true";
}

/** Job pre-order tab, Overview column, and pool logic. Enabled unless explicitly set to "false". */
export function isJobPreorderEnabled() {
  return process.env.NEXT_PUBLIC_ENABLE_JOB_PREORDER !== "false";
}

/**
 * CRM module: the /crm route, its sidebar entry, and /api/crm/*. Enabled unless
 * explicitly set to "false" — a deployment that does not want a CRM opts out.
 *
 * Enforced in three places: proxy.ts (redirect/404 before auth), the crm.* guard
 * in lib/crm/crmAccess.ts (so the gate survives proxy changes), and the sidebar.
 * Access is additionally gated by the crm.view permission.
 *
 * NEXT_PUBLIC_* is inlined at build time, so flipping this needs a rebuild.
 */
export function isCrmEnabled() {
  return process.env.NEXT_PUBLIC_ENABLE_CRM !== "false";
}

/**
 * Inventory replenishment suggests an order-up-to quantity — how far below the
 * reorder point stock has fallen, less demand already committed to open jobs —
 * instead of a flat Order Min. Off unless "true". See lib/inventoryReorder.ts.
 */
export function isDynamicReorderEnabled() {
  return process.env.NEXT_PUBLIC_ENABLE_DYNAMIC_REORDER === "true";
}
