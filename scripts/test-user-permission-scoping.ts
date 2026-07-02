import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { activeUserWhere } from "../lib/activeUsers";
import { ALL_PERMISSION_KEYS, defaultRoleAllows, type PermissionKey } from "../lib/permissionCatalog";
import {
  initialOverridesFromResponse,
  overridesToAllowDeny,
  resolveEffectiveUserPermissions,
  setOverrideWithImplications,
} from "../lib/permissionEditorUtils";
import { resolvePermissionsFromTemplateAndOverrides } from "../lib/permissionResolution";

function templateForRole(role: string) {
  const allowed = defaultRoleAllows(role);
  return Object.fromEntries(
    ALL_PERMISSION_KEYS.map((key) => [key, allowed.has(key)]),
  ) as Record<PermissionKey, boolean>;
}

async function effectiveForUser(userId: string, role: string) {
  const template = templateForRole(role);
  const rows = await prisma.permissionOverride.findMany({
    where: { userId },
    select: { permissionKey: true, effect: true },
  });
  const overrides: Partial<Record<PermissionKey, "ALLOW" | "DENY">> = {};
  for (const row of rows) {
    overrides[row.permissionKey as PermissionKey] = row.effect as "ALLOW" | "DENY";
  }
  return resolvePermissionsFromTemplateAndOverrides(template, overrides);
}

async function roleTemplateSnapshot(role: string) {
  return prisma.rolePermissionTemplate.findMany({
    where: { role },
    select: { permissionKey: true, effect: true },
    orderBy: { permissionKey: "asc" },
  });
}

// --- Resolution parity (client utils match server resolver) ---

const salesTemplate = templateForRole("SALES");
const overrides = initialOverridesFromResponse({
  "inventory.view": "DENY",
  "estimates.create": "ALLOW",
});

const clientEffective = resolveEffectiveUserPermissions({
  template: salesTemplate,
  overrides,
  isSuperAdmin: false,
  isDeveloper: false,
});

const serverEffective = resolvePermissionsFromTemplateAndOverrides(
  salesTemplate,
  overridesToAllowDeny(overrides),
);

assert.deepEqual(clientEffective, serverEffective);
assert.equal(clientEffective["inventory.view"], false);
assert.equal(clientEffective["estimates.create"], true);

const mutated = setOverrideWithImplications(overrides, "jobs.view", "DENY");
assert.equal(mutated["jobs.view_contract_jobs"], "DENY");
assert.equal(mutated["jobs.view_service_jobs"], "DENY");

console.log("Resolution parity checks passed.");

// --- DB scoping (integration) ---

async function runIntegrationTests() {
  const role = "SALES";
  const users = await prisma.user.findMany({
    where: { ...activeUserWhere, role },
    select: { id: true, email: true, role: true },
    take: 2,
    orderBy: { createdAt: "asc" },
  });

  if (users.length < 2) {
    console.log("Skipping DB scoping tests: need at least 2 active SALES users.");
    return;
  }

  const [userA, userB] = users;
  const roleTemplateBefore = await roleTemplateSnapshot(role);
  const userBBefore = await effectiveForUser(userB.id, userB.role);

  await prisma.permissionOverride.deleteMany({ where: { userId: userA.id } });

  await prisma.permissionOverride.createMany({
    data: [
      {
        userId: userA.id,
        permissionKey: "inventory.view",
        effect: "DENY",
      },
      {
        userId: userA.id,
        permissionKey: "estimates.create",
        effect: "ALLOW",
      },
    ],
    skipDuplicates: true,
  });

  const userAAfter = await effectiveForUser(userA.id, userA.role);
  const userBAfter = await effectiveForUser(userB.id, userB.role);
  const roleTemplateAfter = await roleTemplateSnapshot(role);

  assert.equal(userAAfter["inventory.view"], false);
  assert.equal(userAAfter["estimates.create"], true);

  assert.deepEqual(
    userBAfter,
    userBBefore,
    "User B effective permissions must be unchanged",
  );
  assert.deepEqual(
    roleTemplateAfter,
    roleTemplateBefore,
    "Role template must be unchanged",
  );

  const overrideRows = await prisma.permissionOverride.findMany({
    where: { userId: userA.id },
    select: { userId: true, permissionKey: true, effect: true },
  });
  assert.ok(
    overrideRows.every((row) => row.userId === userA.id),
    "Override rows must belong only to user A",
  );

  await prisma.permissionOverride.deleteMany({ where: { userId: userA.id } });

  const userAReset = await effectiveForUser(userA.id, userA.role);
  const baseline = resolvePermissionsFromTemplateAndOverrides(salesTemplate, {});
  assert.deepEqual(userAReset, baseline);

  console.log("DB scoping checks passed.");
}

void runIntegrationTests()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
