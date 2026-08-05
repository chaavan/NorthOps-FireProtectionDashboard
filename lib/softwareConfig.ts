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
  /**
   * Keep the logo's own colours instead of flattening it to a single tone in
   * dark mode. The default treatment (brightness(0) invert(1)) suits a
   * monochrome wordmark but destroys a two-colour mark.
   */
  logoPreserveColor: boolean;
  /** Brand accent, used for highlights, borders and accent text. */
  accentColor: string;
  /** Darker accent for solid fills that carry white text (contrast-safe). */
  accentStrongColor: string;
  /**
   * Address that purchase-order mail falls back to when a supplier has no
   * configured recipients. Empty means "no fallback" — callers must filter it
   * out rather than mailing an empty address.
   */
  purchasingFallbackEmail: string;
};

/**
 * Every NEXT_PUBLIC_* value must be read as a STATIC property of process.env.
 *
 * The bundler rewrites `process.env.NEXT_PUBLIC_FOO` to a literal at build time;
 * it cannot do that for a computed key like `process.env[key]`. Reading these
 * dynamically leaves `process.env` empty in the browser, so every value silently
 * falls back to its default and the app appears to ignore its own branding
 * config — which is exactly what happened before this was fixed. Server-side
 * code hid the bug, because Node populates process.env for real at runtime.
 */
const RAW = {
  id: process.env.NEXT_PUBLIC_SOFTWARE_ID,
  name: process.env.NEXT_PUBLIC_SOFTWARE_NAME,
  tagline: process.env.NEXT_PUBLIC_SOFTWARE_TAGLINE,
  logoUrl: process.env.NEXT_PUBLIC_SOFTWARE_LOGO_URL,
  logoIconUrl: process.env.NEXT_PUBLIC_SOFTWARE_LOGO_ICON_URL,
  logoPreserveColor: process.env.NEXT_PUBLIC_SOFTWARE_LOGO_PRESERVE_COLOR,
  accent: process.env.NEXT_PUBLIC_BRAND_ACCENT,
  accentStrong: process.env.NEXT_PUBLIC_BRAND_ACCENT_STRONG,
  portalEnabled: process.env.NEXT_PUBLIC_ENABLE_SOFTWARE_PORTAL,
  locationSelectEnabled: process.env.NEXT_PUBLIC_ENABLE_LOCATION_SELECT,
  rolePermissionManagement: process.env.NEXT_PUBLIC_ENABLE_ROLE_PERMISSION_MANAGEMENT,
  portalUrl: process.env.NEXT_PUBLIC_PORTAL_URL,
} as const;

function str(value: string | undefined, fallback: string): string {
  return value && value.trim() ? value.trim() : fallback;
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") return fallback;
  return value.trim() === "true";
}

const softwareId = str(RAW.id, "northops-fire");
/** Branch deployments (e.g. northops-fire) skip the map portal unless explicitly enabled. */
const portalDefault = softwareId === "northops-fire" ? false : true;

export const softwareConfig: SoftwareConfig = {
  id: softwareId,
  name: str(RAW.name, "Fire Protection"),
  tagline: str(RAW.tagline, "Operational Dashboard"),
  logoUrl: str(RAW.logoUrl, "/northops-logo.png"),
  logoIconUrl: str(RAW.logoIconUrl, "/northops-icon.png"),
  portalEnabled: bool(RAW.portalEnabled, portalDefault),
  locationSelectEnabled: bool(RAW.locationSelectEnabled, portalDefault),
  portalUrl: RAW.portalUrl?.trim() || null,
  rolePermissionManagementEnabled: bool(RAW.rolePermissionManagement, true),
  logoPreserveColor: bool(RAW.logoPreserveColor, false),
  accentColor: str(RAW.accent, "#2563eb"),
  accentStrongColor: str(RAW.accentStrong, "#1d4ed8"),
  purchasingFallbackEmail: (
    process.env.NEXT_PUBLIC_PURCHASING_FALLBACK_EMAIL ||
    process.env.PURCHASING_FALLBACK_EMAIL ||
    ""
  )
    .trim()
    .toLowerCase(),
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
