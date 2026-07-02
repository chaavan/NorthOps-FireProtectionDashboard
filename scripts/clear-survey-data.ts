/**
 * Deletes all survey rounds and responses from the database.
 * Run: npx tsx scripts/clear-survey-data.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [responseCount, surveyCount] = await Promise.all([
    prisma.surveyResponse.count(),
    prisma.survey.count(),
  ]);

  console.log(`Found ${surveyCount} survey round(s) and ${responseCount} response(s).`);

  const deletedResponses = await prisma.surveyResponse.deleteMany({});
  const deletedSurveys = await prisma.survey.deleteMany({});

  console.log(
    `Deleted ${deletedSurveys.count} survey round(s) and ${deletedResponses.count} response(s).`,
  );
  console.log("Survey dashboard is empty. You can create a new round when ready.");
}

main()
  .catch((error) => {
    console.error("Failed to clear survey data:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
