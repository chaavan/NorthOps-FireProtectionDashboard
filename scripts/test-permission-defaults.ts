import assert from "node:assert/strict";
import { defaultRoleAllows } from "../lib/permissionCatalog";

function allows(role: string, permissionKey: string) {
  return defaultRoleAllows(role).has(permissionKey as any);
}

assert.equal(allows("ADMIN", "users.permissions.edit"), true);
assert.equal(allows("ADMIN", "orders.generate_send"), true);
assert.equal(allows("ADMIN", "job_import.drafts.view_all"), true);
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
assert.equal(allows("VIEWER", "jobs.view_service_jobs"), true);
assert.equal(allows("ADMIN", "jobs.view_service_jobs"), true);
assert.equal(allows("ADMIN", "job.access.auto_add_all_jobs"), false);
assert.equal(allows("PROJECT_MANAGER", "job.access.auto_add_all_jobs"), false);
assert.equal(allows("VIEWER", "job.access.auto_add_all_jobs"), false);

console.log("Permission default checks passed.");
