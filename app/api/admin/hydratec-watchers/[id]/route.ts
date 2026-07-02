import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireHydraTecWatcherPermission } from '@/lib/jobImportPermissions';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
  }
  const permission = await requireHydraTecWatcherPermission(session, 'job_import.hydratec_watchers.revoke');
  if (!permission.ok) return permission.response;

  const { id } = await params;
  const watcher = await (prisma as any).hydraTecWatcherKey.findUnique({ where: { id } });
  if (!watcher) {
    return NextResponse.json({ error: 'Watcher not found.' }, { status: 404 });
  }

  await (prisma as any).hydraTecWatcherKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });

  return NextResponse.json({ success: true });
}
