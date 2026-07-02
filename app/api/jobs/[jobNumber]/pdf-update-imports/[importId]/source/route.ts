import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getJobImport, getJobImportSource, jobImportBelongsToJobList } from '@/lib/jobImportService';
import { ensureJobImportReadAccess } from '@/lib/jobImportAccess';

export const dynamic = 'force-dynamic';

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
    const listNumberContext = request.nextUrl.searchParams.get('listNumber');
    const access = await ensureJobImportReadAccess({
      session,
      jobNumber: jobNumber.trim(),
      listNumberContext,
    });
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const jobImport = await getJobImport(importId);
    if (!jobImportBelongsToJobList(jobImport, jobNumber, listNumberContext)) {
      return NextResponse.json(
        { error: 'This import does not belong to the requested job.' },
        { status: 404 },
      );
    }

    const source = await getJobImportSource(importId);

    return new NextResponse(new Uint8Array(source.fileBytes), {
      status: 200,
      headers: {
        'Content-Type': source.contentType,
        'Content-Disposition': `inline; filename="${source.fileName.replace(/"/g, '')}"`,
        'Content-Length': String(source.fileBytes.length),
      },
    });
  } catch (error) {
    console.error('Error loading job PDF update import source:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load import source file.' },
      { status: 500 },
    );
  }
}
