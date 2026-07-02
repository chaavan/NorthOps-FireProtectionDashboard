import type { Prisma, PrismaClient } from "@prisma/client";

export type SurveyPresentationFields = {
  tagline: string | null;
  prefaceHeading: string | null;
  prefaceMessage: string | null;
};

type DbClient = PrismaClient | Prisma.TransactionClient;

/** Writes presentation columns via SQL so saves work even if Prisma Client is stale. */
export async function writeSurveyPresentationFields(
  client: DbClient,
  surveyId: string,
  fields: SurveyPresentationFields,
): Promise<void> {
  await client.$executeRaw`
    UPDATE surveys
    SET
      tagline = ${fields.tagline},
      preface_heading = ${fields.prefaceHeading},
      preface_message = ${fields.prefaceMessage}
    WHERE id = ${surveyId}
  `;
}

export async function readSurveyPresentationFields(
  client: DbClient,
  surveyId: string,
): Promise<SurveyPresentationFields> {
  const rows = await client.$queryRaw<SurveyPresentationFields[]>`
    SELECT
      tagline,
      preface_heading AS "prefaceHeading",
      preface_message AS "prefaceMessage"
    FROM surveys
    WHERE id = ${surveyId}
    LIMIT 1
  `;
  return (
    rows[0] ?? {
      tagline: null,
      prefaceHeading: null,
      prefaceMessage: null,
    }
  );
}

export function withSurveyPresentation<T extends Record<string, unknown>>(
  survey: T,
  presentation: SurveyPresentationFields,
): T & SurveyPresentationFields {
  return {
    ...survey,
    tagline: presentation.tagline,
    prefaceHeading: presentation.prefaceHeading,
    prefaceMessage: presentation.prefaceMessage,
  };
}

export async function createSurveyDraft(
  tx: Prisma.TransactionClient,
  data: {
    version: number;
    title: string;
    questions: object;
    createdBy: string;
    presentation: SurveyPresentationFields;
  },
) {
  const survey = await tx.survey.create({
    data: {
      version: data.version,
      title: data.title,
      status: "DRAFT",
      questions: data.questions,
      createdBy: data.createdBy,
    },
  });

  await writeSurveyPresentationFields(tx, survey.id, data.presentation);
  return withSurveyPresentation(survey, data.presentation);
}

export async function updateSurveyDraft(
  client: DbClient,
  surveyId: string,
  data: {
    title: string;
    questions: object;
    presentation: SurveyPresentationFields;
  },
) {
  const survey = await client.survey.update({
    where: { id: surveyId },
    data: {
      title: data.title,
      questions: data.questions,
    },
  });

  await writeSurveyPresentationFields(client, surveyId, data.presentation);
  return withSurveyPresentation(survey, data.presentation);
}
