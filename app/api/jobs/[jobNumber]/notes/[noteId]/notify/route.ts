import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { canAccessJob, jobHasAccessRecords } from '@/lib/jobAccess';
import { normalizeListContextForLookup } from '@/lib/jobListContext';
import { sendNoteAddedNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';

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
  const userRole = (session.user as any).role;
  const userEmail = getSessionUserEmail(session);

  if (isAdmin(userRole)) {
    return { ok: true as const };
  }

  if (!userEmail) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Forbidden - Missing user email' }, { status: 403 }),
    };
  }

  // Scoped to the list being acted on - a job can have access records on
  // one list but not another.
  const hasRecords = await jobHasAccessRecords(jobNumber, listNumberContext);
  if (hasRecords) {
    const hasAccess = await canAccessJob(userEmail, jobNumber, listNumberContext);
    if (!hasAccess) {
      return {
        ok: false as const,
        response: NextResponse.json({ error: 'Forbidden - You do not have access to this job' }, { status: 403 }),
      };
    }
  }
  // No access records means the job is open - allow.

  return { ok: true as const };
}

/**
 * POST /api/jobs/[jobNumber]/notes/[noteId]/notify
 * Sends the normal note-added notification for an existing note.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobNumber: string; noteId: string }> },
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

    const access = await enforceJobAccess({ jobNumber, listNumberContext, session });
    if (!access.ok) return access.response;

    const note = await prisma.jobNote.findUnique({
      where: { id: noteId },
      select: {
        id: true,
        jobNumber: true,
        listNumber: true,
        content: true,
        createdBy: true,
        parentId: true,
      },
    });

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    if (note.jobNumber !== jobNumber || note.listNumber !== normalizedListNumber) {
      return NextResponse.json({ error: 'Note does not belong to this job' }, { status: 400 });
    }

    const normalizedCreatedBy = note.createdBy?.trim() || '';
    const normalizedDisplayName = getSessionUserDisplayName(session)?.trim() || '';
    const role = (session.user as any).role;
    const canNotify =
      isAdmin(role) ||
      (normalizedCreatedBy && normalizedDisplayName && normalizedCreatedBy === normalizedDisplayName);

    if (!canNotify) {
      return NextResponse.json(
        { error: 'Forbidden - You can only notify notes you created' },
        { status: 403 },
      );
    }

    try {
      await sendNoteAddedNotification(
        jobNumber,
        normalizedListNumber,
        note.id,
        note.content,
        note.createdBy,
        getSessionUserEmail(session),
        !!note.parentId,
      );
    } catch (notifErr) {
      console.error('[note_added_notification] unhandled manual notify:', notifErr);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in note notify route:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
