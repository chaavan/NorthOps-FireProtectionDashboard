"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import DashboardSidebar from "@/components/DashboardSidebar";
import AccessDeniedOverlay from "@/components/AccessDeniedOverlay";
import { isEstimateTabEnabled } from "@/lib/featureFlags";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { permissionLoadingFallback } from "@/lib/clientPermissionChecks";
import {
  addCatalogPartToDraft,
  catalogRowToPart,
  isCatalogRowAddable,
} from "@/lib/estimate/catalogMaterialAdd";
import type { EstimateCatalogRow, EstimateDraft } from "@/lib/estimateTypes";
import { getWorkbookTemplateDisplayName } from "@/lib/estimate/estimateWorkbookProfile";
import {
  estimateAlertError,
  estimateAlertSuccess,
  estimateCatalogGroupHeader,
  estimateCatalogGroupTitle,
  estimateCatalogLogDiffPanel,
  estimateCatalogTabContent,
  estimateInputFieldCompact,
  estimateInputFieldCompactSm,
  estimateModalCancelBtn,
  estimateModalDescription,
  estimateModalOverlay,
  estimateModalPanel,
  estimateModalTitle,
  estimatePricingInput,
  estimatePrimaryButton,
  estimateSecondaryButton,
  estimateSecondaryButtonSm,
  estimateSectionDescription,
  estimateSectionTitle,
  estimateTableBody,
  estimateTableHead,
  estimateWorkbookTabActive,
  estimateWorkbookTabInactive,
  estimateWorkbookTabList,
} from "@/lib/estimate/estimateUi";

type CatalogTab = "parts" | "logs";

type EditDraft = {
  label: string;
  description: string;
  detail: string;
  section: string;
  subcategory: string;
  defaultUnitCost: string;
};

type CatalogLog = {
  id: string;
  rowKey: string;
  actorEmail: string | null;
  changedFields: string[];
  beforeData: Record<string, unknown>;
  afterData: Record<string, unknown>;
  createdAt: string;
};

