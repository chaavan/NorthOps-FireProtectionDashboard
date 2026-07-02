import assert from "node:assert/strict";
import {
  ALL_PERMISSION_KEYS,
  LEGACY_PERMISSION_KEYS,
  IMPLIED_PERMISSION_KEYS,
  PERMISSION_HIERARCHY,
  canAccessJobDirectory,
  canAccessCalendar,
  getFirstAccessibleAppRoute,
  getPermissionLockReason,
  canAutoAddJobAccessForJobType,
  defaultRoleAllows,
  getHierarchyGroupKeys,
  applyImpliedPermissions,
} from "../lib/permissionCatalog";
import { applyRoleLockedPermissions } from "../lib/permissionCatalog";
import { resolvePermissionsFromTemplateAndOverrides } from "../lib/permissionResolution";

function allows(role: string, permissionKey: string) {
  return defaultRoleAllows(role).has(permissionKey as any);
}

assert.equal(allows("ADMIN", "users.permissions.edit"), true);
assert.equal(allows("ADMIN", "orders.generate_send"), true);
assert.equal(allows("ADMIN", "job_import.drafts.view_all"), true);
assert.equal(allows("ADMIN", "job_import.drafts.edit_others"), true);
assert.equal(allows("ADMIN", "job_import.hydratec_watchers.add"), true);
assert.equal(allows("PROJECT_MANAGER", "inventory.view"), true);
assert.equal(allows("PROJECT_MANAGER", "orders.view"), false);
assert.equal(allows("DESIGNER", "jobs.create"), true);
assert.equal(allows("DESIGNER", "job_import.upload"), true);
assert.equal(allows("DESIGNER", "job_import.drafts.view_own"), true);
assert.equal(allows("DESIGNER", "job_import.drafts.view_all"), false);
assert.equal(allows("DESIGNER", "inventory.view"), true);
assert.equal(allows("DESIGNER", "estimates.view"), false);
assert.equal(allows("SALES", "estimates.view"), true);
assert.equal(allows("SALES", "job.purchase_order.view"), false);
assert.equal(allows("VIEWER", "job.notes.view"), true);
assert.equal(allows("VIEWER", "job.puller.pull_from_shop"), false);
assert.equal(allows("VIEWER", "job.puller.order"), false);
assert.equal(allows("VIEWER", "job.puller.edit_line"), false);
assert.equal(allows("VIEWER", "jobs.view_contract_jobs"), true);
assert.equal(allows("EDITOR", "jobs.create"), true);
assert.equal(allows("EDITOR", "users.view"), false);

const blankTemplate = Object.fromEntries(
  ALL_PERMISSION_KEYS.map((key) => [key, false]),
) as Record<(typeof ALL_PERMISSION_KEYS)[number], boolean>;

const customRolePermissions = resolvePermissionsFromTemplateAndOverrides(
  blankTemplate,
  {},
);
assert.equal(customRolePermissions["users.view"], false);
assert.equal(customRolePermissions["jobs.view"], false);

const templateWithUsersView = {
  ...blankTemplate,
  "users.view": true,
};
const overrideWins = resolvePermissionsFromTemplateAndOverrides(templateWithUsersView, {
  "users.view": "DENY",
});
assert.equal(overrideWins["users.view"], false);

const overrideAllow = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "estimates.view": "ALLOW",
});
assert.equal(overrideAllow["estimates.view"], true);

const childWithoutParent = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "orders.cancel": "ALLOW",
});
assert.equal(childWithoutParent["orders.cancel"], false);

const childWithParent = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "orders.view": "ALLOW",
  "orders.pending.view": "ALLOW",
  "orders.mark_received": "ALLOW",
  "orders.cancel": "ALLOW",
});
assert.equal(childWithParent["orders.mark_received"], true);
assert.equal(childWithParent["orders.cancel"], true);

const pendingUpdatesWithoutVendorOrdersAccess = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "orders.pending.view": "ALLOW",
  "orders.mark_received": "ALLOW",
  "orders.mark_pickup": "ALLOW",
});
assert.equal(pendingUpdatesWithoutVendorOrdersAccess["orders.pending.view"], false);
assert.equal(pendingUpdatesWithoutVendorOrdersAccess["orders.mark_received"], false);
assert.equal(pendingUpdatesWithoutVendorOrdersAccess["orders.mark_pickup"], false);

