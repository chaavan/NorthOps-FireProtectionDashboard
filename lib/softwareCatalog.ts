export type SoftwareEntry = {
  id: string;
  name: string;
  description: string;
  logoUrl: string;
  loginUrl: string;
  status: "active" | "coming_soon";
};

const defaultCatalog: SoftwareEntry[] = [
  {
    id: "northops-fire",
    name: "Fire Protection",
    description:
      "Job pulling, inventory, vendor orders, and shop operations.",
    logoUrl: "/northops-logo.png",
    loginUrl: "/login",
    status: "active",
  },
];

export function getSoftwareCatalog(): SoftwareEntry[] {
  const raw = process.env.NEXT_PUBLIC_SOFTWARE_CATALOG_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as SoftwareEntry[];
      }
    } catch {
      // Fall back to default catalog.
    }
  }
  return defaultCatalog;
}

export function buildSoftwareLoginUrl(
  entry: SoftwareEntry,
  callbackUrl?: string | null,
): string {
  if (!callbackUrl) return entry.loginUrl;

  const encoded = encodeURIComponent(callbackUrl);

  if (entry.loginUrl.startsWith("http://") || entry.loginUrl.startsWith("https://")) {
    try {
      const url = new URL(entry.loginUrl);
      url.searchParams.set("callbackUrl", callbackUrl);
      return url.toString();
    } catch {
      return entry.loginUrl;
    }
  }

  const separator = entry.loginUrl.includes("?") ? "&" : "?";
  return `${entry.loginUrl}${separator}callbackUrl=${encoded}`;
}
