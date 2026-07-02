"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import JobPreorderOrderTab from "@/components/JobPreorderOrderTab";
import JobPreorderReceivingTab from "@/components/JobPreorderReceivingTab";
import type { PreorderAddPayload } from "@/components/JobPreorderAddModal";
import { normalizeVendorKey } from "@/lib/vendorUtils";
import { toDateKeyInAppTimeZone } from "@/lib/timezone";
import { jobPreorderPartKey } from "@/lib/jobPartKey";
import type { JobPreorderLineDto } from "@/lib/jobPreorderLines";
import {
  buildJobPartsCatalog,
  type JobPartCatalogEntry,
} from "@/lib/jobPreorderTabUtils";
import type { JobLineItem } from "@/lib/types";

export type { JobPreorderLineDto };

type JobPreorderTabProps = {
  jobNumber: string;
  jobLineItems: JobLineItem[];
  onInventoryChanged?: () => void;
  canEdit?: boolean;
};

type ActiveSubTab = "order" | "receiving";

const TAB_COPY: Record<ActiveSubTab, string> = {
  order: "Order parts for this job before or after they appear on lists.",
  receiving:
    "Receive deliveries into the job pool. Pull from Overview when parts are on a list.",
};

export default function JobPreorderTab({
  jobNumber,
  jobLineItems,
  onInventoryChanged,
  canEdit = false,
}: JobPreorderTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<ActiveSubTab>("order");
  const [lines, setLines] = useState<JobPreorderLineDto[]>([]);
  const [poolAvailableByPart, setPoolAvailableByPart] = useState<
    Record<string, number>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [vendors, setVendors] = useState<string[]>([]);

  useEffect(() => {
    const loadVendors = async () => {
      try {
        const res = await fetch("/api/parts/vendors");
        if (res.ok) {
          const data = await res.json();
          setVendors(data.vendors || []);
        }
      } catch {
        /* ignore */
      }
    };
    void loadVendors();
  }, []);

  const loadLines = useCallback(async () => {
    if (!jobNumber) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobNumber)}/job-preorders`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load pre-orders");
      }
      const data = await res.json();
      setLines(data.lines || []);
      setPoolAvailableByPart(data.poolAvailableByPart || {});
    } catch (e) {
      setError((e as Error).message);
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [jobNumber]);

  useEffect(() => {
    void loadLines();
  }, [loadLines]);

  const jobPartsCatalog = useMemo(
    () => buildJobPartsCatalog(jobLineItems),
    [jobLineItems],
  );

  const catalogByPart = useMemo(() => {
    const map = new Map<string, JobPartCatalogEntry>();
    for (const part of jobPartsCatalog) {
      map.set(jobPreorderPartKey(part.partNumber), part);
    }
    return map;
  }, [jobPartsCatalog]);

  const notifyChanged = () => {
    onInventoryChanged?.();
    void loadLines();
  };

  const handleAddPreorder = async (payload: PreorderAddPayload) => {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    try {
      const vendorForSave = normalizeVendorKey(payload.vendor);
      if (!vendorForSave) {
        throw new Error("Vendor is required");
      }

      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobNumber)}/job-preorders`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            partNumber: payload.partNumber,
            description: payload.description,
            uom: payload.uom,
            quantity: payload.quantity,
            vendor: vendorForSave,
            notes: null,
            orderedAt: toDateKeyInAppTimeZone(new Date()),
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to add pre-order");
      notifyChanged();
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleReceive = async (lineId: string, quantity: number) => {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobNumber)}/job-preorders/${encodeURIComponent(lineId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ receiveQuantity: quantity }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to receive");
      notifyChanged();
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleUnreceive = async (lineId: string, quantity: number) => {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobNumber)}/job-preorders/${encodeURIComponent(lineId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unreceiveQuantity: quantity }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to undo receive");
      notifyChanged();
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (lineId: string) => {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobNumber)}/job-preorders/${encodeURIComponent(lineId)}`,
        {
          method: "DELETE",
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      notifyChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      {error && (
        <div className="shrink-0 rounded-lg bg-red-600/90 px-4 py-3 text-sm font-medium text-white">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-800/50">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 dark:border-slate-700/60">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Job pre-orders
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {TAB_COPY[activeSubTab]}
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-900/50">
            <button
              type="button"
              onClick={() => setActiveSubTab("order")}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                activeSubTab === "order"
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              Place orders
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab("receiving")}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                activeSubTab === "receiving"
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              Incoming stock
            </button>
          </div>
        </div>

        {activeSubTab === "order" ? (
          <JobPreorderOrderTab
            jobNumber={jobNumber}
            canEdit={canEdit}
            loading={loading}
            saving={saving}
            lines={lines}
            vendors={vendors}
            onAddPreorder={handleAddPreorder}
          />
        ) : (
          <JobPreorderReceivingTab
            canEdit={canEdit}
            loading={loading}
            saving={saving}
            lines={lines}
            jobLineItems={jobLineItems}
            poolAvailableByPart={poolAvailableByPart}
            catalogByPart={catalogByPart}
            onReceive={handleReceive}
            onUnreceive={handleUnreceive}
            onDelete={handleDelete}
          />
        )}
      </div>
    </div>
  );
}
