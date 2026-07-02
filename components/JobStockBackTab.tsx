"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { downloadStockBackPdf } from "@/lib/stockBackPdfClient";
import type { StockBackPdfDocument } from "@/lib/stockBackPdfShared";
import { formatDateInAppTimeZone } from "@/lib/timezone";

type StockBackPart = {
  partId: string | null;
  partNumber: string;
  description: string | null;
  shopQuantity: number;
  vendorQuantity: number;
  sentQuantity: number;
  alreadyReturnedQuantity: number;
  remainingReturnableQuantity: number;
  currentInventoryQuantity: number | null;
  returnable: boolean;
};

type StockBackHistoryLine = {
  id: string;
  partId: string;
  partNumber: string;
  returnedQuantity: number;
  sentShopQuantity: number;
  sentVendorQuantity: number;
};

type StockBackHistoryEntry = {
  id: string;
  jobNumber: string;
  note: string | null;
  status: "ACTIVE" | "REVERSED" | "DELETED";
  createdAt: string;
  reversedAt: string | null;
  reverseReason: string | null;
  deletedAt: string | null;
  deleteReason: string | null;
  actor: { name: string | null; email: string } | null;
  reversedBy: { name: string | null; email: string } | null;
  deletedBy: { name: string | null; email: string } | null;
  lines: StockBackHistoryLine[];
  hasPdfDocument: boolean;
  pdfVoided: boolean;
  pdfGrandTotal: number | null;
};

type StockBackPrefill = {
  inputs: Record<string, string>;
  note: string;
};

type StockBackSummary = {
  jobNumber: string;
  parts: StockBackPart[];
  history: StockBackHistoryEntry[];
};

type Props = {
  jobNumber: string;
  canCreateStockIn?: boolean;
  canUndoStockIn?: boolean;
  onInventoryChanged?: () => void;
};

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toLocaleString();
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `$${value.toFixed(2)}`;
}

function formatActor(actor: { name: string | null; email: string } | null) {
  return actor?.name?.trim() || actor?.email || "Unknown user";
}

function historyStatusLabel(status: StockBackHistoryEntry["status"]) {
  if (status === "REVERSED") return "Reversed";
  if (status === "DELETED") return "Deleted";
  return null;
}

function clampReturnValue(raw: string, max: number) {
  if (raw.trim() === "") return "";
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return String(Math.min(Math.floor(numeric), max));
}

/** Shared column widths for split header/body stock-back tables (must match exactly). */
const stockBackColGroup = (
  <colgroup>
    <col style={{ width: "12%" }} />
    <col style={{ width: "30%" }} />
    <col style={{ width: "9%" }} />
    <col style={{ width: "9%" }} />
    <col style={{ width: "9%" }} />
    <col style={{ width: "20%" }} />
    <col style={{ width: "11%" }} />
  </colgroup>
);

const stockBackHeaderCellClass =
  "px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";

