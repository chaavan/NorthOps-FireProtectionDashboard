import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { commitJobImport } from '@/lib/jobImportService';
import { toPublicErrorMessage } from '@/lib/apiErrorMessage';
import { isInitialJobAccessGrantsError } from '@/lib/initialJobAccessGrants';
import { requireJobImportCommitAccess } from '@/lib/jobImportPermissions';

export const dynamic = 'force-dynamic';

export async function POST(
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
    const access = await requireJobImportCommitAccess(session, importId);
    if (!access.ok) return access.response;

    const role = (session.user as any).role as string | undefined;
    const result = await commitJobImport(
      importId,
      {
        reviewSnapshot: body.reviewSnapshot,
        accessGrants: body.accessGrants,
        initialNote: body.initialNote,
      },
      {
        email: String((session.user as any).email || '').trim().toLowerCase(),
        name: (session.user as any).name || null,
        role: role ?? null,
      },
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error committing job import:', error);
    if (isInitialJobAccessGrantsError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = toPublicErrorMessage(
      error,
      'Failed to commit job import. Review flagged rows and try again.',
    );
    const status =
      message.includes('too large to save') ||
      message.includes('Required fields') ||
      message.includes('blocking import errors') ||
      message.includes('required before commit')
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
