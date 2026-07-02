import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessJob } from '@/lib/jobAccess';
import { getEffectivePermissionsForSession } from '@/lib/permissions';
import { bypassesJobAccessList } from '@/lib/jobScopedAccess';
import { prisma } from '@/lib/prisma';
import { getJobStockBackSummary } from '@/lib/jobStockBack';

export const dynamic = 'force-dynamic';

export async function GET(
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

    const role = (session.user as any).role;
    const email = (session.user as any).email;
    const permissionDetails = await getEffectivePermissionsForSession(session);
    const allowed =
      bypassesJobAccessList(role, permissionDetails) ||
      (email ? await canAccessJob(email, normalizedJobNumber) : false);

    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden - Job access required' }, { status: 403 });
    }

    const summary = await getJobStockBackSummary(prisma, normalizedJobNumber);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('Error in /api/jobs/[jobNumber]/stock-back-summary GET:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
