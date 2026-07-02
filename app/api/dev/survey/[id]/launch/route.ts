import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, requireDeveloper } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { launchSurveyRound } from "@/lib/survey/launchSurveyRound";
import { parseSurveyQuestions } from "@/lib/survey/surveyQuestions";
import { validateSurveyBuilderPayload } from "@/lib/survey/surveyBuilder";
import {
  readSurveyPresentationFields,
  withSurveyPresentation,
} from "@/lib/survey/surveyPersistence";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const access = requireDeveloper(session);
    if (!access.ok) return access.response;

    const { id } = await params;
    const existing = await prisma.survey.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Survey not found" }, { status: 404 });
    }
    if (existing.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Only draft surveys can be launched" },
        { status: 409 },
      );
    }

    const presentation = await readSurveyPresentationFields(prisma, id);
    const surveyWithPresentation = withSurveyPresentation(existing, presentation);

    const validation = validateSurveyBuilderPayload(
      {
        title: surveyWithPresentation.title,
        tagline: surveyWithPresentation.tagline,
        prefaceHeading: surveyWithPresentation.prefaceHeading,
        prefaceMessage: surveyWithPresentation.prefaceMessage,
        questions: parseSurveyQuestions(surveyWithPresentation.questions),
      },
      { requireQuestionsForLaunch: true },
    );
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const survey = await launchSurveyRound(id);

    return NextResponse.json({
      survey: {
        id: survey.id,
        version: survey.version,
        title: survey.title,
        status: survey.status,
        createdAt: survey.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error in POST /api/dev/survey/[id]/launch:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
