"use client";

import { Mail, Package, Pencil, Settings2, Trash2 } from "lucide-react";
import type { UnifiedVendor } from "@/lib/vendorService";
import {
  sanitizeEmailListForDisplay,
  vendorAvatarColor,
  vendorInitials,
  vendorStatusClass,
  vendorStatusLabel,
} from "@/components/vendors/vendorHubUtils";
import { formatVendorDisplay } from "@/lib/vendorUtils";

type VendorCardProps = {
  vendor: UnifiedVendor;
  onEdit: (vendor: UnifiedVendor) => void;
  onConfigure: (vendor: UnifiedVendor) => void;
  onArchive: (vendor: UnifiedVendor) => void;
  isArchiving?: boolean;
};

export default function VendorCard({
  vendor,
  onEdit,
  onConfigure,
  onArchive,
  isArchiving = false,
}: VendorCardProps) {
  const toEmails = sanitizeEmailListForDisplay(vendor.toEmails);
  const emailPreview = toEmails[0] ?? null;
  const isInventoryOnly = vendor.setupStatus === "inventory_only";

  return (
    <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md dark:border-slate-600/60 dark:bg-slate-900/50 dark:hover:border-slate-500">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white ${vendorAvatarColor(vendor.vendorKey)}`}
        >
          {vendorInitials(vendor.displayName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-bold text-slate-900 dark:text-white">
              {vendor.displayName}
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${vendorStatusClass(vendor.setupStatus)}`}
            >
              {vendorStatusLabel(vendor.setupStatus)}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            {formatVendorDisplay(vendor.vendorKey)}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2 text-sm">
        <div className="flex items-start gap-2 text-slate-600 dark:text-slate-300">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
          <span className="min-w-0 break-words">
            {emailPreview ?? "No emails configured"}
            {toEmails.length > 1 ? (
              <span className="text-slate-400 dark:text-slate-500"> +{toEmails.length - 1} more</span>
            ) : null}
          </span>
        </div>
        {vendor.partCount > 0 ? (
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <Package className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
            <span>
              {vendor.partCount.toLocaleString()} part{vendor.partCount === 1 ? "" : "s"} in inventory
            </span>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-700/60">
        {isInventoryOnly ? (
          <button
            type="button"
            onClick={() => onConfigure(vendor)}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-amber-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-700"
          >
            <Settings2 className="h-4 w-4" strokeWidth={2} aria-hidden />
            Configure
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onEdit(vendor)}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Pencil className="h-4 w-4" strokeWidth={2} aria-hidden />
              Edit
            </button>
            {vendor.isActive ? (
              <button
                type="button"
                onClick={() => onArchive(vendor)}
                disabled={isArchiving}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden />
                Archive
              </button>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}
