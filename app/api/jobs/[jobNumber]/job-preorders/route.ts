import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertJobPreorderReadAccess, assertJobPreorderWriteAccess, jobPreorderFeatureDisabledResponse } from "@/lib/jobPreorderAccess";
import { createJobPreorderLine, listJobPreorderLines } from "@/lib/jobPreorderLines";
import { parseDateInputInAppTimeZone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

/**
 * GET — list job pre-order lines and pool state for the whole job.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ jobNumber: string }> },
) {
  try {
    const { jobNumber: rawJob } = await context.params;
    const jobNumber = decodeURIComponent(rawJob || "").trim();
    if (!jobNumber) {
      return NextResponse.json({ error: "jobNumber is required" }, { status: 400 });
    }

    const featureDisabled = jobPreorderFeatureDisabledResponse();
    if (featureDisabled) return featureDisabled;

    const session = await getServerSession(authOptions);

    const denied = await assertJobPreorderReadAccess({
      sessionUser: session?.user as any,
      jobNumber,
    });
    if (denied) return denied;

    const payload = await listJobPreorderLines({ jobNumber });

    const res = NextResponse.json(payload);
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  } catch (error) {
    console.error("GET /api/jobs/[jobNumber]/job-preorders:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Failed to load job pre-orders" },
      { status: 500 },
    );
  }
}

/**
 * POST — add a job-level pre-order line (does not touch inventory).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobNumber: string }> },
) {
  try {
    const { jobNumber: rawJob } = await context.params;
    const jobNumber = decodeURIComponent(rawJob || "").trim();
    if (!jobNumber) {
      return NextResponse.json({ error: "jobNumber is required" }, { status: 400 });
    }

    const featureDisabled = jobPreorderFeatureDisabledResponse();
    if (featureDisabled) return featureDisabled;

    const session = await getServerSession(authOptions);
    const body = await request.json().catch(() => ({}));

    const denied = await assertJobPreorderWriteAccess({
      sessionUser: session?.user as any,
      jobNumber,
    });
    if (denied) return denied;

    const partNumber = String(body?.partNumber ?? "").trim();
    if (!partNumber) {
      return NextResponse.json({ error: "partNumber is required" }, { status: 400 });
    }

    const orderedAtRaw =
      body?.orderedAt != null ? String(body.orderedAt).trim() : "";
    let orderedAt: Date | null = null;
    if (orderedAtRaw) {
      const parsed = parseDateInputInAppTimeZone(orderedAtRaw);
      if (!parsed) {
        return NextResponse.json(
          { error: "Invalid orderedAt; use YYYY-MM-DD." },
          { status: 400 },
        );
      }
      orderedAt = parsed;
    }

    const line = await createJobPreorderLine({
      session,
      jobNumber,
      partNumber,
      description: body?.description != null ? String(body.description) : null,
      quantity: body?.quantity,
      uom: body?.uom != null ? String(body.uom) : null,
      vendor: body?.vendor != null ? String(body.vendor) : null,
      notes: body?.notes != null ? String(body.notes) : null,
      orderedAt,
    });

    return NextResponse.json({ line });
  } catch (error) {
    console.error("POST /api/jobs/[jobNumber]/job-preorders:", error);
    const message = (error as Error).message || "Failed to create pre-order line";
    const status = message.includes("required") || message.includes("must") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
