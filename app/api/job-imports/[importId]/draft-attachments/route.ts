import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  requireJobImportEditAccess,
  requireJobImportViewAccess,
} from '@/lib/jobImportPermissions';
import { createPresignedGetUrl, deleteR2Object } from '@/lib/r2';

export const dynamic = 'force-dynamic';

const prismaAny = prisma as any;

async function ensureImportAccess(importId: string, mode: 'view' | 'edit') {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 }),
    };
  }
  const access =
    mode === 'edit'
      ? await requireJobImportEditAccess(session, importId)
      : await requireJobImportViewAccess(session, importId);
  if (!access.ok) return access;
  return { ok: true as const, session };
}

function serializeAttachment(attachment: any, url?: string | null) {
  return {
    id: attachment.id,
    fileName: attachment.fileName ?? null,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    width: attachment.width ?? null,
    height: attachment.height ?? null,
    uploadedByEmail: attachment.uploadedByEmail ?? null,
    createdAt: attachment.createdAt.toISOString(),
    url: url ?? null,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ importId: string }> },
) {
  try {
    const { importId } = await params;
    const access = await ensureImportAccess(importId, 'view');
    if (!access.ok) return access.response;

    const attachments = await prismaAny.jobImportDraftAttachment.findMany({
      where: { jobImportId: importId },
      orderBy: { createdAt: 'asc' },
    });
    const withUrls = await Promise.all(
      attachments.map(async (attachment: any) => {
        const url = await createPresignedGetUrl({ key: attachment.r2Key }).catch((error) => {
          console.error('Failed to sign draft attachment URL:', error);
          return null;
        });
        return serializeAttachment(attachment, url);
      }),
    );

    return NextResponse.json({ attachments: withUrls });
  } catch (error) {
    console.error('Error listing import draft attachments:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list attachments.' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ importId: string }> },
) {
  try {
    const { importId } = await params;
    const access = await ensureImportAccess(importId, 'edit');
    if (!access.ok) return access.response;

    const body = await request.json();
    const r2Key = typeof body?.r2Key === 'string' ? body.r2Key.trim() : '';
    const contentType = typeof body?.contentType === 'string' ? body.contentType.trim() : '';
    const sizeBytes = body?.sizeBytes;
    const width = body?.width;
    const height = body?.height;
    const fileName = typeof body?.fileName === 'string' ? body.fileName.trim() || null : null;

    if (!r2Key || !r2Key.startsWith(`job-imports/${encodeURIComponent(importId)}/draft-attachments/`)) {
      return NextResponse.json({ error: 'r2Key is invalid for this import.' }, { status: 400 });
    }
    if (!contentType) {
      return NextResponse.json({ error: 'contentType is required' }, { status: 400 });
    }
    if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      return NextResponse.json({ error: 'sizeBytes must be a positive number' }, { status: 400 });
    }
    if (width !== undefined && width !== null && (typeof width !== 'number' || !Number.isFinite(width) || width <= 0)) {
      return NextResponse.json({ error: 'width must be a positive number' }, { status: 400 });
    }
    if (height !== undefined && height !== null && (typeof height !== 'number' || !Number.isFinite(height) || height <= 0)) {
      return NextResponse.json({ error: 'height must be a positive number' }, { status: 400 });
    }

    const uploadedByEmail = String((access.session.user as any).email || '').trim().toLowerCase() || null;
    const attachment = await prismaAny.jobImportDraftAttachment.create({
      data: {
        jobImportId: importId,
        r2Key,
        contentType,
        sizeBytes: Math.floor(sizeBytes),
        width: width ? Math.floor(width) : null,
        height: height ? Math.floor(height) : null,
        fileName,
        uploadedByEmail,
      },
    });
    const url = await createPresignedGetUrl({ key: attachment.r2Key }).catch(() => null);

    return NextResponse.json({ attachment: serializeAttachment(attachment, url) }, { status: 201 });
  } catch (error) {
    console.error('Error saving import draft attachment:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save attachment.' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ importId: string }> },
) {
  try {
    const { importId } = await params;
    const access = await ensureImportAccess(importId, 'edit');
    if (!access.ok) return access.response;

    const attachmentId = request.nextUrl.searchParams.get('id');
    if (!attachmentId) {
      return NextResponse.json({ error: 'attachment id is required' }, { status: 400 });
    }

    const attachment = await prismaAny.jobImportDraftAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment || attachment.jobImportId !== importId) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    try {
      await deleteR2Object({ key: attachment.r2Key });
    } catch (error) {
      console.error('R2 delete failed for draft attachment (continuing):', error);
    }

    await prismaAny.jobImportDraftAttachment.delete({ where: { id: attachmentId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting import draft attachment:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete attachment.' },
      { status: 500 },
    );
  }
}
