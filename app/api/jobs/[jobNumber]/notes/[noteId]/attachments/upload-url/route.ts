import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasPermission, getEffectivePermissionsForSession } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { bypassesJobAccessList, enforceJobAccess } from '@/lib/jobScopedAccess';
import { isR2Configured } from '@/lib/r2';
import { normalizeListContextForLookup } from '@/lib/jobListContext';

export const dynamic = 'force-dynamic';

function getSessionUserEmail(session: any): string | null {
  return (session?.user as any)?.email || null;
}

function getSessionUserDisplayName(session: any): string | null {
  return (session?.user as any)?.name || (session?.user as any)?.email || null;
}

/**
 * POST /api/jobs/[jobNumber]/notes/[noteId]/attachments/upload-url
 * Returns a presigned PUT URL to upload an attachment to R2.
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
    const permissionDetails = await getEffectivePermissionsForSession(session);
    const canManageAsPrivileged = bypassesJobAccessList(role, permissionDetails);

    if (!isR2Configured()) {
      return NextResponse.json(
        { error: 'File storage (R2) is not configured. Please contact support.' },
        { status: 503 },
      );
    }

    const body = await request.json();
    const contentType = body?.contentType;

    if (!contentType || typeof contentType !== 'string') {
      return NextResponse.json({ error: 'contentType is required' }, { status: 400 });
    }

    // Verify note exists and belongs to this job
    const note = await prisma.jobNote.findUnique({
      where: { id: noteId },
      select: { id: true, jobNumber: true, listNumber: true, createdBy: true },
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

    // Note-level permission: admin OR note author
    const displayName = getSessionUserDisplayName(session);
    // Normalize strings for comparison (trim and handle null/undefined)
    const normalizedCreatedBy = note.createdBy?.trim() || '';
    const normalizedDisplayName = displayName?.trim() || '';
    const canManageNote = canManageAsPrivileged || (normalizedCreatedBy && normalizedDisplayName && normalizedCreatedBy === normalizedDisplayName);

    if (!canManageNote) {
      const access = await enforceJobAccess({ jobNumber, listNumberContext, session });
      if (!access.ok) return access.response;
    }
    
    if (!canManageNote) {
      // Add debug logging in development to help diagnose permission issues
      if (process.env.NODE_ENV === 'development') {
        console.error('Upload permission denied:', {
          canManageAsPrivileged,
          noteCreatedBy: note.createdBy,
          displayName,
          normalizedCreatedBy,
          normalizedDisplayName,
          match: normalizedCreatedBy === normalizedDisplayName,
        });
      }
      return NextResponse.json({ error: 'Forbidden - You can only add attachments to notes you created' }, { status: 403 });
    }

    // Use a deterministic folder structure and a random filename.
    const uuid = crypto.randomUUID();
    const mimeSuffix = contentType.includes('/') ? contentType.split('/')[1] : '';
    const normalizedMimeExt = mimeSuffix.split(';')[0].toLowerCase().replace(/[^a-z0-9]+/g, '');
    const ext =
      contentType === 'application/pdf'
        ? 'pdf'
        : contentType === 'image/webp'
          ? 'webp'
          : contentType === 'image/png'
            ? 'png'
            : contentType === 'image/jpeg'
              ? 'jpg'
              : normalizedMimeExt || 'bin';

    const r2Key = `jobs/${encodeURIComponent(jobNumber)}/lists/${encodeURIComponent(normalizedListNumber)}/notes/${encodeURIComponent(noteId)}/${uuid}.${ext}`;

    return NextResponse.json({ r2Key });
  } catch (error) {
    console.error('Error in upload-url route:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
