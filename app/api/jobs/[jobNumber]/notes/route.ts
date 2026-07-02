import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasPermission, getEffectivePermissionsForSession } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { enforceJobAccess, bypassesJobAccessList } from '@/lib/jobScopedAccess';
import { createPresignedGetUrl, deleteR2Object } from '@/lib/r2';
import { normalizeListContextForLookup } from '@/lib/jobListContext';
import { sendNoteAddedNotification } from '@/lib/notifications';

// Force this route to be dynamic
export const dynamic = 'force-dynamic';

function getSessionUserEmail(session: any): string | null {
  return (session?.user as any)?.email || null;
}

function getSessionUserDisplayName(session: any): string | null {
  return (session?.user as any)?.name || (session?.user as any)?.email || null;
}

/**
 * GET /api/jobs/[jobNumber]/notes
 * Returns all notes for a specific job
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const { jobNumber } = await params;
    const listNumberContext = request.nextUrl.searchParams.get('listNumber');
    const normalizedListNumber = normalizeListContextForLookup(listNumberContext);

    if (!jobNumber) {
      return NextResponse.json(
        { error: 'jobNumber is required' },
        { status: 400 }
      );
    }

    if (
      !(await hasPermission(session, 'job.notes.view', {
        jobNumber,
        listNumber: listNumberContext,
      }))
    ) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to view notes' },
        { status: 403 }
      );
    }

    const access = await enforceJobAccess({
      jobNumber,
      listNumberContext,
      session,
    });
    if (!access.ok) return access.response;

    const notes = await prisma.jobNote.findMany({
      where: {
        jobNumber,
        listNumber: normalizedListNumber,
      },
      orderBy: { createdAt: 'desc' },
    });

    type RawAttachmentRow = {
      id: string;
      note_id: string;
      job_number: string;
      list_number: string;
      r2_key: string;
      content_type: string;
      size_bytes: number;
      width: number | null;
      height: number | null;
      file_name: string | null;
      created_by: string | null;
      created_at: Date;
    };

    // NOTE: We intentionally use $queryRaw here to avoid type-checker cache issues
    // with newly generated Prisma delegates in some editors/tooling.
    const rawAttachments = await prisma.$queryRaw<RawAttachmentRow[]>`
      SELECT
        id,
        note_id,
        job_number,
        list_number,
        r2_key,
        content_type,
        size_bytes,
        width,
        height,
        file_name,
        created_by,
        created_at
      FROM job_note_attachments
      WHERE job_number = ${jobNumber}
        AND list_number = ${normalizedListNumber}
      ORDER BY created_at ASC
    `;

    const attachments = rawAttachments.map((a) => ({
      id: a.id,
      noteId: a.note_id,
      jobNumber: a.job_number,
      listNumber: a.list_number,
      r2Key: a.r2_key,
      contentType: a.content_type,
      sizeBytes: a.size_bytes,
      width: a.width,
      height: a.height,
      fileName: a.file_name,
      createdBy: a.created_by,
      createdAt: a.created_at,
    }));

    const attachmentsByNoteId = new Map<string, typeof attachments>();
    for (const a of attachments) {
      const arr = attachmentsByNoteId.get(a.noteId) || [];
      arr.push(a);
      attachmentsByNoteId.set(a.noteId, arr);
    }

    const notesWithSignedUrls = await Promise.all(
      notes.map(async (note) => {
        const noteAttachments = attachmentsByNoteId.get(note.id) || [];
        const attachmentsWithUrls = await Promise.all(
          noteAttachments.map(async (a) => ({
            ...a,
            url: await createPresignedGetUrl({ key: a.r2Key }),
          }))
        );
        return { ...note, attachments: attachmentsWithUrls };
      })
    );

    return NextResponse.json({ notes: notesWithSignedUrls });
  } catch (error) {
    console.error('Error in /api/jobs/[jobNumber]/notes GET:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/jobs/[jobNumber]/notes
 * Creates a new note for a job
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const { jobNumber } = await params;
    const listNumberContext = request.nextUrl.searchParams.get('listNumber');
    const normalizedListNumber = normalizeListContextForLookup(listNumberContext);

    if (!jobNumber) {
      return NextResponse.json(
        { error: 'jobNumber is required' },
        { status: 400 }
      );
    }

    if (
      !(await hasPermission(session, 'job.notes.add', {
        jobNumber,
        listNumber: listNumberContext,
      }))
    ) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to create notes' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { content, parentId: requestedParentId } = body;
    const shouldNotify = body?.notify !== false;

    if (!jobNumber) {
      return NextResponse.json(
        { error: 'jobNumber is required' },
        { status: 400 }
      );
    }

    if (content !== undefined && typeof content !== 'string') {
      return NextResponse.json(
        { error: 'content must be a string when provided' },
        { status: 400 }
      );
    }

    const normalizedContent = typeof content === 'string' ? content.trim() : '';
    const isReplyRequest =
      requestedParentId != null &&
      typeof requestedParentId === 'string' &&
      requestedParentId.trim() !== '';

    // Replies still require message text; top-level notes may be attachment-only.
    if (isReplyRequest && normalizedContent.length === 0) {
      return NextResponse.json(
        { error: 'content is required and must not be empty for replies' },
        { status: 400 }
      );
    }

    const createdBy = getSessionUserDisplayName(session);

    const access = await enforceJobAccess({
      jobNumber,
      listNumberContext,
      session,
    });
    if (!access.ok) return access.response;

    // If replying, resolve thread root and validate parent note belongs to this job
    let parentId: string | null = null;
    if (requestedParentId != null && typeof requestedParentId === 'string' && requestedParentId.trim() !== '') {
      const parentNote = await prisma.jobNote.findUnique({
        where: { id: requestedParentId.trim() },
        select: { id: true, jobNumber: true, listNumber: true, parentId: true },
      });
      if (
        !parentNote ||
        parentNote.jobNumber !== jobNumber ||
        parentNote.listNumber !== normalizedListNumber
      ) {
        return NextResponse.json(
          { error: 'Parent note not found or does not belong to this job' },
          { status: 400 }
        );
      }
      // All replies in a thread share the same root (root note id)
      parentId = parentNote.parentId ?? parentNote.id;
    }

    // Create the note (top-level or reply).
    const note = await prisma.jobNote.create({
      data: {
        jobNumber,
        listNumber: normalizedListNumber,
        content: normalizedContent,
        createdBy,
        ...(parentId ? { parentId } : {}),
      },
    });

    if (shouldNotify) {
      try {
        await sendNoteAddedNotification(
          jobNumber,
          normalizedListNumber,
          note.id,
          normalizedContent,
          createdBy,
          getSessionUserEmail(session),
          !!parentId,
        );
      } catch (notifErr) {
        console.error('[note_added_notification] unhandled:', notifErr);
      }
    }

    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    console.error('Error in /api/jobs/[jobNumber]/notes POST:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/jobs/[jobNumber]/notes?id=XXX
 * Updates an existing note for a job
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const { jobNumber } = await params;
    const searchParams = request.nextUrl.searchParams;
    const listNumberContext = searchParams.get('listNumber');
    const normalizedListNumber = normalizeListContextForLookup(listNumberContext);
    const noteId = searchParams.get('id');
    const body = await request.json();
    const { content } = body;

    if (!jobNumber || !noteId) {
      return NextResponse.json(
        { error: 'jobNumber and note id are required' },
        { status: 400 }
      );
    }

    if (
      !(await hasPermission(session, 'job.notes.edit', {
        jobNumber,
        listNumber: listNumberContext,
      }))
    ) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to update notes' },
        { status: 403 }
      );
    }

    const access = await enforceJobAccess({
      jobNumber,
      listNumberContext,
      session,
    });
    if (!access.ok) return access.response;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json(
        { error: 'content is required and must not be empty' },
        { status: 400 }
      );
    }

    // Get the existing note
    const existingNote = await prisma.jobNote.findUnique({
      where: { id: noteId },
    });

    if (!existingNote) {
      return NextResponse.json(
        { error: 'Note not found' },
        { status: 404 }
      );
    }

    if (
      existingNote.jobNumber !== jobNumber ||
      existingNote.listNumber !== normalizedListNumber
    ) {
      return NextResponse.json(
        { error: 'Note does not belong to this job' },
        { status: 400 }
      );
    }

    const userRole = (session.user as any).role;
    const permissionDetails = await getEffectivePermissionsForSession(session);
    const canEditAsPrivileged = bypassesJobAccessList(userRole, permissionDetails);

    // Check permissions: User can edit if they're admin, or if they created the note
    const canEdit = canEditAsPrivileged || existingNote.createdBy === getSessionUserDisplayName(session);

    if (!canEdit) {
      return NextResponse.json(
        { error: 'Forbidden - You can only edit notes you created' },
        { status: 403 }
      );
    }

    // Update the note
    const updatedNote = await prisma.jobNote.update({
      where: { id: noteId },
      data: {
        content: content.trim(),
      },
    });

    return NextResponse.json({ note: updatedNote });
  } catch (error) {
    console.error('Error in /api/jobs/[jobNumber]/notes PUT:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/jobs/[jobNumber]/notes?id=XXX
 * Deletes a note for a job
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const { jobNumber } = await params;
    const searchParams = request.nextUrl.searchParams;
    const listNumberContext = searchParams.get('listNumber');
    const normalizedListNumber = normalizeListContextForLookup(listNumberContext);
    const noteId = searchParams.get('id');

    if (!jobNumber || !noteId) {
      return NextResponse.json(
        { error: 'jobNumber and note id are required' },
        { status: 400 }
      );
    }

    if (
      !(await hasPermission(session, 'job.notes.delete', {
        jobNumber,
        listNumber: listNumberContext,
      }))
    ) {
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to delete notes' },
        { status: 403 }
      );
    }

    const access = await enforceJobAccess({
      jobNumber,
      listNumberContext,
      session,
    });
    if (!access.ok) return access.response;

    // Get the existing note
    const existingNote = await prisma.jobNote.findUnique({
      where: { id: noteId },
    });

    if (!existingNote) {
      return NextResponse.json(
        { error: 'Note not found' },
        { status: 404 }
      );
    }

    if (
      existingNote.jobNumber !== jobNumber ||
      existingNote.listNumber !== normalizedListNumber
    ) {
      return NextResponse.json(
        { error: 'Note does not belong to this job' },
        { status: 400 }
      );
    }

    const userRole = (session.user as any).role;
    const permissionDetails = await getEffectivePermissionsForSession(session);
    const canDeleteAsPrivileged = bypassesJobAccessList(userRole, permissionDetails);

    // Check permissions: User can delete if they're admin, or if they created the note
    const canDelete = canDeleteAsPrivileged || existingNote.createdBy === getSessionUserDisplayName(session);

    if (!canDelete) {
      return NextResponse.json(
        { error: 'Forbidden - You can only delete notes you created' },
        { status: 403 }
      );
    }

    // Best-effort cleanup: delete any R2 objects for this note.
    // (DB rows will be removed via FK cascade, but objects would otherwise remain.)
    try {
      const rows = await prisma.$queryRaw<Array<{ r2_key: string }>>`
        SELECT r2_key
        FROM job_note_attachments
        WHERE note_id = ${noteId}
      `;

      for (const row of rows) {
        try {
          await deleteR2Object({ key: row.r2_key });
        } catch (err) {
          console.error('Failed to delete R2 object (non-blocking):', err);
        }
      }
    } catch (err) {
      console.error('Failed to list attachments for note deletion (non-blocking):', err);
    }

    // Delete the note
    await prisma.jobNote.delete({
      where: { id: noteId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in /api/jobs/[jobNumber]/notes DELETE:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
