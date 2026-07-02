import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '@/lib/auth';
import { hasPermission, getEffectivePermissionsForSession } from '@/lib/permissions';
import { bypassesJobAccessList } from '@/lib/jobScopedAccess';
import { canAccessJob, jobHasAccessRecords } from '@/lib/jobAccess';
import { reverseJobStockReturn } from '@/lib/jobStockReturnReversal';
import { validateStockInUndoReason } from '@/lib/stockBackPdfShared';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

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

    const sessionUser = session.user as any;
    const role = sessionUser.role;
    const email = typeof sessionUser.email === 'string' ? sessionUser.email : '';
    const permissionDetails = await getEffectivePermissionsForSession(session);
    const bypassJobAccess = bypassesJobAccessList(role, permissionDetails);

    if (!(await hasPermission(session, 'job.stock_back.undo', { jobNumber: normalizedJobNumber }))) {
      return NextResponse.json({ error: 'Forbidden - Job edit access required' }, { status: 403 });
    }

    if (!bypassJobAccess) {
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
    const undoReason = typeof body?.undoReason === 'string' ? body.undoReason : '';
    const reasonError = validateStockInUndoReason(undoReason);
    if (reasonError) {
      return NextResponse.json({ error: reasonError }, { status: 400 });
    }

    const result = await prisma.$transaction((tx) =>
      reverseJobStockReturn(tx, {
        jobNumber: normalizedJobNumber,
        returnId: normalizedReturnId,
        actorUserId,
        undoReason,
      }),
    );

    return NextResponse.json({
      success: true,
      stockReturn: result,
    });
  } catch (error) {
    const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500;
    console.error('Error in /api/jobs/[jobNumber]/stock-back/[returnId]/undo POST:', error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
