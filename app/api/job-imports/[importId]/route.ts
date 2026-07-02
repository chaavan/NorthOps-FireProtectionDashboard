import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { discardJobImportDraft, saveJobImportReview } from '@/lib/jobImportService';
import {
  requireJobImportEditAccess,
  requireJobImportViewAccess,
} from '@/lib/jobImportPermissions';

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
    return NextResponse.json({ import: access.draft });
  } catch (error) {
    console.error('Error loading job import:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load job import.' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ importId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const body = await request.json();
    if (!body?.reviewSnapshot) {
      return NextResponse.json({ error: 'reviewSnapshot is required.' }, { status: 400 });
    }

    const { importId } = await params;
    const access = await requireJobImportEditAccess(session, importId);
    if (!access.ok) return access.response;

    const saved = await saveJobImportReview(importId, {
      reviewSnapshot: body.reviewSnapshot,
      draftState: body.draftState ?? undefined,
    });

    return NextResponse.json({ import: saved });
  } catch (error) {
    console.error('Error saving job import review:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save job import review.' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
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
    const jobImport = access.draft;
    if (jobImport.status === 'COMMITTED') {
      return NextResponse.json({ error: 'Committed imports cannot be discarded.' }, { status: 409 });
    }
    if (jobImport.mode !== 'new_job_import') {
      return NextResponse.json(
        { error: 'Only new job import drafts can be discarded here.' },
        { status: 400 },
      );
    }

    const discarded = await discardJobImportDraft(importId);
    return NextResponse.json({ success: true, import: discarded });
  } catch (error) {
    console.error('Error discarding job import draft:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to discard job import draft.' },
      { status: 500 },
    );
  }
}
