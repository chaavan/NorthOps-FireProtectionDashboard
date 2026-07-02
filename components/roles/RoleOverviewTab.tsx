"use client";

import Link from "next/link";
import RoleColorPicker, { isRoleColorValidForSave } from "@/components/roles/RoleColorPicker";
import { formatDateInAppTimeZone } from "@/lib/timezone";
import {
  estimateMetricCard,
  estimateMutedPanel,
  estimatePanel,
  estimatePanelTitle,
  estimateProgressTrack,
} from "@/lib/estimate/estimateUi";
import type { RoleColorOwner } from "@/lib/roleBadgeColor";
import { computeRoleOverviewStats } from "@/lib/roleOverview";
import type { PermissionKey } from "@/lib/permissionCatalog";
import type { RoleFormValues } from "@/lib/roleUi";

type RoleOverviewTabProps = {
  roleKey: string;
  role: {
    key: string;
    name: string;
    colorClass: string | null;
    isSystem: boolean;
    isActive: boolean;
    userCount?: number;
    updatedAt?: string;
  };
  form: RoleFormValues;
  onChange: (values: RoleFormValues) => void;
  permissions: Partial<Record<PermissionKey, boolean>>;
  allRoles: RoleColorOwner[];
  isSubmitting: boolean;
  onSave: () => void;
  permissionsHref: (pageId: string) => string;
};

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className={`${estimateMetricCard} p-2.5 sm:p-3`}>
      <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 sm:text-[10px]">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white sm:text-xl">{value}</div>
      <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-500 sm:text-xs">{helper}</div>
    </div>
  );
}

const pageStatusStyles = {
  full: "bg-green-500/15 text-green-700 dark:text-green-300",
  partial: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  off: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
};

export default function RoleOverviewTab({
  roleKey,
  role,
  form,
  onChange,
  permissions,
  allRoles,
  isSubmitting,
  onSave,
  permissionsHref,
}: RoleOverviewTabProps) {
  const stats = computeRoleOverviewStats(permissions, role.userCount ?? 0);
  const canSave =
    form.name.trim().length > 0 &&
    isRoleColorValidForSave(form.colorClass, allRoles, roleKey) &&
    !isSubmitting;

  const lastUpdated = role.updatedAt
    ? formatDateInAppTimeZone(role.updatedAt)
    : "—";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-2 overflow-hidden sm:gap-3 lg:gap-4">
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <MetricCard
          label="Users assigned"
          value={String(stats.assignedUsers)}
          helper="Active users with this role"
        />
        <MetricCard
          label="Permissions allowed"
          value={`${stats.permissionsAllowed}/${stats.totalAdjustablePermissions}`}
          helper="Adjustable permissions enabled"
        />
        <MetricCard
          label="App pages enabled"
          value={stats.pagesEnabledLabel}
          helper={`${stats.pagesFullyOn} full · ${stats.pagesPartial} partial · ${stats.pagesOff} off`}
        />
        <MetricCard label="Last updated" value={lastUpdated} helper="Role metadata or permissions" />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:gap-3 min-[900px]:grid-cols-2 min-[900px]:gap-4">
        <section
          className={`${estimatePanel} flex min-h-0 flex-col gap-3 overflow-y-auto p-3 sm:gap-4 sm:p-4 lg:p-5`}
        >
          <div className="shrink-0">
            <h2 className={`${estimatePanelTitle} text-base sm:text-lg`}>Identity</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
              Edit the display name and badge color. The role key cannot be changed.
            </p>
          </div>

          <div className={`${estimateMutedPanel} shrink-0 py-2.5 sm:py-3`}>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Role key</p>
            <p className="mt-0.5 font-mono text-sm text-slate-800 dark:text-slate-200">{role.key}</p>
          </div>

          <div className="shrink-0">
            <label className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">
              Role name
            </label>
            <input
              value={form.name}
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              required
              placeholder="e.g. Field Technician"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white sm:px-4 sm:py-3"
            />
          </div>

          <div className="min-h-0 shrink-0">
            <label className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">
              Badge appearance
            </label>
            <RoleColorPicker
              previewName={form.name}
              colorClass={form.colorClass}
              onChange={(colorClass) => onChange({ ...form, colorClass })}
              allRoles={allRoles}
              excludeRoleKey={roleKey}
            />
          </div>

          <div className="mt-auto flex shrink-0 justify-end border-t border-slate-200 pt-3 dark:border-slate-700/50">
            <button
              type="button"
              disabled={!canSave}
              onClick={onSave}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 sm:px-5 sm:py-2.5"
            >
              {isSubmitting ? "Saving..." : "Save changes"}
            </button>
          </div>
        </section>

        <section className={`${estimatePanel} flex min-h-0 flex-col p-3 sm:p-4 lg:p-5`}>
          <div className="mb-2 shrink-0 sm:mb-3">
            <h2 className={`${estimatePanelTitle} text-base sm:text-lg`}>Page access</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
              Default access by app page. Tap a row to jump to permissions.
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5 sm:space-y-2.5">
            {stats.pageSummaries.map((page) => (
              <Link
                key={page.id}
                href={permissionsHref(page.id)}
                className="block rounded-lg border border-slate-200 bg-slate-50 p-2.5 transition hover:border-blue-400/50 hover:bg-white dark:border-slate-700/50 dark:bg-slate-900/30 dark:hover:bg-slate-900/50 sm:rounded-xl sm:p-3"
              >
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5 sm:mb-2 sm:gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900 dark:text-white sm:text-base">
                      {page.label}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide sm:px-2 sm:text-[10px] ${pageStatusStyles[page.status]}`}
                    >
                      {page.status}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-slate-600 dark:text-slate-300 sm:text-sm">
                    {page.allowed}/{page.total}
                  </span>
                </div>
                <div className={estimateProgressTrack}>
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${page.percent}%` }}
                  />
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
