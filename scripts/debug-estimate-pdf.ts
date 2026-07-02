import { renderStandaloneEstimatePdfBuffer } from "../lib/estimate/renderStandaloneEstimatePdf";
import { getStandaloneEstimate } from "../lib/estimate/estimateService";
import { loadEstimatePdfLogoDataUri } from "../lib/estimate/estimatePdfLogo";

const estimateId = process.argv[2] || "cmp5s2va30003116epklkars2";

async function main() {
  const estimate = await getStandaloneEstimate({
    estimateId,
    variantKey: "base",
    userEmail: null,
  });

  const buffer = await renderStandaloneEstimatePdfBuffer({
    computed: estimate.computed,
    logoDataUri: loadEstimatePdfLogoDataUri() ?? null,
    generatedAtDisplay: new Date().toLocaleString(),
    variantLabel: estimate.variant.variantLabel,
    standaloneTitle: estimate.estimate.title,
  });
  console.log("PDF bytes:", buffer.length);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
