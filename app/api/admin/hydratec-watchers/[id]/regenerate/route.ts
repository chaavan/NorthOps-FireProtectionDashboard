import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateWatcherKey } from '@/lib/hydraTecWatcherAuth';
import { requireHydraTecWatcherRegenerateAccess } from '@/lib/jobImportPermissions';
import {
  buildHydraTecWatcherScript,
  buildHydraTecWatcherLauncherBat,
  buildWatcherScriptFileName,
  normalizeApiBaseUrlForWatcherScript,
} from '@/lib/hydraTecWatcherScript';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
  }
  const { id } = await params;
  const permission = await requireHydraTecWatcherRegenerateAccess(session, id);
  if (!permission.ok) return permission.response;

  const existing = await (prisma as any).hydraTecWatcherKey.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Watcher not found.' }, { status: 404 });
  }

  const { secret, keyHash, keyPrefix } = await generateWatcherKey();
  const watcher = await (prisma as any).hydraTecWatcherKey.update({
    where: { id },
    data: { keyHash, keyPrefix, revokedAt: null, lastSeenAt: null },
  });

  const scriptContent = buildHydraTecWatcherScript({
    apiBaseUrl: normalizeApiBaseUrlForWatcherScript(request.nextUrl.origin),
    secret,
    watcherName: watcher.name,
  });
  const scriptFileName = buildWatcherScriptFileName(watcher.name);
  const launcherBatContent = buildHydraTecWatcherLauncherBat({ ps1FileName: scriptFileName });

  return NextResponse.json({
    watcher: {
      id: watcher.id,
      name: watcher.name,
      keyPrefix: watcher.keyPrefix,
      createdAt: watcher.createdAt,
    },
    secret,
    scriptContent,
    scriptFileName,
    launcherBatContent,
  });
}
