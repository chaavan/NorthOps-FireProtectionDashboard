"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import DashboardSidebar from "@/components/DashboardSidebar";
import AccessDeniedOverlay from "@/components/AccessDeniedOverlay";
import { isEstimateTabEnabled } from "@/lib/featureFlags";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { permissionLoadingFallback } from "@/lib/clientPermissionChecks";
import type {
  StandaloneEstimateBidStatus,
  StandaloneEstimateSummaryRecord,
} from "@/lib/estimateTypes";

type ViewMode = "active" | "archive";

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function bidStatusLabel(status: StandaloneEstimateBidStatus | string | null | undefined) {
  if (status === "SENT") return "Sent";
  if (status === "WON") return "Won";
  if (status === "LOST") return "Lost";
  if (status === "ARCHIVED") return "Archived";
  return "Draft";
}

function bidStatusClassName(status: StandaloneEstimateBidStatus | string | null | undefined) {
  if (status === "SENT") return "border-blue-400/40 bg-blue-50 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200";
  if (status === "WON") return "border-emerald-400/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200";
  if (status === "LOST") return "border-rose-400/40 bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200";
  if (status === "ARCHIVED") return "border-slate-400/60 bg-slate-100 text-slate-700 dark:border-slate-500/60 dark:bg-slate-700/40 dark:text-slate-200";
  return "border-amber-500/50 bg-amber-100 text-amber-950 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200";
}

