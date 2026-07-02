import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, isDeveloperEmail, resolveSessionUserIdForAudit } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateSurveyAnswers } from "@/lib/survey/surveyResults";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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

    const validation = validateSurveyAnswers(survey.questions, body?.answers);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const existingResponse = await prisma.surveyResponse.findUnique({
      where: {
        surveyId_userId: {
          surveyId: survey.id,
          userId,
        },
      },
      select: { id: true, status: true },
    });

    if (existingResponse?.status === "COMPLETE") {
      return NextResponse.json({ error: "You already submitted this survey" }, { status: 409 });
    }

    const data = {
      userEmail,
      userName: session.user.name || null,
      department: validation.department,
      answers: validation.answers as object,
      progress: Prisma.DbNull,
      status: "COMPLETE" as const,
      submittedAt: new Date(),
    };

    if (existingResponse) {
      await prisma.surveyResponse.update({
        where: { id: existingResponse.id },
        data,
      });
    } else {
      await prisma.surveyResponse.create({
        data: {
          surveyId: survey.id,
          userId,
          ...data,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in /api/survey/respond:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
