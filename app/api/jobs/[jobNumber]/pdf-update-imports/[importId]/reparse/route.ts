import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getJobImport, reparseJobImport } from '@/lib/jobImportService';
import { ensureJobImportWriteAccess } from '@/lib/jobImportAccess';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

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

    const reparsed = await reparseJobImport(importId);
    return NextResponse.json({ import: reparsed });
  } catch (error) {
    console.error('Error reparsing job PDF update import:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reparse import.' },
      { status: 500 },
    );
  }
}
