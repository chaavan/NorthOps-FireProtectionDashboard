import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { MovementType, type Prisma } from '@prisma/client';
import { authOptions, isAdmin } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { canAccessJob, jobHasAccessRecords } from '@/lib/jobAccess';
import { getJobStockBackSummary } from '@/lib/jobStockBack';
import { JOB_CONTEXT_TYPE, recordOperationalDelta } from '@/lib/inventoryLedger';
import { buildStockBackPdfDocument } from '@/lib/stockBackCost';
import {
  buildJobStockReturnNestedLineCreates,
  type StockInReturnLineInput,
} from '@/lib/jobStockReturnWrite';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type StockBackLineInput = {
  partId?: unknown;
  partNumber?: unknown;
  quantity?: unknown;
};

function parsePositiveQuantity(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

async function resolveActorUserId(sessionUser: any) {
  const rawId = typeof sessionUser?.id === 'string' ? sessionUser.id.trim() : '';
  if (rawId) {
    const user = await prisma.user.findUnique({
      where: { id: rawId },
      select: { id: true },
    });
    if (user) return user.id;
  }

  const email = typeof sessionUser?.email === 'string' ? sessionUser.email.trim() : '';
  if (email) {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (user) return user.id;
  }

  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const { jobNumber } = await params;
    const normalizedJobNumber = jobNumber?.trim();
    if (!normalizedJobNumber) {
      return NextResponse.json({ error: 'jobNumber is required' }, { status: 400 });
    }

    const sessionUser = session.user as any;
    const role = sessionUser.role;
    const email = typeof sessionUser.email === 'string' ? sessionUser.email : '';
    const isUserAdmin = isAdmin(role);

    if (!(await hasPermission(session, 'job.stock_back.create', { jobNumber: normalizedJobNumber }))) {
      return NextResponse.json({ error: 'Forbidden - Job edit access required' }, { status: 403 });
    }

    if (!isUserAdmin) {
      const hasRecords = await jobHasAccessRecords(normalizedJobNumber);
      if (hasRecords) {
        const hasAccess = email ? await canAccessJob(email, normalizedJobNumber) : false;
        if (!hasAccess) {
          return NextResponse.json({ error: 'Forbidden - You do not have access to this job' }, { status: 403 });
        }
      }
      // No access records means the job is open - fall through and allow.
    }

    const actorUserId = await resolveActorUserId(sessionUser);
    if (!actorUserId) {
      return NextResponse.json({ error: 'Unable to resolve current user' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const note = typeof body?.note === 'string' ? body.note.trim() : '';
    const rawLines = Array.isArray(body?.lines) ? (body.lines as StockBackLineInput[]) : [];

    const requestedByPartNumber = new Map<string, number>();
    for (const line of rawLines) {
      const partNumber = typeof line.partNumber === 'string' ? line.partNumber.trim() : '';
      const quantity = parsePositiveQuantity(line.quantity);
      if (!partNumber || quantity <= 0) continue;
      requestedByPartNumber.set(
        partNumber,
        (requestedByPartNumber.get(partNumber) ?? 0) + quantity,
      );
    }

    if (requestedByPartNumber.size === 0) {
      return NextResponse.json(
        { error: 'At least one return quantity is required' },
        { status: 400 },
      );
    }

    const txResult = await prisma.$transaction(
      async (tx) => {
      const summary = await getJobStockBackSummary(tx, normalizedJobNumber);
      const summaryByPartNumber = new Map(
        summary.parts.map((part) => [part.partNumber, part]),
      );

      const linesToReturn: StockInReturnLineInput[] = [];

      for (const [partNumber, quantity] of requestedByPartNumber.entries()) {
        const summaryPart = summaryByPartNumber.get(partNumber);
        if (!summaryPart || !summaryPart.partId || !summaryPart.returnable) {
          throw Object.assign(new Error(`Part ${partNumber} is not returnable`), {
            status: 409,
          });
        }
        if (quantity > summaryPart.remainingReturnableQuantity) {
          throw Object.assign(
            new Error(
              `Return quantity for ${partNumber} exceeds remaining eligible quantity (${summaryPart.remainingReturnableQuantity})`,
            ),
            { status: 409 },
          );
        }
        linesToReturn.push({
          partId: summaryPart.partId,
          partNumber,
          quantity,
          sentShopQuantity: summaryPart.shopQuantity,
          sentVendorQuantity: summaryPart.vendorQuantity,
        });
      }

      const stockReturn = await tx.jobStockReturn.create({
        data: {
          jobNumber: normalizedJobNumber,
          actorUserId,
          note: note || null,
          lines: {
            create: buildJobStockReturnNestedLineCreates(
              normalizedJobNumber,
              linesToReturn,
            ),
          },
        },
        select: { id: true, createdAt: true },
      });

      for (const line of linesToReturn) {
        await recordOperationalDelta(tx, {
          partId: line.partId,
          signedDelta: line.quantity,
          movementType: MovementType.UNPULL,
          contextType: JOB_CONTEXT_TYPE,
          contextId: normalizedJobNumber,
          actorUserId,
          note: note
            ? `Stock in from job ${normalizedJobNumber} | ${note}`
            : `Stock in from job ${normalizedJobNumber}`,
        });
      }

      return {
        id: stockReturn.id,
        createdAt: stockReturn.createdAt,
        returnedLineCount: linesToReturn.length,
        returnedQuantity: linesToReturn.reduce((sum, line) => sum + line.quantity, 0),
        linesToReturn,
        summaryByPartNumber,
      };
    },
      { maxWait: 10_000, timeout: 30_000 },
    );

    const pdfDocument = await buildStockBackPdfDocument(prisma, {
      jobNumber: normalizedJobNumber,
      stockReturnId: txResult.id,
      note: note || null,
      createdAt: txResult.createdAt,
      lines: txResult.linesToReturn.map((line) => {
        const summaryPart = txResult.summaryByPartNumber.get(line.partNumber);
        return {
          partNumber: line.partNumber,
          quantity: line.quantity,
          description: summaryPart?.description ?? null,
        };
      }),
    });

    await prisma.jobStockReturn.update({
      where: { id: txResult.id },
      data: { pdfDocument: pdfDocument as Prisma.InputJsonValue },
    });

    const result = {
      id: txResult.id,
      returnedLineCount: txResult.returnedLineCount,
      returnedQuantity: txResult.returnedQuantity,
      pdfDocument,
    };

    return NextResponse.json({
      success: true,
      jobNumber: normalizedJobNumber,
      stockReturn: {
        id: result.id,
        returnedLineCount: result.returnedLineCount,
        returnedQuantity: result.returnedQuantity,
      },
      pdfDocument: result.pdfDocument,
    });
  } catch (error) {
    const message = (error as Error).message ?? 'Unknown error';
    const status =
      typeof (error as { status?: number }).status === 'number'
        ? (error as { status: number }).status
        : message.includes('Transaction not found') ||
            message.includes('Transaction API error')
          ? 503
          : 500;
    console.error('Error in /api/jobs/[jobNumber]/stock-back POST:', error);
    const friendlyMessage =
      status === 503
        ? 'Stock-in failed due to a database timing issue. Please try again.'
        : message;
    return NextResponse.json({ error: friendlyMessage }, { status });
  }
}
