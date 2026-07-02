import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { canAccessJob, jobHasAccessRecords } from '@/lib/jobAccess';
import { deleteR2Object } from '@/lib/r2';
import { normalizeListContextForLookup } from '@/lib/jobListContext';

export const dynamic = 'force-dynamic';

function getSessionUserEmail(session: any): string | null {
  return (session?.user as any)?.email || null;
}

function getSessionUserDisplayName(session: any): string | null {
  return (session?.user as any)?.name || (session?.user as any)?.email || null;
}

async function enforceJobAccess(params: {
  jobNumber: string;
  listNumberContext?: string | null;
  session: any;
}) {
  const { jobNumber, listNumberContext, session } = params;
  const role = (session.user as any).role;
  const userEmail = getSessionUserEmail(session);
  const isUserAdmin = isAdmin(role);

  if (!isUserAdmin) {
    if (!userEmail) {
      return { ok: false as const, response: NextResponse.json({ error: 'Forbidden - Missing user email' }, { status: 403 }) };
    }
    // Scoped to the list being acted on - a job can have access records on
    // one list but not another.
    const hasRecords = await jobHasAccessRecords(jobNumber, listNumberContext);
    if (hasRecords) {
      const hasAccess = await canAccessJob(userEmail, jobNumber, listNumberContext);
      if (!hasAccess) {
        return { ok: false as const, response: NextResponse.json({ error: 'Forbidden - You do not have access to this job' }, { status: 403 }) };
      }
    }
    // No access records means the job is open - allow.
  }

  return { ok: true as const };
}

