/** Fallback dashboard host for links in outbound emails when nothing is configured. */
export const DEFAULT_PUBLIC_APP_URL = 'http://localhost:3000';

function stripTrailingSlash(url: string): string {
  return url.trim().replace(/\/$/, '');
}

/**
 * Base URL for dashboard links in outbound emails (job created, access granted, notes, etc.).
 * Prefer PUBLIC_APP_URL; fall back to NEXTAUTH_URL; then to localhost.
 *
 * Set PUBLIC_APP_URL per deployment — it must match the domain users actually open,
 * or emailed links land on the wrong host.
 */
export function getPublicAppBaseUrl(): string {
  const fromPublicApp = process.env.PUBLIC_APP_URL?.trim();
  if (fromPublicApp) {
    return stripTrailingSlash(fromPublicApp);
  }

  const fromNextAuth = process.env.NEXTAUTH_URL?.trim();
  if (fromNextAuth) {
    return stripTrailingSlash(fromNextAuth);
  }

  return DEFAULT_PUBLIC_APP_URL;
}
