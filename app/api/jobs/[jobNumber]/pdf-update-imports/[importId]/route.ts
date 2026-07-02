import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getJobImport, saveJobImportReview, jobImportBelongsToJobList } from '@/lib/jobImportService';
import { ensureJobImportReadAccess, ensureJobImportWriteAccess } from '@/lib/jobImportAccess';

export const dynamic = 'force-dynamic';

async function ensureImportMatchesJob(
  jobNumber: string,
  importId: string,
  listNumberContext?: string | null,
) {
  const jobImport = await getJobImport(importId);
  if (!jobImportBelongsToJobList(jobImport, jobNumber, listNumberContext)) {
    throw new Error('This import does not belong to the requested job.');
  }
  return jobImport;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string; importId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const { jobNumber, importId } = await params;
    const access = await ensureJobImportReadAccess({
      session,
      jobNumber: jobNumber.trim(),
      listNumberContext: request.nextUrl.searchParams.get('listNumber'),
    });
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const jobImport = await ensureImportMatchesJob(
      jobNumber,
      importId,
      request.nextUrl.searchParams.get('listNumber'),
    );
    return NextResponse.json({ import: jobImport });
  } catch (error) {
    console.error('Error loading job PDF update import:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load import.' },
      { status: 500 },
    );
  }
}

export async function PATCH(
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

    await ensureImportMatchesJob(
      jobNumber,
      importId,
      request.nextUrl.searchParams.get('listNumber'),
    );
    const body = await request.json();
    if (!body?.reviewSnapshot) {
      return NextResponse.json({ error: 'reviewSnapshot is required.' }, { status: 400 });
    }

    const saved = await saveJobImportReview(importId, {
      reviewSnapshot: body.reviewSnapshot,
      draftState: body.draftState ?? undefined,
    });
    return NextResponse.json({ import: saved });
  } catch (error) {
    console.error('Error saving job PDF update import review:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save import review.' },
      { status: 500 },
    );
  }
}
