import type { EstimateDraft } from "@/lib/estimateTypes";
import { softwareConfig } from "@/lib/softwareConfig";

/** Round demo-friendly pricing controls for NorthOps demos (not TFP production defaults). */
export const DEMO_ESTIMATE_PRICING_INPUTS = {
  milesToJobSite: 25,
  salesTaxPercent: 8,
  materialInflationPercent: 5,
  overheadPercent: 20,
  profitPercent: 15,
  subsMarkupPercent: 8,
  peStamp: 0,
  bondCost: 0,
  fees: null,
} satisfies Pick<
  EstimateDraft["inputs"],
  | "milesToJobSite"
  | "salesTaxPercent"
  | "materialInflationPercent"
  | "overheadPercent"
  | "profitPercent"
  | "subsMarkupPercent"
  | "peStamp"
  | "bondCost"
  | "fees"
>;

export const DEMO_ESTIMATE_PROJECT_PRICING = {
  squareFootage: 12500,
} as const;

/**
 * Whether new estimates open with the round demo pricing controls.
 *
 * Prefer the explicit flag. The software-id fallback is kept only so existing
 * northops-fire deployments behave as before — do NOT add new behaviour keyed to
 * the id, because renaming a deployment then silently changes pricing.
 */
export function useDemoEstimatePricingDefaults(): boolean {
  const explicit = process.env.NEXT_PUBLIC_USE_DEMO_ESTIMATE_PRICING?.trim();
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return softwareConfig.id === "northops-fire";
}

export function applyDemoPricingToDraft(draft: EstimateDraft): EstimateDraft {
  return {
    ...draft,
    project: {
      ...draft.project,
      squareFootage: DEMO_ESTIMATE_PROJECT_PRICING.squareFootage,
    },
    inputs: {
      ...draft.inputs,
      ...DEMO_ESTIMATE_PRICING_INPUTS,
    },
  };
}
