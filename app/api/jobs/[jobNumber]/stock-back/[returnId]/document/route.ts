import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { canAccessJob, jobHasAccessRecords } from '@/lib/jobAccess';
import { JOB_STOCK_RETURN_STATUS } from '@/lib/jobStockReturnStatus';
import { buildStockBackPdfDocument } from '@/lib/stockBackCost';
import { parseStoredStockBackPdfDocument, type StockBackPdfDocument } from '@/lib/stockBackPdfShared';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string; returnId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const { jobNumber, returnId } = await params;
    const normalizedJobNumber = jobNumber?.trim();
    const normalizedReturnId = returnId?.trim();
    if (!normalizedJobNumber || !normalizedReturnId) {
      return NextResponse.json({ error: 'jobNumber and returnId are required' }, { status: 400 });
    }

    const role = (session.user as { role?: string }).role;
    const email =
      typeof (session.user as { email?: string }).email === 'string'
        ? (session.user as { email: string }).email
        : '';
    const isUserAdmin = isAdmin(role);

    if (!(await hasPermission(session, 'job.stock_back.view', { jobNumber: normalizedJobNumber }))) {
      return NextResponse.json({ error: 'Forbidden - Job access required' }, { status: 403 });
    }

    if (!isUserAdmin) {
      const hasRecords = await jobHasAccessRecords(normalizedJobNumber);
      if (hasRecords) {
        const hasAccess = email.length > 0 ? await canAccessJob(email, normalizedJobNumber) : false;
        if (!hasAccess) {
          return NextResponse.json({ error: 'Forbidden - You do not have access to this job' }, { status: 403 });
        }
      }
      // No access records means the job is open - fall through and allow.
    }

    const stockReturn = await prisma.jobStockReturn.findFirst({
      where: {
        id: normalizedReturnId,
        jobNumber: normalizedJobNumber,
      },
      select: {
        id: true,
        jobNumber: true,
        note: true,
        status: true,
        reverseReason: true,
        deleteReason: true,
        reversedAt: true,
        deletedAt: true,
        pdfDocument: true,
        createdAt: true,
        lines: {
          orderBy: { partNumber: 'asc' },
          select: {
            partNumber: true,
            returnedQuantity: true,
          },
        },
      },
    });

    if (!stockReturn) {
      return NextResponse.json({ error: 'Stock-back record not found' }, { status: 404 });
    }

    const storedDocument = parseStoredStockBackPdfDocument(stockReturn.pdfDocument);
    let document: StockBackPdfDocument =
      storedDocument ??
      (await buildStockBackPdfDocument(prisma, {
        jobNumber: stockReturn.jobNumber,
        stockReturnId: stockReturn.id,
        note: stockReturn.note,
        createdAt: stockReturn.createdAt,
        lines: stockReturn.lines.map((line) => ({
          partNumber: line.partNumber,
          quantity: line.returnedQuantity,
        })),
      }));

    if (stockReturn.status !== JOB_STOCK_RETURN_STATUS.ACTIVE) {
      const voidedAt =
        stockReturn.deletedAt?.toISOString() ??
        stockReturn.reversedAt?.toISOString() ??
        document.voidedAt ??
        new Date().toISOString();
      document = {
        ...document,
        status:
          stockReturn.status === JOB_STOCK_RETURN_STATUS.DELETED ? 'DELETED' : 'REVERSED',
        voidedAt,
        voidReason:
          stockReturn.status === JOB_STOCK_RETURN_STATUS.DELETED
            ? stockReturn.deleteReason
            : stockReturn.reverseReason ?? document.voidReason ?? null,
      };
    }

    return NextResponse.json({ document, stored: Boolean(storedDocument) });
  } catch (error) {
    console.error(
      'Error in /api/jobs/[jobNumber]/stock-back/[returnId]/document GET:',
      error,
    );
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