export default function StandaloneEstimateDashboard({ view }: { view: ViewMode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const { hasPermission, isLoading: permissionsLoading, isSuperAdmin, isDeveloper } = usePermissions();
  const role = (session?.user as any)?.role as string | undefined;
  const estimateLoadingFallback =
    permissionLoadingFallback({ role, isSuperAdmin, isDeveloper }) ||
    role === "ADMIN" ||
    role === "SALES";
  const canAccess =
    isEstimateTabEnabled() &&
    (permissionsLoading ? estimateLoadingFallback : hasPermission("estimates.view"));
  const canCreate =
    permissionsLoading ? estimateLoadingFallback : hasPermission("estimates.create");
  const canArchive =
    permissionsLoading ? estimateLoadingFallback : hasPermission("estimates.archive");
  const [estimates, setEstimates] = useState<StandaloneEstimateSummaryRecord[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [busyEstimateId, setBusyEstimateId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StandaloneEstimateSummaryRecord | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pageTitle = view === "archive" ? "Estimate Archives" : "Active Estimates";
  const pageSubtitle =
    view === "archive"
      ? "Won, lost, and archived standalone estimates."
      : "Draft and sent standalone estimates ready to work.";

  const loadEstimates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ view });
      if (search.trim()) params.set("search", search.trim());
      const response = await fetch(`/api/estimates?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to load estimates");
      setEstimates(payload.estimates || []);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [search, view]);

  useEffect(() => {
    if (status === "loading" || permissionsLoading) return;
    if (!session) {
      router.push(`/login?callbackUrl=${view === "archive" ? "/estimates/archive" : "/estimates"}`);
      return;
    }
    if (!canAccess) return;
    const timer = window.setTimeout(() => {
      void loadEstimates();
    }, 150);
    return () => window.clearTimeout(timer);
  }, [session, status, permissionsLoading, canAccess, router, loadEstimates, view, pathname]);

  const totals = useMemo(() => {
    return estimates.reduce(
      (acc, estimate) => {
        acc.count += 1;
        acc.amount += estimate.activeVariant?.totalCost ?? 0;
        return acc;
      },
      { count: 0, amount: 0 },
    );
  }, [estimates]);

  const deleteEstimate = async (estimate: StandaloneEstimateSummaryRecord) => {
    setBusyEstimateId(estimate.id);
    setError(null);
    try {
      const response = await fetch(`/api/estimates/${encodeURIComponent(estimate.id)}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to delete estimate");
      setDeleteTarget(null);
      setDeleteConfirm("");
      await loadEstimates();
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setBusyEstimateId(null);
    }
  };

  const restoreEstimate = async (estimateId: string) => {
    setBusyEstimateId(estimateId);
    setError(null);
    try {
      const response = await fetch(`/api/estimates/${encodeURIComponent(estimateId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restore: true }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to restore estimate");
      router.push(`/estimates/${encodeURIComponent(payload.estimate.id)}?from=archive`);
    } catch (restoreError) {
      setError((restoreError as Error).message);
    } finally {
      setBusyEstimateId(null);
    }
  };

  if (status === "loading" || permissionsLoading) {
    return <div className="min-h-screen bg-gray-50 dark:bg-slate-950" />;
  }

  if (!session || !canAccess) {
    return (
      <div className="flex min-h-screen bg-gray-50 dark:bg-slate-900">
        <DashboardSidebar />
        <main className="pointer-events-none min-w-0 flex-1 select-none p-4 blur-sm opacity-60 md:p-6">
          <div className="mx-auto flex max-w-7xl flex-col gap-5">
            <div className="h-24 rounded-xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
            <div className="grid gap-4 md:grid-cols-3">
              <div className="h-28 rounded-xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
              <div className="h-28 rounded-xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
              <div className="h-28 rounded-xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
            </div>
          </div>
        </main>
        <AccessDeniedOverlay message="You do not have permission to view Estimates." />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-slate-900">
      <DashboardSidebar />
      <main className="min-w-0 flex-1 p-4 md:p-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Standalone
              </div>
              <h1 className="mt-1 text-3xl font-bold text-slate-900 dark:text-white">
                {pageTitle}
              </h1>
              <p className="mt-2 text-sm text-slate-500">{pageSubtitle}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => router.push("/estimates")}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  view === "active"
                    ? "border-blue-500 bg-blue-600 text-white"
                    : "border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                }`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => router.push("/estimates/archive")}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  view === "archive"
                    ? "border-blue-500 bg-blue-600 text-white"
                    : "border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                }`}
              >
                Archives
              </button>
              {canCreate ? (
                <button
                  type="button"
                  onClick={() => router.push("/estimates/new")}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
                >
                  New Estimate
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by title, project, number, or location..."
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {totals.count} estimate{totals.count === 1 ? "" : "s"}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              {formatCurrency(totals.amount)}
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {isLoading ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">
              Loading estimates...
            </div>
          ) : estimates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-800/70">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                {view === "archive" ? "No archived estimates yet" : "No active estimates yet"}
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                {view === "archive"
                  ? "Won, lost, and archived estimates will appear here."
                  : canCreate
                    ? "Create a standalone estimate to start estimating a job."
                    : "Active estimates will appear here."}
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {estimates.map((estimate) => (
                <div
                  key={estimate.id}
                  className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/80 lg:grid-cols-[1fr_auto]"
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (view === "active") {
                        router.push(`/estimates/${encodeURIComponent(estimate.id)}?from=active`);
                      }
                    }}
                    className="min-w-0 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {estimate.projectName || estimate.title || "Untitled Estimate"}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${bidStatusClassName(
                          estimate.bidStatus,
                        )}`}
                      >
                        {bidStatusLabel(estimate.bidStatus)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-500">
                      <span>{estimate.projectNumber || "No project #"}</span>
                      <span>{estimate.locationLine1 || "No location"}</span>
                      {estimate.locationLine2 ? <span>{estimate.locationLine2}</span> : null}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      Updated {new Date(estimate.updatedAt).toLocaleDateString()}
                    </div>
                  </button>
                  <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end">
                    <div className="text-right">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Total</div>
                      <div className="text-lg font-bold text-slate-900 dark:text-white">
                        {formatCurrency(estimate.activeVariant?.totalCost)}
                      </div>
                    </div>
                    {view === "archive" ? (
                      canArchive ? (
                      <button
                        type="button"
                        onClick={() => void restoreEstimate(estimate.id)}
                        disabled={busyEstimateId === estimate.id}
                        className="rounded-lg border border-emerald-400/50 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-400/50 dark:text-emerald-200 dark:hover:bg-emerald-500/10"
                      >
                        {busyEstimateId === estimate.id ? "Restoring..." : "Restore"}
                      </button>
                      ) : null
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          router.push(`/estimates/${encodeURIComponent(estimate.id)}?from=active`)
                        }
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        Open
                      </button>
                    )}
                    {canArchive ? (
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteTarget(estimate);
                        setDeleteConfirm("");
                      }}
                      disabled={busyEstimateId === estimate.id}
                      className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-400/50 dark:text-red-200 dark:hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm dark:bg-slate-950/60">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Delete estimate</h2>
            <p className="mt-2 text-sm text-slate-500">
              This permanently deletes{" "}
              <strong className="text-slate-800 dark:text-slate-200">
                {deleteTarget.title}
              </strong>{" "}
              and all estimation sheets inside it. This cannot be undone.
            </p>
            <label className="mt-5 grid gap-1 text-sm font-semibold text-slate-700 dark:text-slate-300">
              Type DELETE to confirm
              <input
                autoFocus
                value={deleteConfirm}
                onChange={(event) => setDeleteConfirm(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-red-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              />
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteConfirm("");
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteEstimate(deleteTarget)}
                disabled={busyEstimateId === deleteTarget.id || deleteConfirm !== "DELETE"}
                className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-400/60 dark:bg-red-500/10 dark:text-red-100 dark:hover:bg-red-500/20"
              >
                {busyEstimateId === deleteTarget.id ? "Deleting..." : "Delete estimate"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