/**
 * POST /api/jobs/[jobNumber]/notes/[noteId]/attachments
 * Persists attachment metadata after the object is uploaded to R2.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string; noteId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const { jobNumber, noteId } = await params;
    const listNumberContext = request.nextUrl.searchParams.get('listNumber');
    const normalizedListNumber = normalizeListContextForLookup(listNumberContext);
    if (!jobNumber || !noteId) {
      return NextResponse.json({ error: 'jobNumber and noteId are required' }, { status: 400 });
    }

    if (
      !(await hasPermission(session, 'job.notes.add', {
        jobNumber,
        listNumber: listNumberContext,
      }))
    ) {
      return NextResponse.json({ error: 'Forbidden - You do not have permission' }, { status: 403 });
    }

    const role = (session.user as any).role;
    const isUserAdmin = isAdmin(role);

    // Verify note belongs to job and permission (admin OR note author)
    const note = await prisma.jobNote.findUnique({
      where: { id: noteId },
      select: { id: true, jobNumber: true, listNumber: true, createdBy: true, content: true },
    });

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }
    if (
      note.jobNumber !== jobNumber ||
      note.listNumber !== normalizedListNumber
    ) {
      return NextResponse.json({ error: 'Note does not belong to this job' }, { status: 400 });
    }

    const displayName = getSessionUserDisplayName(session);
    // Normalize strings for comparison (trim and handle null/undefined)
    const normalizedCreatedBy = note.createdBy?.trim() || '';
    const normalizedDisplayName = displayName?.trim() || '';
    const canManageNote = isUserAdmin || (normalizedCreatedBy && normalizedDisplayName && normalizedCreatedBy === normalizedDisplayName);

    if (!canManageNote) {
      const access = await enforceJobAccess({ jobNumber, listNumberContext, session });
      if (!access.ok) return access.response;
    }
    
    if (!canManageNote) {
      // Add debug logging in development to help diagnose permission issues
      if (process.env.NODE_ENV === 'development') {
        console.error('Upload permission denied:', {
          isUserAdmin,
          noteCreatedBy: note.createdBy,
          displayName,
          normalizedCreatedBy,
          normalizedDisplayName,
          match: normalizedCreatedBy === normalizedDisplayName,
        });
      }
      return NextResponse.json(
        { error: 'Forbidden - You can only add attachments to notes you created' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const r2Key = body?.r2Key;
    const contentType = body?.contentType;
    const sizeBytes = body?.sizeBytes;
    const width = body?.width;
    const height = body?.height;
    const fileName = typeof body?.fileName === 'string' ? body.fileName.trim() || null : null;

    if (!r2Key || typeof r2Key !== 'string') {
      return NextResponse.json({ error: 'r2Key is required' }, { status: 400 });
    }
    if (!contentType || typeof contentType !== 'string' || contentType.trim().length === 0) {
      return NextResponse.json({ error: 'contentType is required' }, { status: 400 });
    }
    if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      return NextResponse.json({ error: 'sizeBytes must be a positive number' }, { status: 400 });
    }
    if (width !== undefined && (typeof width !== 'number' || !Number.isFinite(width) || width <= 0)) {
      return NextResponse.json({ error: 'width must be a positive number' }, { status: 400 });
    }
    if (height !== undefined && (typeof height !== 'number' || !Number.isFinite(height) || height <= 0)) {
      return NextResponse.json({ error: 'height must be a positive number' }, { status: 400 });
    }

    const createdBy = getSessionUserDisplayName(session);

    const attachment = await prisma.jobNoteAttachment.create({
      data: {
        noteId,
        jobNumber,
        listNumber: normalizedListNumber,
        r2Key,
        contentType,
        sizeBytes: Math.floor(sizeBytes),
        width: width !== undefined ? Math.floor(width) : null,
        height: height !== undefined ? Math.floor(height) : null,
        fileName,
        createdBy,
      },
    });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    console.error('Error in attachments POST:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

/**
 * DELETE /api/jobs/[jobNumber]/notes/[noteId]/attachments?id=XXX
 * Deletes an attachment record and its R2 object.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string; noteId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const { jobNumber, noteId } = await params;
    const listNumberContext = request.nextUrl.searchParams.get('listNumber');
    const normalizedListNumber = normalizeListContextForLookup(listNumberContext);
    const attachmentId = request.nextUrl.searchParams.get('id');

    if (!jobNumber || !noteId) {
      return NextResponse.json({ error: 'jobNumber and noteId are required' }, { status: 400 });
    }
    if (!attachmentId) {
      return NextResponse.json({ error: 'attachment id is required' }, { status: 400 });
    }

    if (
      !(await hasPermission(session, 'job.notes.edit', {
        jobNumber,
        listNumber: listNumberContext,
      }))
    ) {
      return NextResponse.json({ error: 'Forbidden - You do not have permission' }, { status: 403 });
    }

    const role = (session.user as any).role;
    const isUserAdmin = isAdmin(role);

    const access = await enforceJobAccess({ jobNumber, listNumberContext, session });
    if (!access.ok) return access.response;

    const attachment = await prisma.jobNoteAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        note: { select: { id: true, jobNumber: true, listNumber: true, createdBy: true } },
      },
    });

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    if (
      attachment.noteId !== noteId ||
      attachment.note.jobNumber !== jobNumber ||
      attachment.note.listNumber !== normalizedListNumber ||
      attachment.listNumber !== normalizedListNumber
    ) {
      return NextResponse.json({ error: 'Attachment does not belong to this note/job' }, { status: 400 });
    }

    const displayName = getSessionUserDisplayName(session);
    // Normalize strings for comparison (trim and handle null/undefined)
    const normalizedCreatedBy = attachment.note.createdBy?.trim() || '';
    const normalizedDisplayName = displayName?.trim() || '';
    const canManageNote = isUserAdmin || (normalizedCreatedBy && normalizedDisplayName && normalizedCreatedBy === normalizedDisplayName);
    
    if (!canManageNote) {
      // Add debug logging in development to help diagnose permission issues
      if (process.env.NODE_ENV === 'development') {
        console.error('Delete permission denied:', {
          isUserAdmin,
          noteCreatedBy: attachment.note.createdBy,
          displayName,
          normalizedCreatedBy,
          normalizedDisplayName,
          match: normalizedCreatedBy === normalizedDisplayName,
        });
      }
      return NextResponse.json(
        { error: 'Forbidden - You can only delete attachments from notes you created' },
        { status: 403 }
      );
    }

    // Delete object first (best effort), then delete DB record.
    try {
      await deleteR2Object({ key: attachment.r2Key });
    } catch (err) {
      console.error('R2 delete failed (continuing to delete DB record):', err);
    }

    await prisma.jobNoteAttachment.delete({ where: { id: attachmentId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in attachments DELETE:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
