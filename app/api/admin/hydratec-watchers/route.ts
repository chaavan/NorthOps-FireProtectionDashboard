import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateWatcherKey } from '@/lib/hydraTecWatcherAuth';
import {
  getHydraTecWatcherListScope,
  getSessionEmail,
  requireHydraTecWatcherPermission,
} from '@/lib/jobImportPermissions';
import {
  buildHydraTecWatcherScript,
  buildHydraTecWatcherLauncherBat,
  buildWatcherScriptFileName,
  normalizeApiBaseUrlForWatcherScript,
} from '@/lib/hydraTecWatcherScript';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
  }
  const scope = await getHydraTecWatcherListScope(session);
  if (!scope.ok) return scope.response!;

  const includeRevoked = request.nextUrl.searchParams.get('includeRevoked') === 'true';
  const where = {
    ...(includeRevoked ? {} : { revokedAt: null }),
    ...(scope.createdBy ? { createdBy: scope.createdBy } : {}),
  };

  const watchers = await (prisma as any).hydraTecWatcherKey.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      createdBy: true,
      createdAt: true,
      lastSeenAt: true,
      revokedAt: true,
    },
  });

  return NextResponse.json({ watchers });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
  }
  const permission = await requireHydraTecWatcherPermission(session, 'job_import.hydratec_watchers.add');
  if (!permission.ok) return permission.response;

  const body = await request.json().catch(() => ({}));
  const name = String(body?.name || '').trim();
  if (!name) {
    return NextResponse.json({ error: 'A name is required (e.g. the PC or location it runs on).' }, { status: 400 });
  }

  const { secret, keyHash, keyPrefix } = await generateWatcherKey();
  const createdBy = getSessionEmail(session);

  const watcher = await (prisma as any).hydraTecWatcherKey.create({
    data: { name, keyHash, keyPrefix, createdBy },
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
