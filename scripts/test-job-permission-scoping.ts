import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { activeUserWhere } from "../lib/activeUsers";
import { ALL_PERMISSION_KEYS, defaultRoleAllows, type PermissionKey } from "../lib/permissionCatalog";
import {
  jobEditableSectionsFromHierarchy,
  mergeJobScopedPermissions,
  resolveEffectiveJobPermissions,
  setJobOverrideWithImplications,
  turnSectionOff,
} from "../lib/jobPermissionEditorUtils";
import { removeJobAccess, setJobAccess, JOB_ACCESS_SOURCES } from "../lib/jobAccess";

function templateForRole(role: string) {
  const allowed = defaultRoleAllows(role);
  return Object.fromEntries(
    ALL_PERMISSION_KEYS.map((key) => [key, allowed.has(key)]),
  ) as Record<PermissionKey, boolean>;
}

// --- Resolution parity (client utils match shared mergeJobScopedPermissions) ---

const salesBase = templateForRole("SALES");
const jobOverrides = {
  "job.purchase_order.view": "ALLOW" as const,
};

const clientEffective = resolveEffectiveJobPermissions({
  basePermissions: salesBase,
  overrides: { "job.purchase_order.view": "ALLOW" },
});

const serverEffective = mergeJobScopedPermissions(salesBase, jobOverrides);

assert.deepEqual(clientEffective, serverEffective);
assert.equal(clientEffective["job.purchase_order.view"], true);
assert.equal(salesBase["job.purchase_order.view"], false);

const allowPo = setJobOverrideWithImplications({}, "job.purchase_order.view", "ALLOW");
assert.equal(allowPo["jobs.view"], undefined, "jobs.view must not be set by job override implications");
assert.equal(allowPo["job.purchase_order.view"], "ALLOW");

const sections = jobEditableSectionsFromHierarchy();
const deliverySection = sections.find((section) => section.id === "job.delivery.view");
assert.ok(deliverySection, "delivery section should exist");

const denyDelivery = turnSectionOff({}, deliverySection!);
assert.equal(denyDelivery["job.delivery.view"], "DENY");

const effectiveAfterDeny = resolveEffectiveJobPermissions({
  basePermissions: salesBase,
  overrides: denyDelivery,
});
assert.equal(effectiveAfterDeny["job.delivery.view"], false);

console.log("Job permission resolution parity checks passed.");

// --- DB scoping (integration) ---

async function runIntegrationTests() {
  const users = await prisma.user.findMany({
    where: { ...activeUserWhere, role: "SALES" },
    select: { id: true, email: true, role: true },
    take: 2,
    orderBy: { createdAt: "asc" },
  });

  if (users.length < 2) {
    console.log("Skipping DB scoping tests: need at least 2 active SALES users.");
    return;
  }

  const [userA, userB] = users;
  const jobOne = `__perm_scope_${Date.now()}_1`;
  const jobTwo = `__perm_scope_${Date.now()}_2`;
  const listNumber = "1";

  const globalOverridesBefore = await prisma.permissionOverride.count({
    where: { userId: { in: [userA.id, userB.id] } },
  });
  const roleTemplateBefore = await prisma.rolePermissionTemplate.count();

  try {
    await setJobAccess(jobOne, userA.email, listNumber, JOB_ACCESS_SOURCES.MANUAL);
    await setJobAccess(jobOne, userB.email, listNumber, JOB_ACCESS_SOURCES.MANUAL);
    await setJobAccess(jobTwo, userA.email, listNumber, JOB_ACCESS_SOURCES.MANUAL);

    await prisma.jobPermissionOverride.create({
      data: {
        jobNumber: jobOne,
        listNumber,
        userEmail: userA.email.toLowerCase(),
        permissionKey: "job.purchase_order.view",
        effect: "ALLOW",
      },
    });

    const userAJobOne = await prisma.jobPermissionOverride.findMany({
      where: { jobNumber: jobOne, listNumber, userEmail: userA.email.toLowerCase() },
    });
    const userBJobOne = await prisma.jobPermissionOverride.findMany({
      where: { jobNumber: jobOne, listNumber, userEmail: userB.email.toLowerCase() },
    });
    const userAJobTwo = await prisma.jobPermissionOverride.findMany({
      where: { jobNumber: jobTwo, listNumber, userEmail: userA.email.toLowerCase() },
    });

    assert.equal(userAJobOne.length, 1);
    assert.equal(userAJobOne[0]?.permissionKey, "job.purchase_order.view");
    assert.equal(userBJobOne.length, 0, "User B must have no overrides on job 1");
    assert.equal(userAJobTwo.length, 0, "User A must have no overrides on job 2");

    const globalOverridesAfter = await prisma.permissionOverride.count({
      where: { userId: { in: [userA.id, userB.id] } },
    });
    const roleTemplateAfter = await prisma.rolePermissionTemplate.count();

    assert.equal(
      globalOverridesAfter,
      globalOverridesBefore,
      "Global permission overrides must be unchanged",
    );
    assert.equal(roleTemplateAfter, roleTemplateBefore, "Role template row count must be unchanged");

    await removeJobAccess(jobOne, userA.email, listNumber);

    const remainingOverrides = await prisma.jobPermissionOverride.findMany({
      where: { jobNumber: jobOne, listNumber, userEmail: userA.email.toLowerCase() },
    });
    assert.equal(
      remainingOverrides.length,
      0,
      "Job overrides must be deleted when access is removed",
    );

    const userAAccess = await prisma.jobAccess.findUnique({
      where: {
        jobNumber_listNumber_userEmail: {
          jobNumber: jobOne,
          listNumber,
          userEmail: userA.email.toLowerCase(),
        },
      },
    });
    assert.equal(userAAccess, null, "JobAccess row must be removed for user A");

    console.log("DB job permission scoping checks passed.");
  } finally {
    await prisma.jobPermissionOverride.deleteMany({
      where: { jobNumber: { in: [jobOne, jobTwo] } },
    });
    await prisma.jobAccess.deleteMany({
      where: { jobNumber: { in: [jobOne, jobTwo] } },
    });
  }
}

void runIntegrationTests()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
