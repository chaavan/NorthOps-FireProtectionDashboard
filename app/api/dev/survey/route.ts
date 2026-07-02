import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, requireDeveloper } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  defaultSurveyBuilderPayload,
  normalizeSurveyBuilderInput,
  validateSurveyBuilderPayload,
} from "@/lib/survey/surveyBuilder";
import { nextSurveyVersion } from "@/lib/survey/launchSurveyRound";
import { createSurveyDraft } from "@/lib/survey/surveyPersistence";

export const dynamic = "force-dynamic";

function serializeSurvey(survey: {
  id: string;
  version: number;
  title: string;
  tagline: string | null;
  prefaceHeading: string | null;
  prefaceMessage: string | null;
  status: string;
  questions: unknown;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}) {
  return {
    id: survey.id,
    version: survey.version,
    title: survey.title,
    tagline: survey.tagline,
    prefaceHeading: survey.prefaceHeading,
    prefaceMessage: survey.prefaceMessage,
    status: survey.status,
    questions: survey.questions,
    createdAt: survey.createdAt.toISOString(),
    updatedAt: survey.updatedAt.toISOString(),
    closedAt: survey.closedAt?.toISOString() ?? null,
  };
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const access = requireDeveloper(session);
    if (!access.ok) return access.response;

    const [surveys, eligibleUserCount] = await Promise.all([
      prisma.survey.findMany({
        orderBy: [{ version: "desc" }],
        include: {
          responses: {
            where: { status: "COMPLETE" },
            select: { id: true },
          },
        },
      }),
      prisma.user.count({
        where: {
          email: {
            notIn: (process.env.DEVELOPER_EMAILS || "")
              .split(",")
              .map((email) => email.trim().toLowerCase())
              .filter(Boolean),
          },
        },
      }),
    ]);

    return NextResponse.json({
      surveys: surveys.map((survey) => ({
        id: survey.id,
        version: survey.version,
        title: survey.title,
        status: survey.status,
        createdAt: survey.createdAt.toISOString(),
        closedAt: survey.closedAt?.toISOString() ?? null,
        responseCount: survey.responses.length,
        eligibleUserCount,
        responseRate:
          eligibleUserCount === 0
            ? 0
            : Math.round((survey.responses.length / eligibleUserCount) * 1000) / 10,
      })),
    });
  } catch (error) {
    console.error("Error in /api/dev/survey:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = requireDeveloper(session);
    if (!access.ok) return access.response;

    const body = await request.json().catch(() => ({}));
    const normalized = normalizeSurveyBuilderInput(
      Object.keys(body || {}).length > 0 ? body : defaultSurveyBuilderPayload(),
    );
    const validation = validateSurveyBuilderPayload(normalized);
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

    return NextResponse.json({ survey: serializeSurvey(survey) }, { status: 201 });
  } catch (error) {
    console.error("Error in POST /api/dev/survey:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
