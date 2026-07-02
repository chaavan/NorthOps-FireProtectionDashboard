"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PartSearchCombobox, {
  type PartSearchOption,
} from "@/components/PartSearchCombobox";
import WarningConfirmModal from "@/components/WarningConfirmModal";
import { formatVendorDisplay, normalizeVendorKey } from "@/lib/vendorUtils";
import {
  getOpenPreorderPendingForPart,
  hasOpenPreorderForPart,
  hydratePartFromCatalog,
} from "@/lib/jobPreorderTabUtils";
import type { JobPreorderLineDto } from "@/lib/jobPreorderLines";

export type PreorderAddPayload = {
  partNumber: string;
  quantity: number;
  vendor: string;
  description: string | null;
  uom: string;
};

type JobPreorderAddModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: PreorderAddPayload) => Promise<void>;
  existingLines: JobPreorderLineDto[];
  vendors: string[];
  jobNumber?: string | null;
  saving?: boolean;
};

export default function JobPreorderAddModal({
  isOpen,
  onClose,
  onSubmit,
  existingLines,
  vendors,
  jobNumber,
  saving = false,
}: JobPreorderAddModalProps) {
  const [partQuery, setPartQuery] = useState("");
  const [quantity, setQuantity] = useState("");
  const [description, setDescription] = useState("");
  const [uom, setUom] = useState("");
  const [vendorChoice, setVendorChoice] = useState("");
  const [catalogLookupBusy, setCatalogLookupBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    partNumber: string;
    pending: number;
  } | null>(null);
  const pendingSubmitRef = useRef<PreorderAddPayload | null>(null);

  const resetForm = useCallback(() => {
    setPartQuery("");
    setQuantity("");
    setDescription("");
    setUom("");
    setVendorChoice("");
    setError(null);
    setDuplicateWarning(null);
    pendingSubmitRef.current = null;
  }, []);

  useEffect(() => {
    if (!isOpen) resetForm();
  }, [isOpen, resetForm]);

  const executeSubmit = async (payload: PreorderAddPayload) => {
    await onSubmit(payload);
    resetForm();
    onClose();
  };

  const applyVendor = (rawVendor: string | null | undefined) => {
    const raw = (rawVendor ?? "").trim();
    if (!raw) return;
    const key = normalizeVendorKey(raw);
    if (key && vendors.includes(key)) {
      setVendorChoice(key);
    } else if (key) {
      setVendorChoice(key);
    }
  };

  const hydrateFromPartNumber = async (rawPn: string) => {
    const trimmed = rawPn.trim();
    if (!trimmed) return;
    setCatalogLookupBusy(true);
    try {
      const catalog = await hydratePartFromCatalog(trimmed);
      if (catalog?.description) setDescription(catalog.description);
      if (catalog?.unitOfMeasurement) setUom(catalog.unitOfMeasurement);
      if (catalog?.vendor) applyVendor(catalog.vendor);
    } finally {
      setCatalogLookupBusy(false);
    }
  };

  const onPartPick = (part: PartSearchOption) => {
    setPartQuery(part.pn);
    const desc = (part.nomenclature || "").trim();
    const u = (part.units || "").trim();
    const v = (part.vendor || "").trim();
    if (desc) setDescription(desc);
    if (u) setUom(u);
    if (v) applyVendor(v);
    void hydrateFromPartNumber(part.pn);
  };

  const resolveVendorForSave = (): string | null => {
    if (!vendorChoice) return null;
    return normalizeVendorKey(vendorChoice) || null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const pn = partQuery.trim();
    if (!pn) {
      setError("Part number is required");
      return;
    }

    const qty = Math.floor(Number(quantity));
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Quantity must be a positive number");
      return;
    }

    const catalog = await hydratePartFromCatalog(pn);
    const uomForSave =
      (catalog?.unitOfMeasurement?.trim() || uom.trim() || null) ?? null;
    if (!uomForSave) {
      setError("UOM is required. Add UOM on the part record or enter it.");
      return;
    }

    const vendorForSave = resolveVendorForSave();
    if (!vendorForSave) {
      setError("Vendor is required");
      return;
    }

    const descriptionForSave =
      (catalog?.description?.trim() || description.trim() || null) ?? null;

    const payload: PreorderAddPayload = {
      partNumber: pn,
      quantity: qty,
      vendor: vendorForSave,
      description: descriptionForSave,
      uom: uomForSave,
    };

    if (hasOpenPreorderForPart(existingLines, pn)) {
      const pending = getOpenPreorderPendingForPart(existingLines, pn);
      pendingSubmitRef.current = payload;
      setDuplicateWarning({ partNumber: pn, pending });
      return;
    }

    try {
      await executeSubmit(payload);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDuplicateConfirm = async () => {
    const payload = pendingSubmitRef.current;
    if (!payload) {
      setDuplicateWarning(null);
      return;
    }
    setError(null);
    try {
      await executeSubmit(payload);
    } catch (err) {
      setError((err as Error).message);
      setDuplicateWarning(null);
    }
  };

  if (!isOpen) return null;

  const showVendorPicker = !normalizeVendorKey(vendorChoice);

  return (
    <>
      <WarningConfirmModal
        isOpen={duplicateWarning !== null}
        title="Add another order?"
        message="This part already has orders on this job. Each placement creates a separate line in your order history."
        detail={
          duplicateWarning
            ? `${duplicateWarning.partNumber} · ${duplicateWarning.pending} pending`
            : undefined
        }
        confirmLabel="Place new order"
        cancelLabel="Cancel"
        onConfirm={() => void handleDuplicateConfirm()}
        onCancel={() => {
          setDuplicateWarning(null);
          pendingSubmitRef.current = null;
        }}
        confirming={saving}
      />

    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-slate-700/50 dark:bg-slate-800">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 p-5 dark:border-slate-700/50">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Add pre-order
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-slate-500 transition hover:text-slate-900 dark:hover:text-white"
            aria-label="Close"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex-1 space-y-4 overflow-y-auto p-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-400">
              {error}
            </div>
          )}

          <p className="text-sm text-slate-600 dark:text-slate-400">
            Order parts for this job before or after they appear on lists.
          </p>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
              Part number <span className="text-red-500">*</span>
            </label>
            <PartSearchCombobox
              value={partQuery}
              onChange={setPartQuery}
              onPartSelect={onPartPick}
              onBlur={() => void hydrateFromPartNumber(partQuery)}
              disabled={saving}
              dropdownTrigger="input"
              showLoadingIndicator={catalogLookupBusy}
              placeholder="Search by part number or description..."
              permissionContext={{ jobNumber }}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
              Quantity <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              disabled={saving}
              placeholder="Enter quantity"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700/50 dark:text-white"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
              Vendor <span className="text-red-500">*</span>
            </label>
            {showVendorPicker ? (
              <select
                value={vendorChoice}
                onChange={(e) => setVendorChoice(e.target.value)}
                disabled={saving}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700/50 dark:text-white"
              >
                <option value="">Select vendor</option>
                {vendors.map((v) => (
                  <option key={v} value={v}>
                    {formatVendorDisplay(v)}
                  </option>
                ))}
              </select>
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-200">
                {formatVendorDisplay(vendorChoice)}
              </p>
            )}
          </div>

          {(description || uom) && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-400">
              {description && <p>{description}</p>}
              {uom && <p className="mt-1">UOM: {uom}</p>}
            </div>
          )}

          <div className="flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-700/50">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-600 px-4 py-2 text-sm font-bold text-white shadow-sm disabled:opacity-50"
            >
              {saving ? "Saving..." : "Place order"}
            </button>
          </div>
        </form>
      </div>
    </div>
    </>
  );
}