const pendingUpdatesViewOnly = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "orders.view": "ALLOW",
  "orders.pending.view": "ALLOW",
});
assert.equal(pendingUpdatesViewOnly["orders.pending.view"], true);
assert.equal(pendingUpdatesViewOnly["orders.mark_received"], false);
assert.equal(pendingUpdatesViewOnly["orders.revert_received"], false);
assert.equal(pendingUpdatesViewOnly["orders.mark_pickup"], false);
assert.equal(pendingUpdatesViewOnly["orders.cancel"], false);

const pendingUpdatesWithVendorOrdersAccess = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "orders.view": "ALLOW",
  "orders.pending.view": "ALLOW",
  "orders.mark_received": "ALLOW",
  "orders.revert_received": "ALLOW",
  "orders.mark_pickup": "ALLOW",
  "orders.cancel": "DENY",
});
assert.equal(pendingUpdatesWithVendorOrdersAccess["orders.pending.view"], true);
assert.equal(pendingUpdatesWithVendorOrdersAccess["orders.mark_received"], true);
assert.equal(pendingUpdatesWithVendorOrdersAccess["orders.revert_received"], true);
assert.equal(pendingUpdatesWithVendorOrdersAccess["orders.mark_pickup"], true);
assert.equal(pendingUpdatesWithVendorOrdersAccess["orders.cancel"], false);

const vendorPriceCommitWithoutReview = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "inventory.view": "ALLOW",
  "inventory.vendor_prices.import": "ALLOW",
  "inventory.vendor_prices.commit": "ALLOW",
  "inventory.vendor_prices.discard": "ALLOW",
});
assert.equal(vendorPriceCommitWithoutReview["inventory.view"], true);
assert.equal(vendorPriceCommitWithoutReview["inventory.vendor_prices.import"], true);
assert.equal(vendorPriceCommitWithoutReview["inventory.vendor_prices.review"], false);
assert.equal(vendorPriceCommitWithoutReview["inventory.vendor_prices.commit"], false);
assert.equal(vendorPriceCommitWithoutReview["inventory.vendor_prices.discard"], false);

const vendorPriceActionsWithReview = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "inventory.view": "ALLOW",
  "inventory.vendor_prices.import": "ALLOW",
  "inventory.vendor_prices.review": "ALLOW",
  "inventory.vendor_prices.commit": "ALLOW",
  "inventory.vendor_prices.discard": "ALLOW",
});
assert.equal(vendorPriceActionsWithReview["inventory.vendor_prices.review"], true);
assert.equal(vendorPriceActionsWithReview["inventory.vendor_prices.commit"], true);
assert.equal(vendorPriceActionsWithReview["inventory.vendor_prices.discard"], true);

const inventoryLogsOn = applyImpliedPermissions({
  ...blankTemplate,
  "inventory.view": true,
  "inventory.logs.view": true,
});
assert.equal(inventoryLogsOn["inventory.logs.view"], true);
assert.equal(inventoryLogsOn["inventory.cost_history.view"], true);

const inventoryLogsOff = applyImpliedPermissions({
  ...blankTemplate,
  "inventory.view": true,
  "inventory.logs.view": false,
  "inventory.cost_history.view": true,
});
assert.equal(inventoryLogsOff["inventory.cost_history.view"], false);

const jobImportChildWithoutPage = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "job_import.upload": "ALLOW",
  "job_import.drafts.view_own": "ALLOW",
});
assert.equal(jobImportChildWithoutPage["job_import.upload"], false);
assert.equal(jobImportChildWithoutPage["job_import.drafts.view_own"], false);

const editOthersWithoutViewAll = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "job_import.view": "ALLOW",
  "job_import.drafts.view_own": "ALLOW",
  "job_import.drafts.edit_others": "ALLOW",
});
assert.equal(editOthersWithoutViewAll["job_import.drafts.view_own"], true);
assert.equal(editOthersWithoutViewAll["job_import.drafts.edit_others"], false);

const editOthersWithViewAll = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "job_import.view": "ALLOW",
  "job_import.drafts.view_own": "ALLOW",
  "job_import.drafts.view_all": "ALLOW",
  "job_import.drafts.edit_others": "ALLOW",
});
assert.equal(editOthersWithViewAll["job_import.drafts.view_all"], true);
assert.equal(editOthersWithViewAll["job_import.drafts.edit_others"], true);

const jobImportViewImpliesDrafts = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "job_import.view": "ALLOW",
});
assert.equal(jobImportViewImpliesDrafts["job_import.view"], true);
assert.equal(jobImportViewImpliesDrafts["job_import.drafts.view_own"], true);

const jobImportViewOverridesDraftsDeny = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "job_import.view": "ALLOW",
  "job_import.drafts.view_own": "DENY",
});
assert.equal(jobImportViewOverridesDraftsDeny["job_import.drafts.view_own"], true);

