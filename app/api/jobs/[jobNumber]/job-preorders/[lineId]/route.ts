import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertJobPreorderWriteAccess, jobPreorderFeatureDisabledResponse } from "@/lib/jobPreorderAccess";
import {
  deleteJobPreorderLine,
  updateJobPreorderLine,
} from "@/lib/jobPreorderLines";
import { parseDateInputInAppTimeZone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ jobNumber: string; lineId: string }> },
) {
  try {
    const { jobNumber: rawJob, lineId } = await context.params;
    const jobNumber = decodeURIComponent(rawJob || "").trim();
    const id = String(lineId || "").trim();
    if (!jobNumber || !id) {
      return NextResponse.json(
        { error: "jobNumber and lineId are required" },
        { status: 400 },
      );
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

    const orderedAtRaw =
      body?.orderedAt != null ? String(body.orderedAt).trim() : undefined;
    let orderedAtPatch: Date | undefined;
    if (orderedAtRaw) {
      const parsed = parseDateInputInAppTimeZone(orderedAtRaw);
      if (!parsed) {
        return NextResponse.json(
          { error: "Invalid orderedAt; use YYYY-MM-DD." },
          { status: 400 },
        );
      }
      orderedAtPatch = parsed;
    }

    const patch: Parameters<typeof updateJobPreorderLine>[0]["patch"] = {};
    if (body?.quantity !== undefined) patch.quantity = Number(body.quantity);
    if (body?.vendor !== undefined) patch.vendor = body.vendor;
    if (body?.notes !== undefined) patch.notes = body.notes;
    if (body?.description !== undefined) patch.description = body.description;
    if (body?.uom !== undefined) patch.uom = body.uom;
    if (body?.status !== undefined) patch.status = String(body.status);
    if (body?.partNumber !== undefined) patch.partNumber = String(body.partNumber);
    if (body?.receiveQuantity !== undefined) {
      patch.receiveQuantity = Number(body.receiveQuantity);
    }
    if (body?.unreceiveQuantity !== undefined) {
      patch.unreceiveQuantity = Number(body.unreceiveQuantity);
    }
    if (orderedAtPatch !== undefined) patch.orderedAt = orderedAtPatch;

    const line = await updateJobPreorderLine({ id, jobNumber, patch });
    if (!line) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ line });
  } catch (error) {
    console.error("PATCH .../job-preorders/[lineId]:", error);
    const message = (error as Error).message || "Failed to update";
    const status = message.includes("Invalid") || message.includes("must") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ jobNumber: string; lineId: string }> },
) {
  try {
    const { jobNumber: rawJob, lineId } = await context.params;
    const jobNumber = decodeURIComponent(rawJob || "").trim();
    const id = String(lineId || "").trim();
    if (!jobNumber || !id) {
      return NextResponse.json(
        { error: "jobNumber and lineId are required" },
        { status: 400 },
      );
    }

    const featureDisabled = jobPreorderFeatureDisabledResponse();
    if (featureDisabled) return featureDisabled;

    const session = await getServerSession(authOptions);
    const denied = await assertJobPreorderWriteAccess({
      sessionUser: session?.user as any,
      jobNumber,
    });
    if (denied) return denied;

    const ok = await deleteJobPreorderLine({ id, jobNumber });
    if (!ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE .../job-preorders/[lineId]:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Failed to delete" },
      { status: 500 },
    );
  }
}
