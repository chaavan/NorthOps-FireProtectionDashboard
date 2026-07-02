import "dotenv/config";
import { backfillAutoAddForAllJobs } from "@/lib/autoAddJobAccess";

async function main() {
  console.log("Backfilling auto-add job access for all existing jobs...\n");

  const result = await backfillAutoAddForAllJobs();

  console.log(`Job lists processed: ${result.jobListsProcessed}`);
  console.log(`Auto-add grants created/updated: ${result.grantsCreated}`);
  console.log(
    "\nDone. Users with 'Auto Add To All Jobs' enabled now have JobAccess rows on existing jobs.",
  );
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
