import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { canAccessJob, jobHasAccessRecords } from '@/lib/jobAccess';
import { isR2Configured, putR2Object } from '@/lib/r2';
import { normalizeListContextForLookup } from '@/lib/jobListContext';

export const dynamic = 'force-dynamic';

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

function getSessionUserEmail(session: any): string | null {
  return (session?.user as any)?.email || null;
}

function getSessionUserDisplayName(session: any): string | null {
  return (session?.user as any)?.name || (session?.user as any)?.email || null;
}

function buildExpectedR2KeyPrefix(
  jobNumber: string,
  normalizedListNumber: string,
  noteId: string,
): string {
  return `jobs/${encodeURIComponent(jobNumber)}/lists/${encodeURIComponent(normalizedListNumber)}/notes/${encodeURIComponent(noteId)}/`;
}

/**
 * POST /api/jobs/[jobNumber]/notes/[noteId]/attachments/upload
 * Uploads attachment bytes to R2 through the app server (avoids browser CORS to R2).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string; noteId: string }> },
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
    const userEmail = getSessionUserEmail(session);
    const isUserAdmin = isAdmin(role);

    const note = await prisma.jobNote.findUnique({
      where: { id: noteId },
      select: { id: true, jobNumber: true, listNumber: true, createdBy: true },
    });

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    if (note.jobNumber !== jobNumber || note.listNumber !== normalizedListNumber) {
      return NextResponse.json({ error: 'Note does not belong to this job' }, { status: 400 });
    }

    const displayName = getSessionUserDisplayName(session);
    const normalizedCreatedBy = note.createdBy?.trim() || '';
    const normalizedDisplayName = displayName?.trim() || '';
    const canManageNote =
      isUserAdmin ||
      (normalizedCreatedBy &&
        normalizedDisplayName &&
        normalizedCreatedBy === normalizedDisplayName);

    if (!canManageNote && !isUserAdmin) {
      if (!userEmail) {
        return NextResponse.json({ error: 'Forbidden - Missing user email' }, { status: 403 });
      }
      // Scoped to the list being acted on - a job can have access records
      // on one list but not another.
      const hasRecords = await jobHasAccessRecords(jobNumber, listNumberContext);
      if (hasRecords) {
        const hasAccess = await canAccessJob(userEmail, jobNumber, listNumberContext);
        if (!hasAccess) {
          return NextResponse.json(
            { error: 'Forbidden - You can only add attachments to notes you created' },
            { status: 403 },
          );
        }
      }
      // No access records means the job is open - fall through and allow.
    }

    if (!canManageNote) {
      return NextResponse.json(
        { error: 'Forbidden - You can only add attachments to notes you created' },
        { status: 403 },
      );
    }

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
    const expectedPrefix = buildExpectedR2KeyPrefix(
      jobNumber,
      normalizedListNumber,
      noteId,
    );
    if (!r2Key.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: 'Invalid r2Key for this note' }, { status: 400 });
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
    console.error('Error uploading note attachment to R2:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
