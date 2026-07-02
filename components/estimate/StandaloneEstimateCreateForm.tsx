"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import DashboardSidebar from "@/components/DashboardSidebar";
import AccessDeniedOverlay from "@/components/AccessDeniedOverlay";
import EstimateConfigurableSelect from "@/components/estimate/EstimateConfigurableSelect";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { permissionLoadingFallback } from "@/lib/clientPermissionChecks";
import EstimateConfidenceScale from "@/components/estimate/EstimateConfidenceScale";
import { isEstimateTabEnabled } from "@/lib/featureFlags";
import { SALES_TYPE_OPTIONS } from "@/lib/estimate/estimateMetadata";
import type { EstimateConfidenceLevel, EstimateSalesType } from "@/lib/estimateTypes";

function fieldClassName() {
  return "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus:border-blue-400";
}

type EstimatorOption = {
  email: string;
  name: string | null;
  role: string;
};

function todayDateInputValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function estimatorDisplayName(user: { name?: string | null; email?: string | null }) {
  return user.name?.trim() || user.email?.trim() || "";
}

export default function StandaloneEstimateCreateForm() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { hasPermission, isLoading: permissionsLoading, isSuperAdmin, isDeveloper } = usePermissions();
  const role = (session?.user as any)?.role as string | undefined;
  const estimateLoadingFallback =
    permissionLoadingFallback({ role, isSuperAdmin, isDeveloper }) ||
    role === "ADMIN" ||
    role === "SALES";
  const canAccess =
    isEstimateTabEnabled() &&
    (permissionsLoading ? estimateLoadingFallback : hasPermission("estimates.create"));
  const canEditInfo = permissionsLoading
    ? estimateLoadingFallback
    : hasPermission("estimates.edit_info");
  const [form, setForm] = useState({
    projectDate: todayDateInputValue(),
    projectName: "",
    locationLine1: "",
    estimator: "",
    bidDueDate: "",
    systemLabel: "",
    salesType: "" as EstimateSalesType | "",
    confidenceLevel: null as EstimateConfidenceLevel | null,
  });
  const [buildingType, setBuildingType] = useState<{
    optionId: string | null;
    other: string | null;
  }>({ optionId: null, other: null });
  const [jobType, setJobType] = useState<{
    optionId: string | null;
    other: string | null;
  }>({ optionId: null, other: null });
  const [estimators, setEstimators] = useState<EstimatorOption[]>([]);
  const [isLoadingEstimators, setIsLoadingEstimators] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateForm = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const currentUserEstimator = useMemo(() => {
    return estimatorDisplayName({
      name: (session?.user as any)?.name,
      email: (session?.user as any)?.email,
    });
  }, [session]);

  useEffect(() => {
    if (!currentUserEstimator) return;
    setForm((current) =>
      current.estimator ? current : { ...current, estimator: currentUserEstimator },
    );
  }, [currentUserEstimator]);

  useEffect(() => {
    if (status === "loading" || permissionsLoading || !session || !canAccess) return;
    let cancelled = false;
    async function loadEstimators() {
      setIsLoadingEstimators(true);
      try {
        const response = await fetch("/api/users/for-access", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Failed to load estimators");
        if (!cancelled) {
          setEstimators(payload.users || []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError((loadError as Error).message);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingEstimators(false);
        }
      }
    }
    void loadEstimators();
    return () => {
      cancelled = true;
    };
  }, [session, status, permissionsLoading, canAccess]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const projectDate = form.projectDate.trim();
    const projectName = form.projectName.trim();
    const locationLine1 = form.locationLine1.trim();
    const estimator = form.estimator.trim();
    const bidDueDate = form.bidDueDate.trim();
    const systemLabel = form.systemLabel.trim();
    if (!projectDate || !projectName || !locationLine1 || !estimator || !bidDueDate || !systemLabel) {
      setError("Project date, estimator, project name, project location, bid due date, and system are required.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: projectName,
          projectName,
          locationLine1,
          projectDate,
          estimator,
          bidDueDate,
          systemLabel,
          buildingTypeOptionId: buildingType.optionId,
          buildingTypeOther: buildingType.other,
          jobTypeOptionId: jobType.optionId,
          jobTypeOther: jobType.other,
          salesType: form.salesType || null,
          confidenceLevel: form.confidenceLevel,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to create estimate");
      router.push(`/estimates/${encodeURIComponent(payload.estimate.id)}?from=active`);
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status === "loading" || permissionsLoading) {
    return <div className="min-h-screen bg-gray-50 dark:bg-slate-950" />;
  }

  if (!session) {
    router.push("/login?callbackUrl=/estimates/new");
    return <div className="min-h-screen bg-gray-50 dark:bg-slate-950" />;
  }

  if (!canAccess) {
    return (
      <div className="flex min-h-screen bg-gray-50 dark:bg-slate-900">
        <DashboardSidebar />
        <main className="pointer-events-none min-w-0 flex-1 select-none p-4 blur-sm opacity-60 md:p-6">
          <div className="mx-auto max-w-4xl">
            <div className="mb-5 h-20 rounded-xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
            <div className="h-96 rounded-2xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
          </div>
        </main>
        <AccessDeniedOverlay message="You do not have permission to create estimates." />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-slate-900">
      <DashboardSidebar />
      <main className="min-w-0 flex-1 p-4 md:p-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Standalone
              </div>
              <h1 className="mt-1 text-3xl font-bold text-slate-900 dark:text-white">
                New Estimate
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Set up the project, then jump into the estimator workspace.
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/estimates")}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Back
            </button>
          </div>

          <form
            onSubmit={submit}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/80"
          >
            {error ? (
              <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Project Date
                <input
                  type="date"
                  value={form.projectDate}
                  onChange={(event) => updateForm("projectDate", event.target.value)}
                  className={fieldClassName()}
                  required
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Estimator
                <select
                  value={form.estimator}
                  onChange={(event) => updateForm("estimator", event.target.value)}
                  className={fieldClassName()}
                  required
                >
                  {form.estimator ? null : (
                    <option value="">
                      {isLoadingEstimators ? "Loading estimators..." : "Select estimator"}
                    </option>
                  )}
                  {currentUserEstimator ? (
                    <option value={currentUserEstimator}>
                      {currentUserEstimator} (Current user)
                    </option>
                  ) : null}
                  {estimators
                    .filter((user) => estimatorDisplayName(user) !== currentUserEstimator)
                    .map((user) => {
                      const displayName = estimatorDisplayName(user);
                      return (
                        <option key={user.email} value={displayName}>
                          {user.name ? `${user.name} - ${user.email}` : user.email}
                        </option>
                      );
                    })}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Project Name
                <input
                  value={form.projectName}
                  onChange={(event) => updateForm("projectName", event.target.value)}
                  className={fieldClassName()}
                  required
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Project Location
                <input
                  value={form.locationLine1}
                  onChange={(event) => updateForm("locationLine1", event.target.value)}
                  className={fieldClassName()}
                  required
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Bid Due Date
                <input
                  type="date"
                  value={form.bidDueDate}
                  onChange={(event) => updateForm("bidDueDate", event.target.value)}
                  className={fieldClassName()}
                  required
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                System
                <input
                  type="text"
                  inputMode="text"
                  value={form.systemLabel}
                  onChange={(event) => updateForm("systemLabel", event.target.value)}
                  className={fieldClassName()}
                  required
                />
              </label>

              <EstimateConfigurableSelect
                label="Building Type"
                category="building_type"
                optionId={buildingType.optionId}
                otherValue={buildingType.other}
                inputClassName={fieldClassName()}
                allowAddOptions={canEditInfo}
                onChange={setBuildingType}
              />
              <EstimateConfigurableSelect
                label="Job Type"
                category="job_type"
                optionId={jobType.optionId}
                otherValue={jobType.other}
                inputClassName={fieldClassName()}
                allowAddOptions={canEditInfo}
                onChange={setJobType}
              />
              <label className="grid gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Sales Type
                <select
                  value={form.salesType}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      salesType:
                        event.target.value === "COMPETITIVE" ||
                        event.target.value === "NEGOTIATED"
                          ? event.target.value
                          : "",
                    }))
                  }
                  className={fieldClassName()}
                >
                  <option value="">Select sales type (optional)</option>
                  {SALES_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <EstimateConfidenceScale
                value={form.confidenceLevel}
                allowClear
                onChange={(value) =>
                  setForm((current) => ({ ...current, confidenceLevel: value }))
                }
              />
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                {isSubmitting ? "Creating..." : "Create Estimate"}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
