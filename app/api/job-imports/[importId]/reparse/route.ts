import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { reparseJobImport } from '@/lib/jobImportService';
import { requireJobImportEditAccess } from '@/lib/jobImportPermissions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(
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

    const reparsed = await reparseJobImport(importId);
    return NextResponse.json({ import: reparsed });
  } catch (error) {
    console.error('Error reparsing job import:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reparse job import.' },
      { status: 500 },
    );
  }
}