export default function JobStockBackTab({
  jobNumber,
  canCreateStockIn = false,
  canUndoStockIn = false,
  onInventoryChanged,
}: Props) {
  const [activeSubTab, setActiveSubTab] = useState<"return" | "history">("return");
  const [summary, setSummary] = useState<StockBackSummary | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloadingReturnId, setDownloadingReturnId] = useState<string | null>(
    null,
  );
  const [undoingReturnId, setUndoingReturnId] = useState<string | null>(null);
  const [undoModalReturnId, setUndoModalReturnId] = useState<string | null>(null);
  const [undoReason, setUndoReason] = useState("");
  const [showStockInConfirmModal, setShowStockInConfirmModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadSummary = useCallback(
    async (prefill?: StockBackPrefill) => {
    if (!jobNumber) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/jobs/${encodeURIComponent(jobNumber)}/stock-back-summary`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load stock-back summary");
      }
      setSummary(payload);
      setInputs((current) => {
        const next: Record<string, string> = {};
        for (const part of payload.parts ?? []) {
          const prefillValue = prefill?.inputs[part.partNumber];
          const source =
            prefillValue !== undefined ? prefillValue : (current[part.partNumber] ?? "");
          next[part.partNumber] = clampReturnValue(
            source,
            part.remainingReturnableQuantity,
          );
        }
        return next;
      });
      if (prefill) {
        setNote(prefill.note);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  },
    [jobNumber],
  );

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const returnLines = useMemo(() => {
    if (!summary) return [];
    return summary.parts
      .map((part) => ({
        part,
        quantity: Number(inputs[part.partNumber] || 0),
      }))
      .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0);
  }, [inputs, summary]);

  const totalReturnQuantity = returnLines.reduce(
    (sum, line) => sum + line.quantity,
    0,
  );

  const fillAll = () => {
    if (!summary) return;
    const next: Record<string, string> = {};
    for (const part of summary.parts) {
      next[part.partNumber] =
        part.returnable && part.remainingReturnableQuantity > 0
          ? String(part.remainingReturnableQuantity)
          : "";
    }
    setInputs(next);
    setSuccess("Review the returned quantities, then submit Stock Back.");
  };

  const handleDownloadPdf = async (returnId: string) => {
    if (!jobNumber || downloadingReturnId) return;
    setDownloadingReturnId(returnId);
    setError(null);
    try {
      const response = await fetch(
        `/api/jobs/${encodeURIComponent(jobNumber)}/stock-back/${encodeURIComponent(returnId)}/document`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load stock-back document");
      }
      await downloadStockBackPdf(payload.document as StockBackPdfDocument);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloadingReturnId(null);
    }
  };

  const openUndoModal = (entry: StockBackHistoryEntry) => {
    setUndoModalReturnId(entry.id);
    setUndoReason("");
    setError(null);
  };

  const buildPrefillFromEntry = (entry: StockBackHistoryEntry): StockBackPrefill => {
    const inputs: Record<string, string> = {};
    for (const line of entry.lines) {
      if (line.returnedQuantity > 0) {
        inputs[line.partNumber] = String(line.returnedQuantity);
      }
    }
    return {
      inputs,
      note: entry.note ?? "",
    };
  };

  const handleUndo = async () => {
    if (!jobNumber || !undoModalReturnId || undoingReturnId || !canUndoStockIn) {
      return;
    }
    const trimmedReason = undoReason.trim();
    if (trimmedReason.length < 10) {
      setError("Enter at least 10 characters explaining why this stock-in is being undone.");
      return;
    }

    const entry = summary?.history.find((item) => item.id === undoModalReturnId);
    const prefill = entry ? buildPrefillFromEntry(entry) : undefined;

    setUndoingReturnId(undoModalReturnId);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(
        `/api/jobs/${encodeURIComponent(jobNumber)}/stock-back/${encodeURIComponent(undoModalReturnId)}/undo`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ undoReason: trimmedReason }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to undo stock-in");
      }
      setUndoModalReturnId(null);
      setUndoReason("");
      setSuccess("Stock-in reversed. Adjust quantities on Return Parts and submit again.");
      await loadSummary(prefill);
      onInventoryChanged?.();
      setActiveSubTab("return");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUndoingReturnId(null);
    }
  };

  const isReturningAllEligibleParts = () => {
    if (!summary) return false;
    const eligible = summary.parts.filter(
      (part) => part.returnable && part.remainingReturnableQuantity > 0,
    );
    if (eligible.length === 0) return false;
    return eligible.every(
      (part) =>
        Number(inputs[part.partNumber] || 0) === part.remainingReturnableQuantity,
    );
  };

  const performStockIn = async () => {
    if (!summary || returnLines.length === 0 || saving) return;

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(
        `/api/jobs/${encodeURIComponent(jobNumber)}/stock-back`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            note,
            lines: returnLines.map(({ part, quantity }) => ({
              partId: part.partId,
              partNumber: part.partNumber,
              quantity,
            })),
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to stock parts back in");
      }
      setShowStockInConfirmModal(false);
      setInputs({});
      setNote("");
      setSuccess(`Stocked back ${formatNumber(totalReturnQuantity)} part(s).`);
      if (payload.pdfDocument) {
        try {
          await downloadStockBackPdf(payload.pdfDocument as StockBackPdfDocument);
        } catch (pdfError) {
          setError((pdfError as Error).message);
        }
      }
      await loadSummary();
      onInventoryChanged?.();
      setActiveSubTab("history");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    if (!summary || returnLines.length === 0 || saving) return;
    if (isReturningAllEligibleParts()) {
      setShowStockInConfirmModal(true);
      return;
    }
    void performStockIn();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700/50 dark:bg-slate-800/60">
      <div className="sticky top-0 z-20 flex-shrink-0 border-b border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/95">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4 pb-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              Stock In
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Return unused job material to inventory across all lists for this job number.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={() => setActiveSubTab("return")}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                  activeSubTab === "return"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                Return Parts
              </button>
              <button
                type="button"
                onClick={() => setActiveSubTab("history")}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                  activeSubTab === "history"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                Return History
              </button>
            </div>
            {activeSubTab === "return" ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={fillAll}
                  disabled={
                    !canCreateStockIn ||
                    saving ||
                    !summary?.parts.some((part) => part.returnable)
                  }
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Stock In All
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={
                    !canCreateStockIn || saving || returnLines.length === 0
                  }
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving
                    ? "Stocking In..."
                    : `Stock In ${formatNumber(totalReturnQuantity)}`}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {activeSubTab === "return" ? (
          <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-700/50">
            <label className="grid gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Note
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                disabled={!canCreateStockIn}
                placeholder="Optional batch note"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-blue-500 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:focus:border-blue-400 dark:disabled:bg-slate-800/60"
              />
            </label>
          </div>
        ) : null}

        {error ? (
          <div className="mx-4 mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="mx-4 mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
            {success}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Loading stock-back data...
          </div>
        ) : activeSubTab === "return" ? (
          <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-3">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700/60">
              <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50 shadow-[0_1px_0_0_rgba(148,163,184,0.35)] dark:border-slate-700/60 dark:bg-slate-900/95 dark:shadow-[0_1px_0_0_rgba(51,65,85,0.8)]">
                <table className="w-full table-fixed text-sm">
                  {stockBackColGroup}
                  <thead>
                    <tr>
                      <th className={`${stockBackHeaderCellClass} text-left`}>
                        Part
                      </th>
                      <th className={`${stockBackHeaderCellClass} text-left`}>
                        Description
                      </th>
                      <th className={`${stockBackHeaderCellClass} text-right`}>
                        Shop
                      </th>
                      <th className={`${stockBackHeaderCellClass} text-right`}>
                        Vendor
                      </th>
                      <th className={`${stockBackHeaderCellClass} text-right`}>
                        Total
                      </th>
                      <th className={`${stockBackHeaderCellClass} text-right`}>
                        Returned
                      </th>
                      <th className={`${stockBackHeaderCellClass} text-right`}>
                        Inventory
                      </th>
                    </tr>
                  </thead>
                </table>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
                <table className="w-full table-fixed text-sm">
                  {stockBackColGroup}
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700/60">
                    {summary?.parts.length ? (
                      summary.parts.map((part) => {
                        const disabled =
                          !canCreateStockIn ||
                          !part.returnable ||
                          part.remainingReturnableQuantity <= 0;
                        return (
                          <tr key={part.partNumber}>
                            <td className="px-3 py-3 font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                              {part.partNumber}
                              {!part.partId ? (
                                <div className="mt-1 font-sans text-[11px] text-red-600 dark:text-red-300">
                                  Not in inventory
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                              {part.description || "-"}
                            </td>
                            <td className="px-3 py-3 text-right font-semibold">
                              {formatNumber(part.shopQuantity)}
                            </td>
                            <td className="px-3 py-3 text-right font-semibold">
                              {formatNumber(part.vendorQuantity)}
                            </td>
                            <td className="px-3 py-3 text-right font-bold text-slate-900 dark:text-white">
                              {formatNumber(part.sentQuantity)}
                            </td>
                            <td className="px-3 py-3 text-right">
                              <div className="flex justify-end">
                                <input
                                  type="number"
                                  min="0"
                                  max={part.remainingReturnableQuantity}
                                  step="1"
                                  disabled={disabled}
                                  value={inputs[part.partNumber] ?? ""}
                                  onChange={(event) =>
                                    setInputs((current) => ({
                                      ...current,
                                      [part.partNumber]: clampReturnValue(
                                        event.target.value,
                                        part.remainingReturnableQuantity,
                                      ),
                                    }))
                                  }
                                  className="h-10 w-28 rounded-lg border border-slate-300 bg-white px-2 text-right text-sm font-semibold text-slate-900 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:focus:border-blue-400 dark:disabled:bg-slate-800/60"
                                  title={`Already returned ${part.alreadyReturnedQuantity}; remaining eligible ${part.remainingReturnableQuantity}`}
                                />
                              </div>
                              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {formatNumber(part.alreadyReturnedQuantity)} back,
                                {" "}
                                {formatNumber(part.remainingReturnableQuantity)} left
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right font-semibold text-slate-700 dark:text-slate-200">
                              {part.currentInventoryQuantity === null
                                ? "-"
                                : formatNumber(part.currentInventoryQuantity)}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-3 py-8 text-center text-slate-500"
                        >
                          No sent-out parts found for this job.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
            {summary?.history.length ? (
              summary.history.map((entry) => {
                const statusLabel = historyStatusLabel(entry.status);
                const isActive = entry.status === "ACTIVE";
                const voidedAt = entry.deletedAt ?? entry.reversedAt;
                const voidedBy = entry.deletedBy ?? entry.reversedBy;
                return (
                <div
                  key={entry.id}
                  className={`rounded-xl border p-4 ${
                    entry.status === "DELETED"
                      ? "border-red-200 bg-red-50/70 dark:border-red-500/30 dark:bg-red-950/20"
                      : entry.status === "REVERSED"
                        ? "border-amber-200 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-950/20"
                        : "border-slate-200 bg-slate-50 dark:border-slate-700/60 dark:bg-slate-900/40"
                  }`}
                >
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {formatDateInAppTimeZone(entry.createdAt, {
                            year: "numeric",
                            month: "numeric",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </div>
                        {statusLabel ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                              entry.status === "DELETED"
                                ? "bg-red-600 text-white"
                                : "bg-amber-500 text-white"
                            }`}
                          >
                            {statusLabel}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {formatActor(entry.actor)}
                      </div>
                      {voidedAt ? (
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {statusLabel} by {formatActor(voidedBy)} on{" "}
                          {formatDateInAppTimeZone(voidedAt, {
                            year: "numeric",
                            month: "numeric",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div
                        className={`text-sm font-semibold ${
                          isActive
                            ? "text-emerald-700 dark:text-emerald-300"
                            : "text-slate-600 line-through dark:text-slate-400"
                        }`}
                      >
                        {formatNumber(
                          entry.lines.reduce(
                            (sum, line) => sum + line.returnedQuantity,
                            0,
                          ),
                        )}{" "}
                        returned
                      </div>
                      {entry.pdfGrandTotal !== null ? (
                        <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          Return value: {formatCurrency(entry.pdfGrandTotal)}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap justify-end gap-2">
                        {isActive && canUndoStockIn ? (
                          <button
                            type="button"
                            onClick={() => openUndoModal(entry)}
                            disabled={undoingReturnId === entry.id}
                            className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-500/50 dark:text-amber-200 dark:hover:bg-amber-950/40"
                          >
                            {undoingReturnId === entry.id ? "Undoing..." : "Undo"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void handleDownloadPdf(entry.id)}
                          disabled={downloadingReturnId === entry.id}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800/60"
                        >
                          {downloadingReturnId === entry.id
                            ? "Preparing PDF..."
                            : entry.pdfVoided
                              ? "Download voided PDF"
                              : entry.hasPdfDocument
                                ? "Download Saved PDF"
                                : "Download PDF"}
                        </button>
                      </div>
                    </div>
                  </div>
                  {entry.note ? (
                    <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">
                      {entry.note}
                    </p>
                  ) : null}
                  {entry.reverseReason ? (
                    <p className="mt-3 text-sm text-amber-800 dark:text-amber-200">
                      Undo reason: {entry.reverseReason}
                    </p>
                  ) : null}
                  {entry.deleteReason ? (
                    <p className="mt-3 text-sm text-red-700 dark:text-red-300">
                      Delete reason: {entry.deleteReason}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {entry.lines.map((line) => (
                      <span
                        key={line.id}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-200"
                      >
                        {line.partNumber}: {formatNumber(line.returnedQuantity)}
                      </span>
                    ))}
                  </div>
                </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                No stock-back history for this job yet.
              </div>
            )}
          </div>
        )}
      </div>

      {showStockInConfirmModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-500/20">
                <svg
                  className="h-6 w-6 text-blue-600 dark:text-blue-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Stock in all remaining parts?
                </h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  You are returning every remaining eligible part for this job. Review the
                  quantities below before continuing.
                </p>
                <div className="mt-4 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/40">
                  <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
                    {returnLines.map(({ part, quantity }) => (
                      <li
                        key={part.partNumber}
                        className="flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <span className="font-mono text-xs font-semibold">
                            {part.partNumber}
                          </span>
                          {part.description ? (
                            <span className="mt-0.5 block truncate text-slate-500 dark:text-slate-400">
                              {part.description}
                            </span>
                          ) : null}
                        </div>
                        <span className="flex-shrink-0 font-semibold">
                          {formatNumber(quantity)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-5 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowStockInConfirmModal(false)}
                    disabled={saving}
                    className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void performStockIn()}
                    disabled={saving}
                    className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? "Stocking In..." : `Stock In ${formatNumber(totalReturnQuantity)}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {undoModalReturnId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Undo stock-in
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              This reverses inventory and restores your previous quantities on Return Parts so you can fix and resubmit.
            </p>
            <label className="mt-4 grid gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Reason (required)
              <textarea
                value={undoReason}
                onChange={(event) => setUndoReason(event.target.value)}
                rows={3}
                placeholder="Explain why this stock-in is being undone (min 10 characters)"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:text-white dark:focus:border-blue-400"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setUndoModalReturnId(null);
                  setUndoReason("");
                }}
                disabled={Boolean(undoingReturnId)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleUndo()}
                disabled={Boolean(undoingReturnId) || undoReason.trim().length < 10}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {undoingReturnId ? "Undoing..." : "Undo stock-in"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
