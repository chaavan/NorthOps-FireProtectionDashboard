import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createJobImportDraft, getJobImport, listJobImportSummaries, parseJobImport } from '@/lib/jobImportService';
import { scheduleJobImportParse } from '@/lib/jobImportParseScheduler';
import type { JobImportListStatus } from '@/lib/jobImportTypes';
import {
  getJobImportDraftListScope,
  getSessionEmail,
  requireJobImportUploadAccess,
} from '@/lib/jobImportPermissions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** Large PDFs (Document AI + OpenAI) can exceed default serverless limits; align with your host (e.g. Vercel Pro max 300s). */
export const maxDuration = 300;

const ACTIVE_DRAFT_STATUSES: JobImportListStatus[] = ['PROCESSING', 'READY', 'FAILED'];

function parseDraftStatuses(value: string | null): JobImportListStatus[] {
  if (!value || value === 'all') return ACTIVE_DRAFT_STATUSES;
  const requested = value
    .split(',')
    .map((status) => status.trim().toUpperCase())
    .filter((status): status is JobImportListStatus =>
      ACTIVE_DRAFT_STATUSES.includes(status as JobImportListStatus),
    );
  return requested.length > 0 ? requested : ACTIVE_DRAFT_STATUSES;
}

function parseTake(value: string | null): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return 12;
  return Math.min(Math.max(parsed, 1), 50);
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const scope = await getJobImportDraftListScope(session);
    if (!scope.ok) return scope.response!;

    const page = await listJobImportSummaries({
      mode: 'new_job_import',
      statuses: parseDraftStatuses(request.nextUrl.searchParams.get('status')),
      createdBy: scope.createdBy,
      take: parseTake(request.nextUrl.searchParams.get('take')),
      cursor: request.nextUrl.searchParams.get('cursor'),
    });

    return NextResponse.json(page);
  } catch (error) {
    console.error('Error listing job import drafts:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list job import drafts.' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const permission = await requireJobImportUploadAccess(session);
    if (!permission.ok) return permission.response;

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'A PDF file is required.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const draft = await createJobImportDraft({
      fileName: file.name,
      contentType: file.type || 'application/pdf',
      fileBytes: buffer,
      createdBy: getSessionEmail(session),
    });

    if (process.env.VERCEL) {
      scheduleJobImportParse(draft.id);
    } else {
      await parseJobImport(draft.id);
    }

    const response = await getJobImport(draft.id);

    return NextResponse.json({
      success: response.status === 'READY',
      import: response,
    });
  } catch (error) {
    console.error('Error creating job import:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create job import.' },
      { status: 500 },
    );
  }
}
