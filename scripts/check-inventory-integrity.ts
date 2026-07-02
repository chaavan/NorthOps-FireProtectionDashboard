import { prisma } from "../lib/prisma";
import { normalizePartNumber } from "../lib/inventoryQuantity";

type CheckResult = {
  name: string;
  passed: boolean;
  details: string[];
};

async function checkNegativeAllocations(): Promise<CheckResult> {
  const rows = await prisma.partAllocation.findMany({
    where: { quantityPulled: { lt: 0 } },
    select: { id: true, partId: true, jobId: true, quantityPulled: true },
    take: 100,
  });

  return {
    name: "Negative allocations",
    passed: rows.length === 0,
    details: rows.map(
      (r) =>
        `partAllocation ${r.id} job=${r.jobId} partId=${r.partId} qty=${r.quantityPulled}`,
    ),
  };
}

async function checkDuplicatePnByNormalizedValue(): Promise<CheckResult> {
  const parts = await prisma.part.findMany({
    select: { id: true, pn: true },
  });

  const grouped = new Map<string, Array<{ id: string; pn: string }>>();
  for (const part of parts) {
    const key = normalizePartNumber(part.pn);
    if (!key) continue;
    const list = grouped.get(key) ?? [];
    list.push(part);
    grouped.set(key, list);
  }

  const collisions = Array.from(grouped.entries()).filter(
    ([, values]) => values.length > 1,
  );

  return {
    name: "Normalized PN collisions",
    passed: collisions.length === 0,
    details: collisions.slice(0, 100).map(([key, values]) => {
      const ids = values.map((v) => `${v.pn} (${v.id})`).join(", ");
      return `normalizedPN=${key} -> ${ids}`;
    }),
  };
}

async function checkAllocationExceedsPulledOnJobs(): Promise<CheckResult> {
  const [allocations, jobRows] = await Promise.all([
    prisma.partAllocation.findMany({
      where: { quantityPulled: { gt: 0 } },
      include: {
        part: { select: { pn: true } },
      },
      take: 10000,
    }),
    prisma.job.findMany({
      where: { pulled: { gt: 0 } },
      select: {
        jobNumber: true,
        partNumber: true,
        pulled: true,
      },
      take: 50000,
    }),
  ]);

  const pulledByJobAndPn = new Map<string, number>();
  for (const row of jobRows) {
    const key = `${row.jobNumber}::${row.partNumber}`;
    pulledByJobAndPn.set(key, (pulledByJobAndPn.get(key) ?? 0) + (row.pulled ?? 0));
  }

  const issues: string[] = [];
  for (const allocation of allocations) {
    const key = `${allocation.jobId}::${allocation.part.pn}`;
    const pulled = pulledByJobAndPn.get(key) ?? 0;
    if (allocation.quantityPulled > pulled) {
      issues.push(
        `job=${allocation.jobId} pn=${allocation.part.pn} allocation=${allocation.quantityPulled} pulledFromJobs=${pulled}`,
      );
    }
  }

  return {
    name: "Allocation exceeds pulled quantity",
    passed: issues.length === 0,
    details: issues.slice(0, 100),
  };
}

async function main() {
  const checks = await Promise.all([
    checkNegativeAllocations(),
    checkDuplicatePnByNormalizedValue(),
    checkAllocationExceedsPulledOnJobs(),
  ]);

  let failed = 0;
  for (const check of checks) {
    const status = check.passed ? "PASS" : "FAIL";
    console.log(`\n[${status}] ${check.name}`);
    if (check.details.length > 0) {
      for (const detail of check.details) {
        console.log(`  - ${detail}`);
      }
    }
    if (!check.passed) failed += 1;
  }

  await prisma.$disconnect();
  if (failed > 0) {
    console.error(`\nIntegrity checks failed: ${failed}`);
    process.exit(1);
  }
  console.log("\nAll integrity checks passed.");
}

main().catch(async (err) => {
  console.error("Failed to run inventory integrity checks:", err);
  await prisma.$disconnect();
  process.exit(1);
});
