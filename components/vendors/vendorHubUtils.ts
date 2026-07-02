import type { VendorSetupStatus, UnifiedVendor } from "@/lib/vendorService";
import { formatVendorDisplay } from "@/lib/vendorUtils";

const AVATAR_COLORS = [
  "bg-amber-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-orange-500",
  "bg-teal-500",
  "bg-indigo-500",
];

export function vendorAvatarColor(vendorKey: string): string {
  let hash = 0;
  for (let i = 0; i < vendorKey.length; i += 1) {
    hash = vendorKey.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function vendorInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}

export type VendorFilter = "all" | "ready" | "needs_setup" | "inactive";

export function filterUnifiedVendors(
  vendors: UnifiedVendor[],
  filter: VendorFilter,
  search: string,
): UnifiedVendor[] {
  const query = search.trim().toLowerCase();

  return vendors.filter((vendor) => {
    if (filter === "ready" && vendor.setupStatus !== "ready") return false;
    if (filter === "needs_setup" && vendor.setupStatus !== "needs_setup" && vendor.setupStatus !== "inventory_only") {
      return false;
    }
    if (filter === "inactive" && vendor.setupStatus !== "inactive") return false;

    if (!query) return true;

    const haystack = [
      vendor.displayName,
      vendor.vendorKey,
      formatVendorDisplay(vendor.vendorKey),
      ...vendor.toEmails,
      ...vendor.ccEmails,
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

export function vendorStatusLabel(status: VendorSetupStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "needs_setup":
      return "Needs setup";
    case "inactive":
      return "Inactive";
    case "inventory_only":
      return "Needs setup";
    default:
      return status;
  }
}

export function vendorStatusClass(status: VendorSetupStatus): string {
  switch (status) {
    case "ready":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
    case "needs_setup":
    case "inventory_only":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
    case "inactive":
      return "bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-300";
    default:
      return "bg-slate-200 text-slate-700";
  }
}

export function sanitizeEmailListForDisplay(emails: string[]): string[] {
  return emails.map((email) => email.trim()).filter(Boolean);
}
