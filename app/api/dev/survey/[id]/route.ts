import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, requireDeveloper } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  normalizeSurveyBuilderInput,
  validateSurveyBuilderPayload,
} from "@/lib/survey/surveyBuilder";
import {
  readSurveyPresentationFields,
  updateSurveyDraft,
  withSurveyPresentation,
} from "@/lib/survey/surveyPersistence";

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const access = requireDeveloper(session);
    if (!access.ok) return access.response;

    const { id } = await params;
    const survey = await prisma.survey.findUnique({ where: { id } });
    if (!survey) {
      return NextResponse.json({ error: "Survey not found" }, { status: 404 });
    }

    const presentation = await readSurveyPresentationFields(prisma, id);
    return NextResponse.json({
      survey: serializeSurvey(withSurveyPresentation(survey, presentation)),
    });
  } catch (error) {
    console.error("Error in GET /api/dev/survey/[id]:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
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
        { error: "Only draft surveys can be edited" },
        { status: 409 },
      );
    }

    const body = await request.json();
    const normalized = normalizeSurveyBuilderInput(body);
    const validation = validateSurveyBuilderPayload(normalized);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const survey = await updateSurveyDraft(prisma, id, {
      title: validation.data.title,
      questions: validation.data.questions as object,
      presentation: {
        tagline: validation.data.tagline,
        prefaceHeading: validation.data.prefaceHeading,
        prefaceMessage: validation.data.prefaceMessage,
      },
    });

    return NextResponse.json({ survey: serializeSurvey(survey) });
  } catch (error) {
    console.error("Error in PATCH /api/dev/survey/[id]:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
