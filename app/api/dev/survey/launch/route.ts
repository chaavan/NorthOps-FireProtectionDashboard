import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, requireDeveloper } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { defaultSurveyBuilderPayload } from "@/lib/survey/surveyBuilder";
import { launchSurveyRound, nextSurveyVersion } from "@/lib/survey/launchSurveyRound";
import { createSurveyDraft } from "@/lib/survey/surveyPersistence";
import { validateSurveyBuilderPayload } from "@/lib/survey/surveyBuilder";

export const dynamic = "force-dynamic";

/** Legacy: create draft from template and launch immediately. Prefer builder + POST /api/dev/survey/[id]/launch. */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    const access = requireDeveloper(session);
    if (!access.ok) return access.response;

    const defaults = defaultSurveyBuilderPayload();
    const validation = validateSurveyBuilderPayload(defaults, {
      requireQuestionsForLaunch: true,
    });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const survey = await prisma.$transaction(async (tx) => {
      const version = await nextSurveyVersion(tx);
      return createSurveyDraft(tx, {
        version,
        title: validation.data.title,
        questions: validation.data.questions as object,
        createdBy: access.userEmail,
        presentation: {
          tagline: validation.data.tagline,
          prefaceHeading: validation.data.prefaceHeading,
          prefaceMessage: validation.data.prefaceMessage,
        },
      });
    });

    const launched = await launchSurveyRound(survey.id);

    return NextResponse.json({
      survey: {
        id: launched.id,
        version: launched.version,
        title: launched.title,
        status: launched.status,
        createdAt: launched.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error in /api/dev/survey/launch:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
