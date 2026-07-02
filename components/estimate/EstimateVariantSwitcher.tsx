"use client";

import { useMemo, useState } from "react";
import type { EstimateVariantSummary } from "@/lib/estimateTypes";

type Props = {
  variants: EstimateVariantSummary[];
  activeVariantKey: string;
  onSelect: (variantKey: string) => void;
  onCreate: (params: {
    variantKey: string;
    variantLabel: string;
    copyFromVariantKey: string | null;
  }) => Promise<void> | void;
  onRename: (variantKey: string, label: string) => Promise<void> | void;
  onDelete: (variantKey: string) => Promise<void> | void;
  canManage?: boolean;
  isBusy?: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

type ModalMode = "create" | "rename" | "delete" | null;

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function variantDisplayLabel(variant: EstimateVariantSummary) {
  return variant.variantLabel || variant.variantKey;
}

function defaultVariantKey(variants: EstimateVariantSummary[]) {
  const existing = new Set(variants.map((variant) => variant.variantKey));
  for (let i = 1; i < 30; i += 1) {
    const candidate = `alt-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `alt-${Date.now()}`;
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 0 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.69 0 1.25.56 1.25 1.25v.25a3.736 3.736 0 0 0-2.5 0v-.25C8.75 4.56 9.31 4 10 4ZM8.5 8.25a.75.75 0 0 0-1.5 0v6.5a.75.75 0 0 0 1.5 0v-6.5Zm2.25 0a.75.75 0 0 0-1.5 0v6.5a.75.75 0 0 0 1.5 0v-6.5Zm2.25 0a.75.75 0 0 0-1.5 0v6.5a.75.75 0 0 0 1.5 0v-6.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function EstimateVariantSwitcher({
  variants,
  activeVariantKey,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  canManage = false,
  isBusy,
  isOpen,
  onOpenChange,
}: Props) {
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [sheetLabel, setSheetLabel] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteTargetKey, setDeleteTargetKey] = useState<string | null>(null);

  const visibleVariants = variants.filter((variant) => variant.variantStatus !== "archived");
  const isOnlySheet = visibleVariants.length === 1;
  const activeVariant = useMemo(
    () =>
      visibleVariants.find((variant) => variant.variantKey === activeVariantKey) ??
      visibleVariants[0] ??
      null,
    [activeVariantKey, visibleVariants],
  );
  const deleteTarget = useMemo(
    () =>
      visibleVariants.find((variant) => variant.variantKey === deleteTargetKey) ?? null,
    [deleteTargetKey, visibleVariants],
  );
  const activeLabel = activeVariant ? variantDisplayLabel(activeVariant) : "Sheet";
  const deleteTargetLabel = deleteTarget ? variantDisplayLabel(deleteTarget) : activeLabel;

  const closeModal = () => {
    setModalMode(null);
    setSheetLabel("");
    setCopyFrom("");
    setDeleteConfirm("");
    setDeleteTargetKey(null);
  };

  const openCreate = () => {
    onOpenChange(false);
    setSheetLabel("");
    setCopyFrom(activeVariant?.variantKey || "");
    setModalMode("create");
  };

  const openRename = () => {
    if (!activeVariant) return;
    onOpenChange(false);
    setSheetLabel(activeLabel);
    setModalMode("rename");
  };

  const openDelete = (variantKey: string) => {
    onOpenChange(false);
    setDeleteTargetKey(variantKey);
    setDeleteConfirm("");
    setModalMode("delete");
  };

  const handleCreate = async () => {
    const key = defaultVariantKey(variants);
    const label = sheetLabel.trim() || `Sheet ${visibleVariants.length + 1}`;
    await onCreate({
      variantKey: key,
      variantLabel: label,
      copyFromVariantKey: copyFrom || null,
    });
    closeModal();
  };

  const handleRename = async () => {
    if (!activeVariant) return;
    await onRename(activeVariant.variantKey, sheetLabel.trim() || activeLabel);
    closeModal();
  };

  const handleDelete = async () => {
    if (!deleteTargetKey) return;
    await onDelete(deleteTargetKey);
    closeModal();
  };

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => onOpenChange(!isOpen)}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          className="flex h-11 min-w-44 items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-4 text-left text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <span className="min-w-0 truncate">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Sheet
            </span>
            <span className="block truncate">{activeLabel}</span>
          </span>
          <svg
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {isOpen ? (
          <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-700">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Estimation sheets
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {visibleVariants.length} sheet{visibleVariants.length === 1 ? "" : "s"} in this
                project
              </p>
            </div>
            <div className="max-h-72 overflow-y-auto py-1" role="listbox">
              {visibleVariants.map((variant) => {
                const isActive = variant.variantKey === activeVariantKey;
                const label = variantDisplayLabel(variant);
                return (
                  <div
                    key={variant.variantKey}
                    className={`flex items-stretch ${
                      isActive ? "bg-blue-50 dark:bg-blue-600/15" : ""
                    }`}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        onOpenChange(false);
                        onSelect(variant.variantKey);
                      }}
                      className={`min-w-0 flex-1 px-3 py-2.5 text-left transition ${
                        isActive
                          ? "text-slate-900 dark:text-white"
                          : "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                      }`}
                    >
                      <span className="block truncate text-sm font-semibold">{label}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {formatCurrency(variant.totalCost)} · updated{" "}
                        {new Date(variant.updatedAt).toLocaleDateString()}
                      </span>
                    </button>
                    {canManage ? (
                    <button
                      type="button"
                      title={`Delete ${label}`}
                      aria-label={`Delete sheet ${label}`}
                      disabled={isBusy}
                      onClick={() => openDelete(variant.variantKey)}
                      className="flex w-11 shrink-0 items-center justify-center text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {canManage ? (
            <div className="border-t border-slate-200 p-2 dark:border-slate-700">
              <button
                type="button"
                onClick={openCreate}
                className="flex w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-blue-600 transition hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-500/10"
              >
                New sheet
              </button>
              <button
                type="button"
                onClick={openRename}
                disabled={!activeVariant}
                className="flex w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Rename current sheet
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!activeVariant) return;
                  openDelete(activeVariant.variantKey);
                }}
                disabled={!activeVariant || isBusy}
                className="flex w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-500/10"
              >
                Delete current sheet
              </button>
            </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {modalMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm dark:bg-slate-950/60">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            {modalMode === "create" ? (
              <>
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">New sheet</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Create another estimation sheet for this project.
                  </p>
                </div>
                <div className="mt-5 grid gap-4">
                  <label className="grid gap-1 text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Sheet name
                    <input
                      autoFocus
                      value={sheetLabel}
                      onChange={(event) => setSheetLabel(event.target.value)}
                      placeholder="Alternate sheet"
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Copy from
                    <select
                      value={copyFrom}
                      onChange={(event) => setCopyFrom(event.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="">Blank template</option>
                      {visibleVariants.map((variant) => (
                        <option key={variant.variantKey} value={variant.variantKey}>
                          {variantDisplayLabel(variant)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreate()}
                    disabled={isBusy}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    Create sheet
                  </button>
                </div>
              </>
            ) : null}

            {modalMode === "rename" ? (
              <>
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">Rename sheet</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Update the label shown in the sheet selector.
                  </p>
                </div>
                <label className="mt-5 grid gap-1 text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Sheet name
                  <input
                    autoFocus
                    value={sheetLabel}
                    onChange={(event) => setSheetLabel(event.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  />
                </label>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRename()}
                    disabled={isBusy}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              </>
            ) : null}

            {modalMode === "delete" ? (
              <>
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">Delete sheet</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {isOnlySheet ? (
                      <>
                        This is the only sheet in this estimate. Deleting{" "}
                        <strong className="text-slate-800 dark:text-slate-200">
                          {deleteTargetLabel}
                        </strong>{" "}
                        permanently removes the entire estimate and all of its data. This cannot be
                        undone.
                      </>
                    ) : (
                      <>
                        This permanently deletes{" "}
                        <strong className="text-slate-800 dark:text-slate-200">
                          {deleteTargetLabel}
                        </strong>{" "}
                        and all line items on that sheet. This cannot be undone.
                      </>
                    )}
                  </p>
                  {deleteTargetKey === activeVariantKey ? (
                    <p className="mt-2 text-sm text-amber-700 dark:text-amber-200">
                      You are deleting the sheet you are viewing. You will switch to another sheet
                      after deletion.
                    </p>
                  ) : null}
                </div>
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
                    onClick={closeModal}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    disabled={isBusy || deleteConfirm !== "DELETE"}
                    className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-400/60 dark:bg-red-500/10 dark:text-red-100 dark:hover:bg-red-500/20"
                  >
                    Delete sheet
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
