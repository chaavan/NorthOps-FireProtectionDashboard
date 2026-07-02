import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, requireDeveloper } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
    const survey = await prisma.survey.update({
      where: { id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
      },
    });

    return NextResponse.json({
      survey: {
        id: survey.id,
        version: survey.version,
        status: survey.status,
        closedAt: survey.closedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error("Error in /api/dev/survey/[id]/close:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
