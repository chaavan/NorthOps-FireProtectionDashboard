import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function launchSurveyRound(surveyId: string) {
  return prisma.$transaction(async (tx) => {
    const survey = await tx.survey.findUnique({ where: { id: surveyId } });
    if (!survey) {
      throw new Error("Survey not found");
    }
    if (survey.status !== "DRAFT") {
      throw new Error("Only draft surveys can be launched");
    }

    await tx.survey.updateMany({
      where: { status: "ACTIVE" },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
      },
    });

    return tx.survey.update({
      where: { id: surveyId },
      data: {
        status: "ACTIVE",
        closedAt: null,
      },
    });
  });
}

export async function nextSurveyVersion(tx: Prisma.TransactionClient) {
  const maxVersion = await tx.survey.aggregate({
    _max: { version: true },
  });
  return (maxVersion._max.version || 0) + 1;
}
