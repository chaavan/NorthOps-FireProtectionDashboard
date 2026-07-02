export function isEstimateTabEnabled() {
  return process.env.NEXT_PUBLIC_ENABLE_ESTIMATE_TAB === "true";
}

/** Job pre-order tab, Overview column, and pool logic. Enabled unless explicitly set to "false". */
export function isJobPreorderEnabled() {
  return process.env.NEXT_PUBLIC_ENABLE_JOB_PREORDER !== "false";
}
