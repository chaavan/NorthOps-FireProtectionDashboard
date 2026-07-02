import "dotenv/config";
import { prisma } from "../lib/prisma";
import { applyDemoPricingToDraft } from "../lib/estimate/demoPricingDefaults";
import { computeEstimateFromDraft } from "../lib/estimate/estimateEngine";
import { getPricingForParts } from "../lib/partsDatabase";
import type { EstimateDraft } from "../lib/estimateTypes";

function normalizePartKey(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, "").toUpperCase();
}

async function buildPricingLookup(draft: EstimateDraft) {
  const partNumbers = Array.from(
    new Set(
      draft.materials.visibleLines
        .map((line) => line.partNumber?.trim() || null)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const rawLookup = await getPricingForParts(partNumbers);
  const lookup = new Map<string, { cost: number; supplier: string }>();
  rawLookup.forEach((value, key) => {
    lookup.set(key, value);
    const normalized = normalizePartKey(key);
    if (normalized) {
      lookup.set(normalized, value);
    }
  });
  return lookup;
}

async function main() {
  if (process.env.ESTIMATE_DEMO_PRICING_CONFIRM !== "I_UNDERSTAND") {
    throw new Error(
      "Refusing to run: set ESTIMATE_DEMO_PRICING_CONFIRM=I_UNDERSTAND",
    );
  }

  const actorEmail =
    process.env.ESTIMATE_DEMO_PRICING_ACTOR?.trim() || "demo-seed@northops.local";

  const variants = await prisma.standaloneEstimateVariant.findMany({
    where: { variantStatus: { not: "archived" } },
    select: { id: true, data: true },
  });

  console.log(`Applying demo pricing controls to ${variants.length} estimate variant(s)...`);

  for (const variant of variants) {
    const draft = applyDemoPricingToDraft(variant.data as EstimateDraft);
    const pricingLookup = await buildPricingLookup(draft);
    const computed = await computeEstimateFromDraft(draft, pricingLookup);

    await prisma.standaloneEstimateVariant.update({
      where: { id: variant.id },
      data: {
        data: computed.draft,
        subtotal: computed.summary.subtotal,
        totalCost: computed.summary.totalCost,
        updatedBy: actorEmail,
      },
    });

    console.log(
      `  ${variant.id}: subtotal=${computed.summary.subtotal.toFixed(2)} total=${computed.summary.totalCost.toFixed(2)}`,
    );
  }

  console.log("\nDone.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
