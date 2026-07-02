export type SoftwareConfig = {
  id: string;
  name: string;
  tagline: string;
  logoUrl: string;
  logoIconUrl: string;
  portalEnabled: boolean;
  locationSelectEnabled: boolean;
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
  id: env("NEXT_PUBLIC_SOFTWARE_ID", "northops-fire"),
  name: env("NEXT_PUBLIC_SOFTWARE_NAME", "Fire Protection"),
  tagline: env("NEXT_PUBLIC_SOFTWARE_TAGLINE", "Operational Dashboard"),
  logoUrl: env("NEXT_PUBLIC_SOFTWARE_LOGO_URL", "/northops-logo.png"),
  logoIconUrl: env("NEXT_PUBLIC_SOFTWARE_LOGO_ICON_URL", "/northops-icon.png"),
  portalEnabled: envBool("NEXT_PUBLIC_ENABLE_SOFTWARE_PORTAL", true),
  locationSelectEnabled: envBool("NEXT_PUBLIC_ENABLE_LOCATION_SELECT", true),
  portalUrl: process.env.NEXT_PUBLIC_PORTAL_URL?.trim() || null,
  rolePermissionManagementEnabled: envBool("NEXT_PUBLIC_ENABLE_ROLE_PERMISSION_MANAGEMENT", true),
};

/** URL for "back to software selection" on login pages. */
export function getPortalBackUrl(): string | null {
  if (softwareConfig.portalEnabled) return "/";
  return softwareConfig.portalUrl;
}

/** URL for the location picker at /select (when enabled). */
export function getLocationSelectUrl(
  callbackUrl?: string | null,
): string {
  if (!softwareConfig.locationSelectEnabled) {
    const login = "/login";
    if (!callbackUrl || callbackUrl === "/") return login;
    return `${login}?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  }

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
