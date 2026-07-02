/** Canonical production dashboard host for links in outbound emails. */
export const DEFAULT_PUBLIC_APP_URL = 'https://tfp.tools';

const LEGACY_PUBLIC_APP_HOSTS = new Set([
  'https://totalfireprotection.vercel.app',
  'https://totalfireprotection-xrjt.vercel.app',
  'http://totalfireprotection.vercel.app',
  'http://totalfireprotection-xrjt.vercel.app',
  'https://northops-fire-protection-dashboard.vercel.app',
  'http://northops-fire-protection-dashboard.vercel.app',
]);

function stripTrailingSlash(url: string): string {
  return url.trim().replace(/\/$/, '');
}

function normalizePublicAppHost(url: string): string {
  const trimmed = stripTrailingSlash(url);
  if (LEGACY_PUBLIC_APP_HOSTS.has(trimmed)) {
    return DEFAULT_PUBLIC_APP_URL;
  }
  return trimmed;
}

/**
 * Base URL for dashboard links in outbound emails (job created, access granted, notes, etc.).
 * Prefer PUBLIC_APP_URL; fall back to NEXTAUTH_URL; rewrite legacy Vercel hosts to tfp.tools.
 */
export function getPublicAppBaseUrl(): string {
  const fromPublicApp = process.env.PUBLIC_APP_URL?.trim();
  if (fromPublicApp) {
    return normalizePublicAppHost(fromPublicApp);
  }

  const fromNextAuth = process.env.NEXTAUTH_URL?.trim();
  if (fromNextAuth) {
    return normalizePublicAppHost(fromNextAuth);
  }

  return DEFAULT_PUBLIC_APP_URL;
}