const notesAddImpliesEdit = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "jobs.view": "ALLOW",
  "job.notes.view": "ALLOW",
  "job.notes.add": "ALLOW",
});
assert.equal(notesAddImpliesEdit["job.notes.add"], true);
assert.equal(notesAddImpliesEdit["job.notes.edit"], true);

const notesAddOffClearsEdit = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "jobs.view": "ALLOW",
  "job.notes.view": "ALLOW",
  "job.notes.edit": "ALLOW",
});
assert.equal(notesAddOffClearsEdit["job.notes.edit"], false);

const contractJobsVisibility = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "jobs.view_contract_jobs": "ALLOW",
});
assert.equal(contractJobsVisibility["jobs.view"], true);
assert.equal(contractJobsVisibility["jobs.view_contract_jobs"], true);
assert.equal(canAccessJobDirectory(contractJobsVisibility), true);

const jobVisibilityOffWithScopes = applyImpliedPermissions({
  ...blankTemplate,
  "jobs.view": false,
  "jobs.view_contract_jobs": false,
  "jobs.view_service_jobs": false,
});
assert.equal(jobVisibilityOffWithScopes["jobs.view"], false);
assert.equal(jobVisibilityOffWithScopes["jobs.view_contract_jobs"], false);
assert.equal(jobVisibilityOffWithScopes["jobs.view_service_jobs"], false);
assert.equal(canAccessJobDirectory(jobVisibilityOffWithScopes), false);

const calendarWithoutJobs = {
  permissions: {
    ...blankTemplate,
    "calendar.view": true,
    "jobs.view": false,
    "jobs.view_contract_jobs": false,
    "jobs.view_service_jobs": false,
  },
};
assert.equal(canAccessCalendar(calendarWithoutJobs), false);
assert.equal(
  getFirstAccessibleAppRoute({
    permissions: {
      ...blankTemplate,
      "estimates.view": true,
    },
  }),
  "/estimates",
);
assert.equal(
  getFirstAccessibleAppRoute({
    permissions: {
      ...blankTemplate,
      "calendar.view": true,
      "jobs.view": false,
      "jobs.view_contract_jobs": false,
      "jobs.view_service_jobs": false,
      "inventory.view": true,
    },
  }),
  "/parts",
);

const autoAddLockedReason = getPermissionLockReason("job.access.auto_add_all_jobs", {
  ...blankTemplate,
  "jobs.view": true,
  "jobs.view_contract_jobs": true,
  "job.access.view": true,
  "job.access.manage": true,
});
assert.match(autoAddLockedReason ?? "", /job tab permission/i);

const vendorOrderFullPage = {
  ...blankTemplate,
};
for (const key of getHierarchyGroupKeys("vendor_orders")) {
  vendorOrderFullPage[key] = true;
}
const vendorOrderFullPageEffective = resolvePermissionsFromTemplateAndOverrides(
  vendorOrderFullPage,
  {},
);
assert.equal(vendorOrderFullPageEffective["orders.view"], true);
assert.equal(vendorOrderFullPageEffective["orders.to_order.view"], true);
assert.equal(vendorOrderFullPageEffective["orders.to_order.edit"], true);
assert.equal(vendorOrderFullPageEffective["orders.generate_send"], true);
assert.equal(vendorOrderFullPageEffective["orders.cancel"], true);
assert.equal(vendorOrderFullPageEffective["orders.mark_jobsite_delivery"], true);

const toOrderSendWithoutView = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "orders.view": "ALLOW",
  "orders.generate_send": "ALLOW",
});
assert.equal(toOrderSendWithoutView["orders.to_order.view"], true);
assert.equal(toOrderSendWithoutView["orders.generate_send"], true);
assert.equal(toOrderSendWithoutView["orders.to_order.edit"], false);

const toOrderEditOnly = applyImpliedPermissions({
  ...blankTemplate,
  "orders.view": true,
  "orders.to_order.view": true,
  "orders.to_order.edit": true,
  "orders.generate_send": false,
});
assert.equal(toOrderEditOnly["orders.to_order.edit"], true);
assert.equal(toOrderEditOnly["orders.generate_send"], false);

const toOrderViewOffClearsChildren = applyImpliedPermissions({
  ...blankTemplate,
  "orders.view": true,
  "orders.to_order.view": false,
  "orders.to_order.edit": false,
  "orders.generate_send": false,
});
assert.equal(toOrderViewOffClearsChildren["orders.to_order.view"], false);
assert.equal(toOrderViewOffClearsChildren["orders.to_order.edit"], false);
assert.equal(toOrderViewOffClearsChildren["orders.generate_send"], false);