function formatCurrency(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function rowToDraft(row: EstimateCatalogRow): EditDraft {
  return {
    label: row.label ?? "",
    description: row.description ?? "",
    detail: row.detail ?? "",
    section: row.section ?? "",
    subcategory: row.subcategory ?? "",
    defaultUnitCost:
      typeof row.defaultUnitCost === "number" && Number.isFinite(row.defaultUnitCost)
        ? String(row.defaultUnitCost)
        : "",
  };
}

function draftToPatch(draft: EditDraft, row: EstimateCatalogRow) {
  return {
    label: draft.label,
    description: draft.description,
    detail: draft.detail,
    section: draft.section,
    subcategory: draft.subcategory,
    ...(row.formulaKey ? {} : { defaultUnitCost: draft.defaultUnitCost === "" ? null : Number(draft.defaultUnitCost) }),
  };
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return formatCurrency(value);
  return String(value);
}

function combinedPartDescription(row: EstimateCatalogRow) {
  return [row.label, row.description, row.detail]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

export default function MaterialCatalogPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const canEditWorkbook = permissionsLoading
    ? estimateLoadingFallback
    : hasPermission("estimates.edit");
  const workbookTemplateName = getWorkbookTemplateDisplayName();
  const estimateId = searchParams?.get("estimateId");
  const variantKey = searchParams?.get("variantKey") || "base";

  const [activeTab, setActiveTab] = useState<CatalogTab>("parts");
  const [rows, setRows] = useState<EstimateCatalogRow[]>([]);
  const [logs, setLogs] = useState<CatalogLog[]>([]);
  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [subcategoryFilter, setSubcategoryFilter] = useState("all");
  const [isLoadingRows, setIsLoadingRows] = useState(true);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [isSavingRow, setIsSavingRow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [estimateDraft, setEstimateDraft] = useState<EstimateDraft | null>(null);
  const [estimateTitle, setEstimateTitle] = useState<string | null>(null);
  const [isLoadingEstimate, setIsLoadingEstimate] = useState(false);
  const [addQuantities, setAddQuantities] = useState<Record<string, number>>({});
  const [addingRowKey, setAddingRowKey] = useState<string | null>(null);

  const canAddToEstimate = Boolean(estimateId) && canEditWorkbook;

  useEffect(() => {
    if (status === "loading" || permissionsLoading) return;
    if (!session) {
      router.push("/login?callbackUrl=/estimates/material-catalog");
    }
  }, [permissionsLoading, router, session, status]);

  const loadRows = async () => {
    setIsLoadingRows(true);
    setError(null);
    try {
      const response = await fetch("/api/estimates/material-catalog", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to load material catalog");
      setRows(payload.rows || []);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsLoadingRows(false);
    }
  };

  const loadLogs = async () => {
    setIsLoadingLogs(true);
    setError(null);
    try {
      const response = await fetch("/api/estimates/material-catalog/logs?limit=150", {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to load material catalog logs");
      setLogs(payload.logs || []);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const loadEstimateDraft = async () => {
    if (!estimateId) return;
    setIsLoadingEstimate(true);
    try {
      const response = await fetch(
        `/api/estimates/${encodeURIComponent(estimateId)}?variantKey=${encodeURIComponent(variantKey)}`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to load estimate");
      setEstimateDraft(payload.variant?.data ?? null);
      setEstimateTitle(payload.estimate?.title ?? null);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsLoadingEstimate(false);
    }
  };

  useEffect(() => {
    if (status === "loading" || permissionsLoading || !session || !canAccess) return;
    void loadRows();
  }, [canAccess, permissionsLoading, session, status]);

  useEffect(() => {
    if (status === "loading" || permissionsLoading || !session || !canAccess || !estimateId) return;
    void loadEstimateDraft();
  }, [canAccess, estimateId, permissionsLoading, session, status, variantKey]);

  useEffect(() => {
    if (
      activeTab !== "logs" ||
      !canEditWorkbook ||
      status === "loading" ||
      permissionsLoading ||
      !session ||
      !canAccess
    ) {
      return;
    }
    void loadLogs();
  }, [activeTab, canAccess, canEditWorkbook, permissionsLoading, session, status]);

  useEffect(() => {
    if (canEditWorkbook || activeTab !== "logs") return;
    setActiveTab("parts");
  }, [activeTab, canEditWorkbook]);

  useEffect(() => {
    if (canEditWorkbook) return;
    setIsUnlocked(false);
    setPassword("");
    setPasswordInput("");
    setShowPasswordPrompt(false);
    cancelEdit();
  }, [canEditWorkbook]);

  useEffect(() => {
    if (!message && !error) return;
    const timer = window.setTimeout(() => {
      setMessage(null);
      setError(null);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [error, message]);

  const addableRows = useMemo(
    () => rows.filter((row) => isCatalogRowAddable(row) && Boolean(row.section?.trim())),
    [rows],
  );

  const selectedEstimateRowKeys = useMemo(
    () =>
      new Set(
        (estimateDraft?.materials.visibleLines ?? [])
          .map((line) => line.catalogRowKey)
          .filter((rowKey): rowKey is string => Boolean(rowKey)),
      ),
    [estimateDraft],
  );

  const addPartToEstimate = async (row: EstimateCatalogRow) => {
    if (!canEditWorkbook) return;
    if (!estimateId || !estimateDraft || !isCatalogRowAddable(row)) return;
    const quantity = Math.max(0, addQuantities[row.rowKey] ?? 0);
    if (quantity <= 0) {
      setError("Enter a quantity greater than zero.");
      return;
    }
    const part = catalogRowToPart(row);
    const nextDraft = addCatalogPartToDraft(estimateDraft, { part, quantity });
    setAddingRowKey(row.rowKey);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/estimates/${encodeURIComponent(estimateId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variantKey,
          draft: nextDraft,
          title: estimateTitle,
          projectName: nextDraft.project.projectName,
          projectNumber: nextDraft.project.systemLabel,
          locationLine1: nextDraft.project.projectLocationLine1,
          locationLine2: nextDraft.project.projectLocationLine2,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to add part to estimate");
      setEstimateDraft(payload.variant?.data ?? nextDraft);
      setAddQuantities((current) => ({ ...current, [row.rowKey]: 0 }));
      setMessage(`Added ${part.partNumber} × ${quantity} to the estimate. Child parts will auto-calculate on save.`);
    } catch (addError) {
      setError((addError as Error).message);
    } finally {
      setAddingRowKey(null);
    }
  };

  const sectionOptions = useMemo(
    () => Array.from(new Set(addableRows.map((row) => row.section).filter(Boolean))).sort(),
    [addableRows],
  );

  const subcategoryOptions = useMemo(() => {
    const source =
      sectionFilter === "all"
        ? addableRows
        : addableRows.filter((row) => row.section === sectionFilter);
    return Array.from(new Set(source.map((row) => row.subcategory).filter(Boolean) as string[])).sort();
  }, [addableRows, sectionFilter]);

  const editSectionOptions = useMemo(
    () => Array.from(new Set(addableRows.map((row) => row.section).filter(Boolean))).sort(),
    [addableRows],
  );

  const editSubcategoryOptions = useMemo(() => {
    if (!editDraft?.section) {
      return Array.from(
        new Set(addableRows.map((row) => row.subcategory).filter(Boolean) as string[]),
      ).sort();
    }
    return Array.from(
      new Set(
        addableRows
          .filter((row) => row.section === editDraft.section)
          .map((row) => row.subcategory)
          .filter(Boolean) as string[],
      ),
    ).sort();
  }, [addableRows, editDraft?.section]);

  useEffect(() => {
    if (subcategoryFilter !== "all" && !subcategoryOptions.includes(subcategoryFilter)) {
      setSubcategoryFilter("all");
    }
  }, [subcategoryFilter, subcategoryOptions]);

  const filteredRows = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return addableRows.filter((row) => {
      if (sectionFilter !== "all" && row.section !== sectionFilter) return false;
      if (subcategoryFilter !== "all" && row.subcategory !== subcategoryFilter) return false;
      if (terms.length === 0) return true;
      const haystack = [
        row.sheetRow,
        row.label,
        row.description,
        row.detail,
        row.section,
        row.subcategory,
        row.defaultUnitCost,
        row.unitCost,
      ]
        .filter((value) => value !== null && value !== undefined)
        .join(" ")
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [addableRows, query, sectionFilter, subcategoryFilter]);

  const groupedRows = useMemo(() => {
    const groups = new Map<string, EstimateCatalogRow[]>();
    filteredRows.forEach((row) => {
      const key = `${row.section}|||${row.subcategory || ""}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    });
    return Array.from(groups.entries()).map(([key, groupRows]) => {
      const [section, subcategory] = key.split("|||");
      return { key, section, subcategory, rows: groupRows };
    });
  }, [filteredRows]);

  const allVisibleGroupsCollapsed =
    groupedRows.length > 0 && groupedRows.every((group) => collapsedGroups[group.key]);

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  };

  const setAllVisibleGroupsCollapsed = (collapsed: boolean) => {
    setCollapsedGroups((current) => {
      const next = { ...current };
      groupedRows.forEach((group) => {
        next[group.key] = collapsed;
      });
      return next;
    });
  };

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEditWorkbook) return;
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/estimates/material-catalog/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not unlock edit mode");
      setPassword(passwordInput);
      setIsUnlocked(true);
      setShowPasswordPrompt(false);
      setPasswordInput("");
      setMessage("Edit mode unlocked for this page.");
    } catch (unlockError) {
      setError((unlockError as Error).message);
    }
  };

  const startEdit = (row: EstimateCatalogRow) => {
    setEditingRowKey(row.rowKey);
    setEditDraft(rowToDraft(row));
    setMessage(null);
  };

  const cancelEdit = () => {
    setEditingRowKey(null);
    setEditDraft(null);
  };

  const saveRow = async (row: EstimateCatalogRow) => {
    if (!editDraft) return;
    setIsSavingRow(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/estimates/material-catalog/rows/${encodeURIComponent(row.rowKey)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password,
            patch: draftToPatch(editDraft, row),
            estimateId,
            variantKey,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to save catalog row");
      setRows((current) =>
        current.map((currentRow) => (currentRow.rowKey === row.rowKey ? payload.row : currentRow)),
      );
      cancelEdit();
      setMessage(
        payload.changedFields?.length
          ? `Saved ${payload.changedFields.length} catalog change${payload.changedFields.length === 1 ? "" : "s"}.`
          : "No catalog changes to save.",
      );
      if (activeTab === "logs") void loadLogs();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setIsSavingRow(false);
    }
  };

  const deleteRowPath = async (row: EstimateCatalogRow) => {
    if (!editDraft) return;
    setIsSavingRow(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/estimates/material-catalog/rows/${encodeURIComponent(row.rowKey)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password,
            patch: {
              ...draftToPatch(editDraft, row),
              section: "",
              subcategory: "",
            },
            estimateId,
            variantKey,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to delete catalog path");
      setRows((current) =>
        current.map((currentRow) => (currentRow.rowKey === row.rowKey ? payload.row : currentRow)),
      );
      cancelEdit();
      setMessage("Deleted this part's section/subcategory path.");
      if (activeTab === "logs") void loadLogs();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setIsSavingRow(false);
    }
  };

  if (status === "loading" || permissionsLoading || !session) {
    return (
      <div className="flex h-screen overflow-hidden bg-gray-50 text-slate-900 dark:bg-slate-950 dark:text-white">
        <DashboardSidebar />
        <main className="min-w-0 flex-1 overflow-y-auto p-6">Loading material catalog...</main>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="flex h-screen overflow-hidden bg-gray-50 text-slate-900 dark:bg-slate-950 dark:text-white">
        <DashboardSidebar />
        <main className="pointer-events-none min-w-0 flex-1 select-none space-y-5 overflow-y-auto p-4 blur-sm opacity-60 md:p-6">
          <div className="h-24 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70" />
          <div className="h-96 rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70" />
        </main>
        <AccessDeniedOverlay message="You do not have permission to view the estimate material catalog." />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <DashboardSidebar />
      <main className="min-w-0 flex-1 space-y-5 overflow-y-auto p-4 md:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70">
          <div>
            <h1 className={estimateSectionTitle}>Material Catalog</h1>
            <p className={estimateSectionDescription}>
              Browse {workbookTemplateName} material defaults.
            </p>
            {estimateId && canEditWorkbook ? (
              <p className="mt-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
                {isLoadingEstimate
                  ? "Loading estimate for add-to-sheet..."
                  : "Add parts with quantity below. Child/sub parts auto-calculate when saved."}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => router.back()}
              className={estimateSecondaryButton}
            >
              Back
            </button>
            {canEditWorkbook && isUnlocked ? (
              <button
                type="button"
                onClick={() => {
                  setIsUnlocked(false);
                  setPassword("");
                  cancelEdit();
                  setMessage("Edit mode locked.");
                }}
                className="rounded-lg border border-amber-500/50 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 dark:border-amber-400/50 dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-400/10"
              >
                Lock Editing
              </button>
            ) : canEditWorkbook ? (
              <button
                type="button"
                onClick={() => setShowPasswordPrompt(true)}
                className={estimatePrimaryButton}
              >
                Edit
              </button>
            ) : null}
          </div>
        </header>

        {error ? (
          <div className={estimateAlertError}>
            {error}
          </div>
        ) : null}
        {message ? (
          <div className={estimateAlertSuccess}>
            {message}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70">
          <div role="tablist" className={estimateWorkbookTabList}>
            {[
              { key: "parts" as const, label: "All Parts" },
              ...(canEditWorkbook ? [{ key: "logs" as const, label: "Edit Logs" }] : []),
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative -mb-px rounded-t-lg border px-4 py-2 text-sm font-semibold transition ${
                  activeTab === tab.key
                    ? estimateWorkbookTabActive
                    : estimateWorkbookTabInactive
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "parts" ? (
            <div className={estimateCatalogTabContent}>
              <div className="grid gap-3 border-b border-slate-200 p-4 lg:grid-cols-[minmax(18rem,1fr)_14rem_14rem_auto] dark:border-slate-800">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search part, description, section, or price..."
                  className={estimateInputFieldCompact}
                />
                <select
                  value={sectionFilter}
                  onChange={(event) => setSectionFilter(event.target.value)}
                  className={estimateInputFieldCompact}
                >
                  <option value="all">All sections</option>
                  {sectionOptions.map((section) => (
                    <option key={section} value={section}>
                      {section}
                    </option>
                  ))}
                </select>
                <select
                  value={subcategoryFilter}
                  onChange={(event) => setSubcategoryFilter(event.target.value)}
                  className={estimateInputFieldCompact}
                >
                  <option value="all">All subcategories</option>
                  {subcategoryOptions.map((subcategory) => (
                    <option key={subcategory} value={subcategory}>
                      {subcategory}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap items-center justify-end gap-2 text-sm font-semibold text-slate-600 dark:text-slate-400">
                  <span>{filteredRows.length.toLocaleString()} parts</span>
                  <button
                    type="button"
                    onClick={() => setAllVisibleGroupsCollapsed(!allVisibleGroupsCollapsed)}
                    className={estimateSecondaryButtonSm}
                  >
                    {allVisibleGroupsCollapsed ? "Expand All" : "Collapse All"}
                  </button>
                </div>
              </div>

              <div className="max-h-[calc(100vh-17rem)] overflow-auto">
                {isLoadingRows ? (
                  <div className="p-8 text-center text-sm text-slate-400">Loading catalog...</div>
                ) : groupedRows.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">No catalog parts match the filters.</div>
                ) : (
                  groupedRows.map((group) => {
                    const isCollapsed = Boolean(collapsedGroups[group.key]);
                    return (
                    <div key={group.key}>
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.key)}
                        className={`${estimateCatalogGroupHeader} flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-900`}
                      >
                        <span>
                          <span className={`block ${estimateCatalogGroupTitle}`}>{group.section}</span>
                          <span className="block text-xs text-slate-500">{group.subcategory}</span>
                        </span>
                        <span className="flex items-center gap-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                          {group.rows.length.toLocaleString()} parts
                          <span className="text-lg leading-none text-slate-600 dark:text-slate-300">
                            {isCollapsed ? "+" : "-"}
                          </span>
                        </span>
                      </button>
                      {isCollapsed ? null : (
                      <table
                        className={`w-full table-fixed divide-y divide-slate-200 text-sm dark:divide-slate-800 ${
                          canAddToEstimate ? "min-w-[80rem]" : "min-w-[64rem]"
                        }`}
                      >
                        <colgroup>
                          <col className={canAddToEstimate ? "w-[32%]" : "w-[42%]"} />
                          <col className={canAddToEstimate ? "w-[22%]" : "w-[30%]"} />
                          <col className={canAddToEstimate ? "w-[11%]" : "w-[16%]"} />
                          {canAddToEstimate ? (
                            <>
                              <col className="w-[9%]" />
                              <col className="w-[9%]" />
                            </>
                          ) : null}
                          {isUnlocked ? <col className="w-[17%]" /> : null}
                        </colgroup>
                        <thead className={estimateTableHead}>
                          <tr>
                            <th className="px-3 py-2">Description</th>
                            <th className="px-3 py-2">Section / Subcategory</th>
                            <th className="px-3 py-2 text-right">Unit Price</th>
                            {canAddToEstimate ? (
                              <>
                                <th className="px-3 py-2 text-right">Qty</th>
                                <th className="px-3 py-2 text-right">Add</th>
                              </>
                            ) : null}
                            {isUnlocked ? <th className="px-3 py-2 text-right">Edit</th> : null}
                          </tr>
                        </thead>
                        <tbody className={estimateTableBody}>
                          {group.rows.map((row) => {
                            const isEditing = editingRowKey === row.rowKey && editDraft;
                            const rowQuantity = addQuantities[row.rowKey] ?? 0;
                            const canAddRow =
                              isCatalogRowAddable(row) &&
                              rowQuantity > 0 &&
                              Boolean(estimateDraft) &&
                              !isLoadingEstimate &&
                              addingRowKey !== row.rowKey;
                            return (
                              <tr key={row.rowKey}>
                                <td className="px-3 py-3 align-top">
                                  {isEditing ? (
                                    <div className="grid gap-2">
                                      <input
                                        value={editDraft.label}
                                        onChange={(event) =>
                                          setEditDraft((current) =>
                                            current ? { ...current, label: event.target.value } : current,
                                          )
                                        }
                                        placeholder="Description prefix / size"
                                        className={estimateInputFieldCompactSm}
                                      />
                                      <input
                                        value={editDraft.description}
                                        onChange={(event) =>
                                          setEditDraft((current) =>
                                            current ? { ...current, description: event.target.value } : current,
                                          )
                                        }
                                        placeholder="Description"
                                        className={estimateInputFieldCompactSm}
                                      />
                                      <input
                                        value={editDraft.detail}
                                        onChange={(event) =>
                                          setEditDraft((current) =>
                                            current ? { ...current, detail: event.target.value } : current,
                                          )
                                        }
                                        placeholder="Detail / notes"
                                        className={estimateInputFieldCompactSm}
                                      />
                                    </div>
                                  ) : (
                                    <>
                                      <div className="font-semibold text-slate-900 dark:text-white">
                                        {combinedPartDescription(row) || "-"}
                                      </div>
                                      <div className="mt-1 text-[11px] font-semibold text-slate-600">
                                        Row {row.sheetRow}
                                      </div>
                                    </>
                                  )}
                                </td>
                                <td className="px-3 py-3 align-top">
                                  {isEditing ? (
                                    <div className="grid gap-2">
                                      <select
                                        value={editDraft.section}
                                        onChange={(event) =>
                                          setEditDraft((current) =>
                                            current
                                              ? {
                                                  ...current,
                                                  section: event.target.value,
                                                  subcategory: "",
                                                }
                                              : current,
                                          )
                                        }
                                        className={estimateInputFieldCompactSm}
                                      >
                                        <option value="">Select section</option>
                                        {editSectionOptions.map((section) => (
                                          <option key={section} value={section}>
                                            {section}
                                          </option>
                                        ))}
                                      </select>
                                      <select
                                        value={editDraft.subcategory}
                                        onChange={(event) =>
                                          setEditDraft((current) =>
                                            current ? { ...current, subcategory: event.target.value } : current,
                                          )
                                        }
                                        className={estimateInputFieldCompactSm}
                                      >
                                        <option value="">Select subcategory</option>
                                        {editSubcategoryOptions.map((subcategory) => (
                                          <option key={subcategory} value={subcategory}>
                                            {subcategory}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="font-semibold text-slate-900 dark:text-slate-200">{row.section || "-"}</div>
                                      <div className="mt-1 text-xs text-slate-500">{row.subcategory || "General"}</div>
                                    </>
                                  )}
                                </td>
                                <td className="min-w-0 px-3 py-3 align-top text-right">
                                  {isEditing ? (
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      disabled={Boolean(row.formulaKey)}
                                      value={editDraft.defaultUnitCost}
                                      placeholder={row.formulaKey ? "Formula price locked" : "Unit price"}
                                      onChange={(event) =>
                                        setEditDraft((current) =>
                                          current ? { ...current, defaultUnitCost: event.target.value } : current,
                                        )
                                      }
                                      title={row.formulaKey ? "Formula-priced rows keep workbook pricing locked." : undefined}
                                      className={`w-full min-w-0 max-w-full text-right tabular-nums ${estimateInputFieldCompactSm}`}
                                    />
                                  ) : (
                                    <div className="text-right font-semibold text-emerald-700 dark:text-emerald-300">
                                      {formatCurrency(row.unitCost ?? row.defaultUnitCost)}
                                    </div>
                                  )}
                                </td>
                                {canAddToEstimate ? (
                                  <td className="min-w-0 px-3 py-3 align-top">
                                    {isEditing ? (
                                      <input
                                        type="number"
                                        value={rowQuantity}
                                        disabled
                                        readOnly
                                        tabIndex={-1}
                                        aria-label="Quantity (set when adding to estimate)"
                                        title="Quantity is set when adding this part to an estimate"
                                        className={`w-full min-w-0 max-w-full cursor-not-allowed opacity-60 ${estimatePricingInput}`}
                                      />
                                    ) : isCatalogRowAddable(row) ? (
                                      <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={rowQuantity}
                                        onChange={(event) =>
                                          setAddQuantities((current) => ({
                                            ...current,
                                            [row.rowKey]: Number(event.target.value) || 0,
                                          }))
                                        }
                                        className={`w-full min-w-0 max-w-full ${estimatePricingInput}`}
                                      />
                                    ) : (
                                      <span className="block text-right text-xs text-slate-500">-</span>
                                    )}
                                  </td>
                                ) : null}
                                {canAddToEstimate ? (
                                  <td className="min-w-0 px-3 py-3 align-top text-right">
                                    {isEditing ? (
                                      <span className="block text-right text-xs text-slate-500">—</span>
                                    ) : isCatalogRowAddable(row) ? (
                                      <div className="flex flex-col items-end gap-1">
                                        <button
                                          type="button"
                                          onClick={() => void addPartToEstimate(row)}
                                          disabled={!canAddRow}
                                          className={`${estimatePrimaryButton} !text-white px-3 py-1.5 text-xs font-bold disabled:opacity-60`}
                                        >
                                          {addingRowKey === row.rowKey ? "Adding..." : "Add"}
                                        </button>
                                        {selectedEstimateRowKeys.has(row.rowKey) ? (
                                          <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                                            On sheet
                                          </span>
                                        ) : null}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-slate-500">-</span>
                                    )}
                                  </td>
                                ) : null}
                                {isUnlocked ? (
                                  <td className="min-w-0 px-3 py-3 align-top text-right">
                                    {isEditing ? (
                                      <div className="flex flex-wrap justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() => deleteRowPath(row)}
                                          disabled={isSavingRow}
                                          className="rounded-lg border border-red-400/50 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-800 hover:bg-red-100 disabled:opacity-60 dark:bg-transparent dark:text-red-100 dark:hover:bg-red-500/10"
                                        >
                                          Delete Part
                                        </button>
                                        <button
                                          type="button"
                                          onClick={cancelEdit}
                                          disabled={isSavingRow}
                                          className={`${estimateSecondaryButtonSm} disabled:opacity-60`}
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => saveRow(row)}
                                          disabled={isSavingRow}
                                          className={`${estimatePrimaryButton} px-3 py-1.5 text-xs font-bold disabled:opacity-60`}
                                        >
                                          {isSavingRow ? "Saving..." : "Save"}
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => startEdit(row)}
                                        className={estimateSecondaryButtonSm}
                                      >
                                        Edit Row
                                      </button>
                                    )}
                                  </td>
                                ) : null}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      )}
                    </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <div className={`max-h-[calc(100vh-13rem)] overflow-auto ${estimateCatalogTabContent}`}>
              <div className="flex justify-end border-b border-slate-200 p-3 dark:border-slate-800">
                <button
                  type="button"
                  onClick={loadLogs}
                  className={estimateSecondaryButton}
                >
                  Refresh Logs
                </button>
              </div>
              {isLoadingLogs ? (
                <div className="p-8 text-center text-sm text-slate-400">Loading logs...</div>
              ) : logs.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">No material catalog edits have been logged yet.</div>
              ) : (
                <table className="w-full min-w-[70rem] divide-y divide-slate-200 text-sm dark:divide-slate-800">
                  <thead className={estimateTableHead}>
                    <tr>
                      <th className="px-3 py-2">When</th>
                      <th className="px-3 py-2">User</th>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Changes</th>
                    </tr>
                  </thead>
                  <tbody className={estimateTableBody}>
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td className="px-3 py-3 align-top text-slate-700 dark:text-slate-300">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-3 align-top text-slate-700 dark:text-slate-300">{log.actorEmail || "-"}</td>
                        <td className="px-3 py-3 align-top font-mono text-slate-700 dark:text-slate-300">{log.rowKey}</td>
                        <td className="px-3 py-3 align-top">
                          <div className="grid gap-2">
                            {log.changedFields.map((field) => (
                              <div key={field} className={estimateCatalogLogDiffPanel}>
                                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{field}</div>
                                <div className="mt-1 grid gap-2 md:grid-cols-2">
                                  <div>
                                    <div className="text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-300">Before</div>
                                    <div className="break-words text-slate-700 dark:text-slate-300">{displayValue(log.beforeData[field])}</div>
                                  </div>
                                  <div>
                                    <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">After</div>
                                    <div className="break-words text-slate-900 dark:text-slate-100">{displayValue(log.afterData[field])}</div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </main>

      {canEditWorkbook && showPasswordPrompt ? (
        <div
          className={estimateModalOverlay}
          onMouseDown={() => setShowPasswordPrompt(false)}
        >
          <form
            onSubmit={unlock}
            onMouseDown={(event) => event.stopPropagation()}
            className={`w-full max-w-md p-5 ${estimateModalPanel}`}
          >
            <h2 className={estimateModalTitle}>Unlock Catalog Editing</h2>
            <p className={estimateModalDescription}>
              Enter the material catalog edit password. Access lasts until this page is closed or locked.
            </p>
            <input
              autoFocus
              type="password"
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.target.value)}
              className={`${estimateInputFieldCompact} mt-4 w-full`}
              placeholder="Password"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPasswordPrompt(false)}
                className={estimateModalCancelBtn}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={estimatePrimaryButton}
              >
                Unlock
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
