import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, isDeveloperEmail, resolveSessionUserIdForAudit } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveSurveyPresentation } from "@/lib/survey/surveyBuilder";
import {
  readSurveyPresentationFields,
  withSurveyPresentation,
} from "@/lib/survey/surveyPersistence";
import { parseSurveyProgress } from "@/lib/survey/surveyResults";
import type { SurveyAnswers } from "@/lib/survey/surveyQuestions";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized - Please sign in" }, { status: 401 });
    }

    if (isDeveloperEmail(session.user.email)) {
      return NextResponse.json({
        shouldAutoOpen: false,
        canResume: false,
      });
    }

    const survey = await prisma.survey.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { version: "desc" },
    });

    if (!survey) {
      return NextResponse.json({
        shouldAutoOpen: false,
        canResume: false,
      });
    }

    const userId = await resolveSessionUserIdForAudit(session);
    if (!userId) {
      return NextResponse.json({
        shouldAutoOpen: false,
        canResume: false,
      });
    }

    const existingResponse = await prisma.surveyResponse.findUnique({
      where: {
        surveyId_userId: {
          surveyId: survey.id,
          userId,
        },
      },
      select: {
        status: true,
        answers: true,
        progress: true,
      },
    });

    const isComplete = existingResponse?.status === "COMPLETE";
    const presentationFields = await readSurveyPresentationFields(prisma, survey.id);
    const presentation = resolveSurveyPresentation(
      withSurveyPresentation(survey, presentationFields),
    );

    return NextResponse.json({
      shouldAutoOpen: !isComplete,
      canResume: !isComplete,
      survey: {
        id: survey.id,
        version: survey.version,
        title: survey.title,
        tagline: presentation.tagline,
        prefaceHeading: presentation.prefaceHeading,
        prefaceMessage: presentation.prefaceMessage,
        questions: survey.questions,
      },
      draft:
        existingResponse && !isComplete
          ? {
              answers: existingResponse.answers as SurveyAnswers,
              progress: parseSurveyProgress(existingResponse.progress),
            }
          : null,
    });
  } catch (error) {
    console.error("Error in /api/survey/active:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
