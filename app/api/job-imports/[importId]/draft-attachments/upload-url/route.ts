import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireJobImportEditAccess } from '@/lib/jobImportPermissions';
import { isR2Configured } from '@/lib/r2';

export const dynamic = 'force-dynamic';

function extensionForContentType(contentType: string): string {
  const mimeSuffix = contentType.includes('/') ? contentType.split('/')[1] : '';
  const normalizedMimeExt = mimeSuffix.split(';')[0].toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  return normalizedMimeExt || 'bin';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ importId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const { importId } = await params;
    const access = await requireJobImportEditAccess(session, importId);
    if (!access.ok) return access.response;

    if (!isR2Configured()) {
      return NextResponse.json(
        { error: 'File storage (R2) is not configured. Please contact support.' },
        { status: 503 },
      );
    }

    const body = await request.json();
    const contentType = typeof body?.contentType === 'string' ? body.contentType.trim() : '';
    if (!contentType) {
      return NextResponse.json({ error: 'contentType is required' }, { status: 400 });
    }

    const uuid = crypto.randomUUID();
    const r2Key = `job-imports/${encodeURIComponent(importId)}/draft-attachments/${uuid}.${extensionForContentType(contentType)}`;

    return NextResponse.json({ r2Key });
  } catch (error) {
    console.error('Error creating import draft attachment upload URL:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create upload URL.' },
      { status: 500 },
    );
  }
}
