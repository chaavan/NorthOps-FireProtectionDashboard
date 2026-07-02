import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getEffectivePermissionsForSession } from '@/lib/permissions';
import { bypassesJobAccessList } from '@/lib/jobScopedAccess';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health/notifications
 * Verifies JOB_NOTIFICATION_WEBHOOK_URL (job-created n8n flow) and access-added webhook config.
 * Admin-only.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;
  const permissionDetails = await getEffectivePermissionsForSession(session);
  if (!session?.user || !bypassesJobAccessList(role, permissionDetails)) {
    return NextResponse.json(
      { error: 'Unauthorized - Admin only' },
      { status: 401 }
    );
  }

  const webhookUrl = process.env.JOB_NOTIFICATION_WEBHOOK_URL;
  const webhookConfigured = Boolean(
    webhookUrl && typeof webhookUrl === 'string' && webhookUrl.trim().length > 0
  );
  let webhookHost: string | null = null;
  if (webhookConfigured && webhookUrl) {
    try {
      webhookHost = new URL(webhookUrl).hostname;
    } catch {
      webhookHost = null;
    }
  }

  const accessAddedUrl = process.env.JOB_ACCESS_ADDED_WEBHOOK_URL;
  const accessAddedConfigured = Boolean(
    accessAddedUrl && typeof accessAddedUrl === 'string' && accessAddedUrl.trim().length > 0
  );

  let webhookReachable: boolean | null = null;
  let webhookLatencyMs: number | null = null;
  if (webhookConfigured && webhookUrl) {
    const start = Date.now();
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'health_check', timestamp: new Date().toISOString() }),
        signal: AbortSignal.timeout(8000),
      });
      webhookLatencyMs = Date.now() - start;
      webhookReachable = res.status < 500;
    } catch {
      webhookLatencyMs = Date.now() - start;
      webhookReachable = false;
    }
  }

  const ok = webhookConfigured && webhookReachable !== false;

  return NextResponse.json({
    ok,
    webhookConfigured,
    webhookHost: webhookHost ?? undefined,
    webhookReachable,
    webhookLatencyMs,
    accessAddedWebhookConfigured: accessAddedConfigured,
    message: !webhookConfigured
      ? 'JOB_NOTIFICATION_WEBHOOK_URL is not set (used for job-created emails).'
      : webhookReachable === false
        ? `Job-created webhook at ${webhookHost} is unreachable (${webhookLatencyMs}ms).`
        : `Job-created webhook at ${webhookHost} is reachable (${webhookLatencyMs}ms).`,
  });
}
