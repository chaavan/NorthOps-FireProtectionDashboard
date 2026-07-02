import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { commitJobImport, getJobImport } from '@/lib/jobImportService';
import { ensureJobImportWriteAccess } from '@/lib/jobImportAccess';
import { isInitialJobAccessGrantsError } from '@/lib/initialJobAccessGrants';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string; importId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const { jobNumber, importId } = await params;
    const access = await ensureJobImportWriteAccess({
      session,
      jobNumber: jobNumber.trim(),
      listNumberContext: request.nextUrl.searchParams.get('listNumber'),
    });
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const existingImport = await getJobImport(importId);
    if (existingImport.mode !== 'existing_job_update' || existingImport.targetJobNumber !== jobNumber.trim()) {
      return NextResponse.json({ error: 'This import does not belong to the requested job.' }, { status: 400 });
    }

    const body = await request.json();
    if (!body?.reviewSnapshot) {
      return NextResponse.json({ error: 'reviewSnapshot is required.' }, { status: 400 });
    }

    const role = (session.user as any).role as string | undefined;
    const result = await commitJobImport(
      importId,
      {
        reviewSnapshot: body.reviewSnapshot,
        accessGrants: body.accessGrants,
      },
      {
        email: String((session.user as any).email || '').trim().toLowerCase(),
        name: (session.user as any).name || null,
        role: role ?? null,
      },
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error committing job PDF update import:', error);
    if (isInitialJobAccessGrantsError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to commit import.' },
      { status: 500 },
    );
  }
}
