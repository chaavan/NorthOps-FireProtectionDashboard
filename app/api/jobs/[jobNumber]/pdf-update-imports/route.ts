import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createJobImportDraft, getJobImport, listJobImports, parseJobImport } from '@/lib/jobImportService';
import { scheduleJobImportParse } from '@/lib/jobImportParseScheduler';
import { ensureJobImportReadAccess, ensureJobImportWriteAccess } from '@/lib/jobImportAccess';
import { LIST_CONTEXT_ALL } from '@/lib/jobListContext';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** Large PDFs (Document AI + OpenAI) can exceed default serverless limits; align with your host (e.g. Vercel Pro max 300s). */
export const maxDuration = 300;

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
    const listNumberContext = request.nextUrl.searchParams.get('listNumber');
    const access = await ensureJobImportReadAccess({
      session,
      jobNumber: jobNumber.trim(),
      listNumberContext,
    });
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const imports = await listJobImports({
      targetJobNumber: jobNumber.trim(),
      targetListNumber:
        listNumberContext && listNumberContext !== LIST_CONTEXT_ALL ? listNumberContext : null,
    });

    return NextResponse.json({ imports });
  } catch (error) {
    console.error('Error listing job PDF update imports:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load import history.' },
      { status: 500 },
    );
  }
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
    const listNumberContext = request.nextUrl.searchParams.get('listNumber');
    const access = await ensureJobImportWriteAccess({
      session,
      jobNumber: jobNumber.trim(),
      listNumberContext,
    });
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const jobName = String(formData.get('jobName') || '').trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'A PDF file is required.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const draft = await createJobImportDraft({
      fileName: file.name,
      contentType: file.type || 'application/pdf',
      fileBytes: buffer,
      createdBy: String((session.user as any).email || '').trim().toLowerCase(),
      mode: 'existing_job_update',
      targetJobNumber: jobNumber.trim(),
      targetListNumber:
        listNumberContext && listNumberContext !== LIST_CONTEXT_ALL ? listNumberContext : null,
      targetJobName: jobName || null,
    });

    if (process.env.VERCEL) {
      scheduleJobImportParse(draft.id);
    } else {
      await parseJobImport(draft.id);
    }

    const response = await getJobImport(draft.id);

    return NextResponse.json({
      success: response.status === 'READY',
      import: response,
    });
  } catch (error) {
    console.error('Error creating existing-job PDF update import:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create import.' },
      { status: 500 },
    );
  }
}