const autoAddWithOnlyJobAccess = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "jobs.view": "ALLOW",
  "jobs.view_contract_jobs": "ALLOW",
  "job.access.view": "ALLOW",
  "job.access.auto_add_all_jobs": "ALLOW",
});
assert.equal(autoAddWithOnlyJobAccess["job.access.auto_add_all_jobs"], false);
assert.equal(canAutoAddJobAccessForJobType(autoAddWithOnlyJobAccess, false), false);

const contractOnlyAutoAdd = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "jobs.view": "ALLOW",
  "jobs.view_contract_jobs": "ALLOW",
  "jobs.view_service_jobs": "DENY",
  "job.puller.view": "ALLOW",
  "job.access.view": "ALLOW",
  "job.access.auto_add_all_jobs": "ALLOW",
});
assert.equal(contractOnlyAutoAdd["job.access.auto_add_all_jobs"], true);
assert.equal(canAutoAddJobAccessForJobType(contractOnlyAutoAdd, false), true);
assert.equal(canAutoAddJobAccessForJobType(contractOnlyAutoAdd, true), false);

const serviceOnlyAutoAdd = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "jobs.view": "ALLOW",
  "jobs.view_contract_jobs": "DENY",
  "jobs.view_service_jobs": "ALLOW",
  "job.delivery.view": "ALLOW",
  "job.access.view": "ALLOW",
  "job.access.auto_add_all_jobs": "ALLOW",
});
assert.equal(serviceOnlyAutoAdd["job.access.auto_add_all_jobs"], true);
assert.equal(canAutoAddJobAccessForJobType(serviceOnlyAutoAdd, false), false);
assert.equal(canAutoAddJobAccessForJobType(serviceOnlyAutoAdd, true), true);

const allJobsAutoAdd = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "jobs.view": "ALLOW",
  "jobs.view_contract_jobs": "ALLOW",
  "jobs.view_service_jobs": "ALLOW",
  "job.notes.view": "ALLOW",
  "job.access.view": "ALLOW",
  "job.access.auto_add_all_jobs": "ALLOW",
});
assert.equal(allJobsAutoAdd["job.access.auto_add_all_jobs"], true);
assert.equal(canAutoAddJobAccessForJobType(allJobsAutoAdd, false), true);
assert.equal(canAutoAddJobAccessForJobType(allJobsAutoAdd, true), true);

const hierarchyKeys = new Set(
  PERMISSION_HIERARCHY.flatMap((group) => getHierarchyGroupKeys(group.id)),
);
for (const key of ALL_PERMISSION_KEYS) {
  if (LEGACY_PERMISSION_KEYS.has(key) || IMPLIED_PERMISSION_KEYS.has(key)) continue;
  assert.equal(hierarchyKeys.has(key), true, `${key} is missing from permission hierarchy`);
}

const superAdminPermissions = resolvePermissionsFromTemplateAndOverrides(
  blankTemplate,
  { "users.view": "DENY", "dev.survey.view": "ALLOW" },
  { isSuperAdmin: true },
);
assert.equal(superAdminPermissions["users.view"], true);
assert.equal(superAdminPermissions["users.permissions.edit"], true);
assert.equal(superAdminPermissions["dev.survey.view"], false);
assert.equal(superAdminPermissions["job.access.auto_add_all_jobs"], true);

const developerPermissions = resolvePermissionsFromTemplateAndOverrides(
  blankTemplate,
  { "users.view": "DENY" },
  { isDeveloper: true },
);
assert.equal(developerPermissions["users.view"], true);
assert.equal(developerPermissions["dev.survey.view"], true);
assert.equal(developerPermissions["job.access.auto_add_all_jobs"], true);

const developerOnlyOverrideIgnored = resolvePermissionsFromTemplateAndOverrides(blankTemplate, {
  "dev.survey.view": "ALLOW",
});
assert.equal(developerOnlyOverrideIgnored["dev.survey.view"], false);

const archivedRoleTemplate = {
  ...blankTemplate,
  "inventory.view": true,
};
const archivedRoleEffective = resolvePermissionsFromTemplateAndOverrides(
  archivedRoleTemplate,
  {},
);
assert.equal(archivedRoleEffective["inventory.view"], true);

const lockedCalendar = applyRoleLockedPermissions(blankTemplate);
assert.equal(lockedCalendar["calendar.view"], true);
assert.equal(lockedCalendar["calendar.create"], true);
assert.equal(lockedCalendar["jobs.view_service_jobs"], false);

console.log("Permission default and resolution checks passed.");
