/**
 * Deletes all survey rounds and responses from the database.
 * Run: node scripts/clear-survey-data.mjs
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
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
} catch (error) {
  console.error("Failed to clear survey data:", error);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
