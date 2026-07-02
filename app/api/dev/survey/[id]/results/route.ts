import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, requireDeveloper } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSurveyResultsPayload } from "@/lib/survey/surveyResults";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const access = requireDeveloper(session);
    if (!access.ok) return access.response;

    const { id } = await params;
    const [survey, users] = await Promise.all([
      prisma.survey.findUnique({
        where: { id },
        include: {
          responses: {
            orderBy: [{ updatedAt: "asc" }, { submittedAt: "asc" }],
          },
        },
      }),
      prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
        orderBy: { email: "asc" },
      }),
    ]);

    if (!survey) {
      return NextResponse.json({ error: "Survey not found" }, { status: 404 });
    }

    return NextResponse.json(
      buildSurveyResultsPayload({
        survey,
        responses: survey.responses,
        users,
      }),
    );
  } catch (error) {
    console.error("Error in /api/dev/survey/[id]/results:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
