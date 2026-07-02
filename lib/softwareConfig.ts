export type SoftwareConfig = {
  id: string;
  name: string;
  tagline: string;
  logoUrl: string;
  portalEnabled: boolean;
  portalUrl: string | null;
  rolePermissionManagementEnabled: boolean;
};

function env(key: string, fallback: string): string {
  const value = process.env[key];
  return value && value.trim() ? value.trim() : fallback;
}

function envBool(key: string, fallback = false): boolean {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  return value === "true";
}

export const softwareConfig: SoftwareConfig = {
  id: env("NEXT_PUBLIC_SOFTWARE_ID", "totalfire"),
  name: env("NEXT_PUBLIC_SOFTWARE_NAME", "Total Fire Protection"),
  tagline: env("NEXT_PUBLIC_SOFTWARE_TAGLINE", "Operations Dashboard"),
  logoUrl: env("NEXT_PUBLIC_SOFTWARE_LOGO_URL", "/icon.png"),
  portalEnabled: envBool("NEXT_PUBLIC_ENABLE_SOFTWARE_PORTAL", true),
  portalUrl: process.env.NEXT_PUBLIC_PORTAL_URL?.trim() || null,
  rolePermissionManagementEnabled: envBool("NEXT_PUBLIC_ENABLE_ROLE_PERMISSION_MANAGEMENT", true),
};

/** URL for "back to software selection" on login pages. */
export function getPortalBackUrl(): string | null {
  if (softwareConfig.portalEnabled) return "/";
  return softwareConfig.portalUrl;
}

/** URL for the location picker (always available at /select). */
export function getLocationSelectUrl(
  callbackUrl?: string | null,
): string {
  const base = "/select";
  if (!callbackUrl || callbackUrl === "/") return base;
  return `${base}?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

/** Safe internal redirect target after login (blocks open redirects). */
export function sanitizeCallbackUrl(
  raw: string | null | undefined,
  fallback = "/",
): string {
  if (!raw || typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  return trimmed;
}
