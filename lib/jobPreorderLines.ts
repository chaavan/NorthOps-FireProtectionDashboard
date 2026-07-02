import { prisma } from "@/lib/prisma";
import {
  jobPreorderLineAggregateKey,
  jobPreorderPartKey,
  normalizeJobPartKey,
} from "@/lib/jobPartKey";
import { resolveSessionUserIdForAudit } from "@/lib/auth";
import {
  JOB_PREORDER_STATUSES,
  type JobPreorderStatus,
  isJobPreorderStatus,
} from "@/lib/jobPreorderConstants";
export { JOB_PREORDER_STATUSES, type JobPreorderStatus };

export type JobPreorderLineDto = {
  id: string;
  jobNumber: string;
  partNumber: string;
  description: string | null;
  quantity: number;
  quantityReceived: number;
  uom: string | null;
  vendor: string | null;
  notes: string | null;
  orderedAt: string;
  status: string;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobPreorderPoolPayload = {
  lines: JobPreorderLineDto[];
  openByPart: Record<string, number>;
  receivedByPart: Record<string, number>;
  pendingByPart: Record<string, number>;
  poolAvailableByPart: Record<string, number>;
  pulledByLine: Record<string, number>;
};

function toDto(row: {
  id: string;
  jobNumber: string;
  partNumber: string;
  description: string | null;
  quantity: number;
  quantityReceived: number;
  uom: string | null;
  vendor: string | null;
  notes: string | null;
  orderedAt: Date;
  status: string;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}): JobPreorderLineDto {
  return {
    id: row.id,
    jobNumber: row.jobNumber,
    partNumber: row.partNumber,
    description: row.description,
    quantity: row.quantity,
    quantityReceived: row.quantityReceived,
    uom: row.uom,
    vendor: row.vendor,
    notes: row.notes,
    orderedAt: row.orderedAt.toISOString(),
    status: row.status,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function deriveStatus(quantity: number, quantityReceived: number): string {
  if (quantityReceived >= quantity && quantity > 0) return "RECEIVED";
  return "OPEN";
}

function buildPartTotalsMaps(
  lines: Array<{
    partNumber: string;
    quantity: number;
    quantityReceived: number;
    status: string;
  }>,
): {
  openByPart: Record<string, number>;
  receivedByPart: Record<string, number>;
  pendingByPart: Record<string, number>;
} {
  const openByPart: Record<string, number> = {};
  const receivedByPart: Record<string, number> = {};
  const pendingByPart: Record<string, number> = {};

  for (const line of lines) {
    if (line.status === "CANCELLED") continue;
    const key = jobPreorderPartKey(line.partNumber);
    const qty = Math.max(0, line.quantity);
    const recv = Math.max(0, Math.min(line.quantityReceived, qty));
    receivedByPart[key] = (receivedByPart[key] ?? 0) + recv;
    const pending = Math.max(0, qty - recv);
    pendingByPart[key] = (pendingByPart[key] ?? 0) + pending;
    if (line.status === "OPEN" || pending > 0) {
      openByPart[key] = (openByPart[key] ?? 0) + pending;
    }
  }

  return { openByPart, receivedByPart, pendingByPart };
}

export async function getJobPreorderPulledByLine(
  jobNumber: string,
): Promise<Record<string, number>> {
  const rows = await prisma.job.findMany({
    where: { jobNumber: jobNumber.trim() },
    select: {
      listNumber: true,
      partNumber: true,
      quantityPulledFromPreorder: true,
    },
  });

  const pulledByLine: Record<string, number> = {};
  for (const row of rows) {
    const pulled = Math.max(0, row.quantityPulledFromPreorder ?? 0);
    if (pulled <= 0) continue;
    const key = jobPreorderLineAggregateKey(row.listNumber, row.partNumber);
    pulledByLine[key] = (pulledByLine[key] ?? 0) + pulled;
  }
  return pulledByLine;
}

export async function getJobPreorderPoolState(
  jobNumber: string,
): Promise<{
  openByPart: Record<string, number>;
  receivedByPart: Record<string, number>;
  pendingByPart: Record<string, number>;
  poolAvailableByPart: Record<string, number>;
  pulledByLine: Record<string, number>;
  totalPulledByPart: Record<string, number>;
}> {
  const lines = await prisma.jobPreorderLine.findMany({
    where: { jobNumber: jobNumber.trim(), status: { not: "CANCELLED" } },
    select: {
      partNumber: true,
      quantity: true,
      quantityReceived: true,
      status: true,
    },
  });

  const { openByPart, receivedByPart, pendingByPart } =
    buildPartTotalsMaps(lines);

  const jobRows = await prisma.job.findMany({
    where: { jobNumber: jobNumber.trim() },
    select: {
      listNumber: true,
      partNumber: true,
      quantityPulledFromPreorder: true,
    },
  });

  const pulledByLine: Record<string, number> = {};
  const totalPulledByPart: Record<string, number> = {};
  for (const row of jobRows) {
    const pulled = Math.max(0, row.quantityPulledFromPreorder ?? 0);
    if (pulled <= 0) continue;
    const lineKey = jobPreorderLineAggregateKey(row.listNumber, row.partNumber);
    const partKey = jobPreorderPartKey(row.partNumber);
    pulledByLine[lineKey] = (pulledByLine[lineKey] ?? 0) + pulled;
    totalPulledByPart[partKey] =
      (totalPulledByPart[partKey] ?? 0) + pulled;
  }

  const poolAvailableByPart: Record<string, number> = {};
  for (const [partKey, received] of Object.entries(receivedByPart)) {
    const pulled = totalPulledByPart[partKey] ?? 0;
    poolAvailableByPart[partKey] = Math.max(0, received - pulled);
  }

  return {
    openByPart,
    receivedByPart,
    pendingByPart,
    poolAvailableByPart,
    pulledByLine,
    totalPulledByPart,
  };
}

export async function validatePreorderPullForJob(params: {
  jobNumber: string;
  partNumber: string;
  nextTotalPulled: number;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const partKey = jobPreorderPartKey(params.partNumber);
  const pool = await getJobPreorderPoolState(params.jobNumber.trim());
  const received = pool.receivedByPart[partKey] ?? 0;
  if (params.nextTotalPulled > received) {
    return {
      ok: false,
      message: `Cannot pull more than received pre-order stock (${received} available received for this part on the job).`,
    };
  }
  return { ok: true };
}

export async function listJobPreorderLines(params: {
  jobNumber: string;
}): Promise<JobPreorderPoolPayload> {
  const jobNumber = params.jobNumber.trim();

  const rows = await prisma.jobPreorderLine.findMany({
    where: { jobNumber },
    orderBy: [{ orderedAt: "desc" }, { createdAt: "desc" }],
  });

  const lines = rows.map(toDto);
  const { openByPart, receivedByPart, pendingByPart } =
    buildPartTotalsMaps(rows);
  const pool = await getJobPreorderPoolState(jobNumber);

  return {
    lines,
    openByPart,
    receivedByPart,
    pendingByPart,
    poolAvailableByPart: pool.poolAvailableByPart,
    pulledByLine: pool.pulledByLine,
  };
}

export async function createJobPreorderLine(params: {
  session: Parameters<typeof resolveSessionUserIdForAudit>[0];
  jobNumber: string;
  partNumber: string;
  description?: string | null;
  quantity: number;
  uom?: string | null;
  vendor?: string | null;
  notes?: string | null;
  orderedAt?: Date | null;
}): Promise<JobPreorderLineDto> {
  const createdById = await resolveSessionUserIdForAudit(params.session);
  const partNumber = params.partNumber.trim();
  if (!partNumber) {
    throw new Error("partNumber is required");
  }
  const qty = Math.floor(Number(params.quantity));
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("quantity must be a positive integer");
  }

  const row = await prisma.jobPreorderLine.create({
    data: {
      jobNumber: params.jobNumber.trim(),
      partNumber,
      description: params.description?.trim() || null,
      quantity: qty,
      quantityReceived: 0,
      uom: params.uom?.trim() || null,
      vendor: params.vendor?.trim() || null,
      notes: params.notes?.trim() || null,
      orderedAt: params.orderedAt ?? new Date(),
      status: "OPEN",
      createdById,
    },
  });

  return toDto(row);
}

export async function unreceiveJobPreorderLine(params: {
  id: string;
  jobNumber: string;
  unreceiveQuantity: number;
}): Promise<JobPreorderLineDto | null> {
  const existing = await prisma.jobPreorderLine.findFirst({
    where: { id: params.id, jobNumber: params.jobNumber.trim() },
  });
  if (!existing) return null;
  if (existing.status === "CANCELLED") {
    throw new Error("Cannot undo receive on a cancelled pre-order line");
  }
  if (existing.quantityReceived <= 0) {
    throw new Error("Nothing received on this line to undo");
  }

  const delta = Math.floor(Number(params.unreceiveQuantity));
  if (!Number.isFinite(delta) || delta <= 0) {
    throw new Error("unreceiveQuantity must be a positive integer");
  }
  if (delta > existing.quantityReceived) {
    throw new Error("Cannot undo more than received on this line");
  }

  const pool = await getJobPreorderPoolState(params.jobNumber);
  const partKey = jobPreorderPartKey(existing.partNumber);
  const poolAvailable = pool.poolAvailableByPart[partKey] ?? 0;
  if (delta > poolAvailable) {
    throw new Error(
      poolAvailable <= 0
        ? "Cannot undo — received stock for this part has already been pulled from the pool"
        : `Cannot undo ${delta} — only ${poolAvailable} not yet pulled from the pool for this part`,
    );
  }

  const nextReceived = Math.max(0, existing.quantityReceived - delta);
  const row = await prisma.jobPreorderLine.update({
    where: { id: existing.id },
    data: {
      quantityReceived: nextReceived,
      status: deriveStatus(existing.quantity, nextReceived),
    },
  });
  return toDto(row);
}

export async function receiveJobPreorderLine(params: {
  id: string;
  jobNumber: string;
  receiveQuantity: number;
}): Promise<JobPreorderLineDto | null> {
  const existing = await prisma.jobPreorderLine.findFirst({
    where: { id: params.id, jobNumber: params.jobNumber.trim() },
  });
  if (!existing) return null;
  if (existing.status === "CANCELLED") {
    throw new Error("Cannot receive a cancelled pre-order line");
  }

  const delta = Math.floor(Number(params.receiveQuantity));
  if (!Number.isFinite(delta) || delta <= 0) {
    throw new Error("receiveQuantity must be a positive integer");
  }

  const nextReceived = Math.min(
    existing.quantity,
    Math.max(0, existing.quantityReceived) + delta,
  );
  const row = await prisma.jobPreorderLine.update({
    where: { id: existing.id },
    data: {
      quantityReceived: nextReceived,
      status: deriveStatus(existing.quantity, nextReceived),
    },
  });
  return toDto(row);
}

export async function updateJobPreorderLine(params: {
  id: string;
  jobNumber: string;
  patch: {
    quantity?: number;
    vendor?: string | null;
    notes?: string | null;
    description?: string | null;
    uom?: string | null;
    orderedAt?: Date | null;
    status?: string;
    partNumber?: string;
    receiveQuantity?: number;
    unreceiveQuantity?: number;
  };
}): Promise<JobPreorderLineDto | null> {
  if (
    params.patch.receiveQuantity !== undefined &&
    params.patch.unreceiveQuantity !== undefined
  ) {
    throw new Error("Cannot receive and undo receive in the same request");
  }
  if (params.patch.receiveQuantity !== undefined) {
    return receiveJobPreorderLine({
      id: params.id,
      jobNumber: params.jobNumber,
      receiveQuantity: params.patch.receiveQuantity,
    });
  }
  if (params.patch.unreceiveQuantity !== undefined) {
    return unreceiveJobPreorderLine({
      id: params.id,
      jobNumber: params.jobNumber,
      unreceiveQuantity: params.patch.unreceiveQuantity,
    });
  }

  const existing = await prisma.jobPreorderLine.findFirst({
    where: { id: params.id, jobNumber: params.jobNumber.trim() },
  });
  if (!existing) return null;

  const data: Record<string, unknown> = {};

  if (params.patch.quantity !== undefined) {
    const q = Math.floor(Number(params.patch.quantity));
    if (!Number.isFinite(q) || q <= 0) {
      throw new Error("quantity must be a positive integer");
    }
    if (q < existing.quantityReceived) {
      throw new Error("quantity cannot be less than quantity already received");
    }
    data.quantity = q;
    data.status = deriveStatus(q, existing.quantityReceived);
  }
  if (params.patch.vendor !== undefined) {
    data.vendor =
      params.patch.vendor === null ? null : params.patch.vendor.trim() || null;
  }
  if (params.patch.notes !== undefined) {
    data.notes =
      params.patch.notes === null ? null : params.patch.notes.trim() || null;
  }
  if (params.patch.description !== undefined) {
    data.description =
      params.patch.description === null
        ? null
        : params.patch.description.trim() || null;
  }
  if (params.patch.uom !== undefined) {
    data.uom =
      params.patch.uom === null ? null : params.patch.uom.trim() || null;
  }
  if (params.patch.orderedAt !== undefined) {
    data.orderedAt = params.patch.orderedAt;
  }
  if (params.patch.status !== undefined) {
    const s = String(params.patch.status).trim().toUpperCase();
    if (!isJobPreorderStatus(s)) {
      throw new Error("Invalid status");
    }
    if (s === "CANCELLED" && existing.quantityReceived > 0) {
      const pulled = await getJobPreorderPoolState(params.jobNumber);
      const partKey = jobPreorderPartKey(existing.partNumber);
      if ((pulled.totalPulledByPart[partKey] ?? 0) > 0) {
        throw new Error(
          "Cannot cancel a line with received stock that has been pulled on lists",
        );
      }
    }
    if (s === "RECEIVED") {
      data.quantityReceived = existing.quantity;
    }
    if (s === "OPEN" && existing.quantityReceived > 0) {
      throw new Error("Cannot reopen a line that has received quantity");
    }
    data.status = s;
  }
  if (params.patch.partNumber !== undefined) {
    const pn = params.patch.partNumber.trim();
    if (!pn) throw new Error("partNumber cannot be empty");
    data.partNumber = pn;
  }

  if (Object.keys(data).length === 0) {
    return toDto(existing);
  }

  const row = await prisma.jobPreorderLine.update({
    where: { id: existing.id },
    data: data as any,
  });
  return toDto(row);
}

export async function deleteJobPreorderLine(params: {
  id: string;
  jobNumber: string;
}): Promise<boolean> {
  const existing = await prisma.jobPreorderLine.findFirst({
    where: { id: params.id, jobNumber: params.jobNumber.trim() },
  });
  if (!existing) return false;
  if (existing.quantityReceived > 0) {
    const pool = await getJobPreorderPoolState(params.jobNumber);
    const partKey = jobPreorderPartKey(existing.partNumber);
    if ((pool.totalPulledByPart[partKey] ?? 0) > 0) {
      throw new Error(
        "Cannot delete a line with received stock that has been pulled on lists",
      );
    }
  }

  const result = await prisma.jobPreorderLine.deleteMany({
    where: { id: params.id, jobNumber: params.jobNumber.trim() },
  });
  return result.count > 0;
}

/** Job+part aggregate key used by admin order routes. */
export function jobPreorderJobPartKey(
  jobNumber: string,
  partNumber: string | null | undefined,
): string {
  return `${jobNumber.trim()}::${jobPreorderPartKey(partNumber)}`;
}

export async function getJobPreorderReceivedByJobPart(
  jobNumbers: string[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (jobNumbers.length === 0) return totals;

  const rows = await prisma.jobPreorderLine.groupBy({
    by: ["jobNumber", "partNumber"],
    where: {
      jobNumber: { in: jobNumbers },
      status: { not: "CANCELLED" },
    },
    _sum: { quantityReceived: true },
  });

  for (const row of rows) {
    const key = jobPreorderJobPartKey(row.jobNumber, row.partNumber);
    totals.set(key, Number(row._sum.quantityReceived || 0));
  }
  return totals;
}

export async function getJobPreorderOpenByJobPart(
  jobNumbers: string[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (jobNumbers.length === 0) return totals;

  const lines = await prisma.jobPreorderLine.findMany({
    where: {
      jobNumber: { in: jobNumbers },
      status: { not: "CANCELLED" },
    },
    select: { jobNumber: true, partNumber: true, quantity: true, quantityReceived: true },
  });

  for (const line of lines) {
    const pending = Math.max(0, line.quantity - line.quantityReceived);
    if (pending <= 0) continue;
    const key = jobPreorderJobPartKey(line.jobNumber, line.partNumber);
    totals.set(key, (totals.get(key) ?? 0) + pending);
  }
  return totals;
}
