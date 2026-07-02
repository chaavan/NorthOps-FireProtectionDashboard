import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireJobImportEditAccess } from '@/lib/jobImportPermissions';
import { isR2Configured, putR2Object } from '@/lib/r2';

export const dynamic = 'force-dynamic';

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

function buildExpectedR2KeyPrefix(importId: string): string {
  return `job-imports/${encodeURIComponent(importId)}/draft-attachments/`;
}

/**
 * POST /api/job-imports/[importId]/draft-attachments/upload
 * Uploads attachment bytes to R2 through the app server (avoids browser CORS to R2).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ importId: string }> },
) {
  try {
    if (!isR2Configured()) {
      return NextResponse.json(
        { error: 'File storage (R2) is not configured. Please contact support.' },
        { status: 503 },
      );
    }

    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const { importId } = await params;
    const access = await requireJobImportEditAccess(session, importId);
    if (!access.ok) return access.response;

    const formData = await request.formData();
    const file = formData.get('file');
    const r2KeyRaw = formData.get('r2Key');
    const contentTypeRaw = formData.get('contentType');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    if (typeof r2KeyRaw !== 'string' || !r2KeyRaw.trim()) {
      return NextResponse.json({ error: 'r2Key is required' }, { status: 400 });
    }

    const r2Key = r2KeyRaw.trim();
    const expectedPrefix = buildExpectedR2KeyPrefix(importId);
    if (!r2Key.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: 'r2Key is invalid for this import.' }, { status: 400 });
    }

    const contentType =
      typeof contentTypeRaw === 'string' && contentTypeRaw.trim()
        ? contentTypeRaw.trim()
        : file.type || 'application/octet-stream';

    if (file.size <= 0) {
      return NextResponse.json({ error: 'File is empty' }, { status: 400 });
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { error: `File is too large. Maximum size is ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB.` },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    await putR2Object({
      key: r2Key,
      body: buffer,
      contentType,
    });

    return NextResponse.json({ success: true, r2Key, sizeBytes: buffer.length });
  } catch (error) {
    console.error('Error uploading import draft attachment to R2:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload attachment.' },
      { status: 500 },
    );
  }
}
