import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, isDeveloperEmail, resolveSessionUserIdForAudit } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  parseSurveyProgress,
  validatePartialSurveyAnswers,
} from "@/lib/survey/surveyResults";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized - Please sign in" }, { status: 401 });
    }
    if (isDeveloperEmail(session.user.email)) {
      return NextResponse.json({ error: "Developers do not receive this survey" }, { status: 403 });
    }

    const userId = await resolveSessionUserIdForAudit(session);
    const userEmail = session.user.email?.trim().toLowerCase();
    if (!userId || !userEmail) {
      return NextResponse.json({ error: "Could not identify signed-in user" }, { status: 400 });
    }

    const body = await request.json();
    const surveyId = typeof body?.surveyId === "string" ? body.surveyId.trim() : "";
    if (!surveyId) {
      return NextResponse.json({ error: "surveyId is required" }, { status: 400 });
    }

    const survey = await prisma.survey.findFirst({
      where: { id: surveyId, status: "ACTIVE" },
    });
    if (!survey) {
      return NextResponse.json({ error: "Survey is no longer active" }, { status: 404 });
    }

    const validation = validatePartialSurveyAnswers(survey.questions, body?.answers);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const progress = parseSurveyProgress(body?.progress);
    const hasAnswers = Object.keys(validation.answers).length > 0;
    // Any parsed progress (including showPreface: false after "Get started") should persist.
    const hasProgress = !!progress;

    if (!hasAnswers && !hasProgress) {
      return NextResponse.json({ success: true, skipped: true });
    }

    const existingResponse = await prisma.surveyResponse.findUnique({
      where: {
        surveyId_userId: {
          surveyId: survey.id,
          userId,
        },
      },
      select: { status: true },
    });

    if (existingResponse?.status === "COMPLETE") {
      return NextResponse.json({ error: "Survey already completed" }, { status: 409 });
    }

    await prisma.surveyResponse.upsert({
      where: {
        surveyId_userId: {
          surveyId: survey.id,
          userId,
        },
      },
      create: {
        surveyId: survey.id,
        userId,
        userEmail,
        userName: session.user.name || null,
        department: validation.department,
        answers: validation.answers as object,
        progress: progress as object | undefined,
        status: "INCOMPLETE",
        submittedAt: null,
      },
      update: {
        userEmail,
        userName: session.user.name || null,
        department: validation.department,
        answers: validation.answers as object,
        progress: progress as object | undefined,
        status: "INCOMPLETE",
        submittedAt: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in /api/survey/draft:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
