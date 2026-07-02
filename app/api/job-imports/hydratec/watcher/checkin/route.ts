import { NextRequest, NextResponse } from 'next/server';
import { verifyWatcherKey, touchWatcherKeyLastSeen } from '@/lib/hydraTecWatcherAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const watcherKey = await verifyWatcherKey(request.headers.get('authorization'));
  if (!watcherKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await touchWatcherKeyLastSeen(watcherKey.id);
  return NextResponse.json({ ok: true });
}
