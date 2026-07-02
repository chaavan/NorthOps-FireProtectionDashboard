import assert from "node:assert/strict";
import { resolveEstimateEditorPermissions } from "../components/estimate/EstimateEditorPermissionsContext";
import type { PermissionKey } from "../lib/permissionCatalog";

function hasOnly(allowed: PermissionKey[]) {
  const allowedSet = new Set(allowed);
  return (key: PermissionKey) => allowedSet.has(key);
}

const viewOnly = resolveEstimateEditorPermissions(
  hasOnly(["estimates.view"]),
);
assert.equal(viewOnly.canEditInfo, false);
assert.equal(viewOnly.canEditWorkbook, false);
assert.equal(viewOnly.canEditPricing, false);
assert.equal(viewOnly.canChangeStatus, false);
assert.equal(viewOnly.canGeneratePdf, false);
assert.equal(viewOnly.canManageVariants, false);

const infoOnly = resolveEstimateEditorPermissions(
  hasOnly(["estimates.view", "estimates.edit_info"]),
);
assert.equal(infoOnly.canEditInfo, true);
assert.equal(infoOnly.canEditWorkbook, false);

const pricingOnly = resolveEstimateEditorPermissions(
  hasOnly(["estimates.view", "estimates.pricing_controls.edit"]),
);
assert.equal(pricingOnly.canEditPricing, true);
assert.equal(pricingOnly.canEditWorkbook, false);

const workbookOnly = resolveEstimateEditorPermissions(
  hasOnly(["estimates.view", "estimates.edit"]),
);
assert.equal(workbookOnly.canEditWorkbook, true);
assert.equal(workbookOnly.canEditPricing, false);

console.log("Estimate UI permission checks passed.");
