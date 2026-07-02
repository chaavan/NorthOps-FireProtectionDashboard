import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getJobImportSource } from '@/lib/jobImportService';
import { requireJobImportViewAccess } from '@/lib/jobImportPermissions';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ importId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const { importId } = await params;
    const access = await requireJobImportViewAccess(session, importId);
    if (!access.ok) return access.response;

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
    console.error('Error loading job import source:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load job import source.' },
      { status: 500 },
    );
  }
}
