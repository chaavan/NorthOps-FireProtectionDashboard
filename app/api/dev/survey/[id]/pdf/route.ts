import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { authOptions, requireDeveloper } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSurveyResultsPayload } from "@/lib/survey/surveyResults";
import SurveyResultsPDFDocument from "@/components/survey/SurveyResultsPDFDocument";

export const dynamic = "force-dynamic";

function filenameSafe(value: string) {
  return value
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "survey";
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
    const [survey, users] = await Promise.all([
      prisma.survey.findUnique({
        where: { id },
        include: {
          responses: {
            orderBy: { submittedAt: "asc" },
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

    const results = buildSurveyResultsPayload({
      survey,
      responses: survey.responses,
      users,
    });
    const generatedAtDisplay = new Date().toLocaleString("en-US", {
      dateStyle: "long",
      timeStyle: "short",
    });

    const pdfBuffer = await renderToBuffer(
      React.createElement(SurveyResultsPDFDocument, {
        results,
        generatedAtDisplay,
      }) as React.ReactElement,
    );

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filenameSafe(
          `${results.survey.title}-round-${results.survey.version}`,
        )}-results.pdf"`,
      },
    });
  } catch (error) {
    console.error("Error in /api/dev/survey/[id]/pdf:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
