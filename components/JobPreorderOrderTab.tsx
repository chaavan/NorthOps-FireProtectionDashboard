"use client";

import { useMemo, useState } from "react";
import JobPreorderAddModal, {
  type PreorderAddPayload,
} from "@/components/JobPreorderAddModal";
import { formatVendorDisplay } from "@/lib/vendorUtils";
import { formatDateInAppTimeZone } from "@/lib/timezone";
import {
  lineStatusBadgeClass,
  type JobPreorderLineDto,
} from "@/lib/jobPreorderTabUtils";

type SortKey = "part" | "qty" | "received" | "date";
type SortDir = "asc" | "desc";

type JobPreorderOrderTabProps = {
  jobNumber?: string | null;
  canEdit: boolean;
  loading: boolean;
  saving: boolean;
  lines: JobPreorderLineDto[];
  vendors: string[];
  onAddPreorder: (payload: PreorderAddPayload) => Promise<void>;
};

const headerCellClass =
  "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";

const bodyCellClass =
  "px-3 py-3 align-middle text-sm text-slate-900 dark:text-slate-100";

/** Every placed order is its own row — not filtered by open/pending. */
function isActiveOrderLine(line: JobPreorderLineDto) {
  return line.status !== "CANCELLED";
}

export default function JobPreorderOrderTab({
  jobNumber,
  canEdit,
  loading,
  saving,
  lines,
  vendors,
  onAddPreorder,
}: JobPreorderOrderTabProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [modalOpen, setModalOpen] = useState(false);

  const orderLines = useMemo(
    () => lines.filter(isActiveOrderLine),
    [lines],
  );

  const filteredLines = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = orderLines;
    if (q) {
      list = list.filter(
        (line) =>
          line.partNumber.toLowerCase().includes(q) ||
          (line.description ?? "").toLowerCase().includes(q) ||
          (line.vendor ?? "").toLowerCase().includes(q),
      );
    }
    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "qty") {
        cmp = a.quantity - b.quantity;
      } else if (sortKey === "received") {
        cmp = a.quantityReceived - b.quantityReceived;
      } else if (sortKey === "date") {
        cmp =
          new Date(a.orderedAt).getTime() - new Date(b.orderedAt).getTime();
      } else {
        cmp = a.partNumber.localeCompare(b.partNumber);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [orderLines, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "asc");
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700/50">
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              disabled={saving}
              className="rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:shadow disabled:opacity-50"
            >
              + Add pre-order
            </button>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {orderLines.length}{" "}
            {orderLines.length === 1 ? "order" : "orders"} placed
          </p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search orders..."
          className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700/50 dark:text-white"
        />
      </div>

      {loading && orderLines.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 py-12 text-sm text-slate-500">
          Loading pre-orders...
        </div>
      ) : orderLines.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-12 text-center">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            No orders placed yet
          </p>
          <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
            Each time you add a pre-order it appears as its own line here — even
            for the same part. Receive stock on Incoming stock, then pull on
            Overview when parts are on a list.
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              disabled={saving}
              className="rounded-lg border border-violet-400/50 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50 dark:text-violet-200 dark:hover:bg-violet-500/10"
            >
              + Add pre-order
            </button>
          )}
        </div>
      ) : filteredLines.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 py-12 text-sm text-slate-500">
          No orders match your search.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[800px] border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/95">
              <tr className="border-b border-slate-200 dark:border-slate-700/60">
                <th className={headerCellClass}>
                  <button
                    type="button"
                    onClick={() => toggleSort("part")}
                    className="font-semibold hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    Part{sortIndicator("part")}
                  </button>
                </th>
                <th className={headerCellClass}>Vendor</th>
                <th className={`${headerCellClass} text-right`}>
                  <button
                    type="button"
                    onClick={() => toggleSort("qty")}
                    className="font-semibold hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    Ordered{sortIndicator("qty")}
                  </button>
                </th>
                <th className={`${headerCellClass} text-right`}>
                  <button
                    type="button"
                    onClick={() => toggleSort("received")}
                    className="font-semibold hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    Received{sortIndicator("received")}
                  </button>
                </th>
                <th className={headerCellClass}>
                  <button
                    type="button"
                    onClick={() => toggleSort("date")}
                    className="font-semibold hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    Ordered date{sortIndicator("date")}
                  </button>
                </th>
                <th className={headerCellClass}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
              {filteredLines.map((line) => (
                <tr key={line.id} className="bg-white dark:bg-slate-800/30">
                  <td className={`${bodyCellClass} align-top`}>
                    <p className="font-mono text-sm font-bold">
                      {line.partNumber}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                      {line.description || "No description"}
                    </p>
                    {line.uom ? (
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-500">
                        {line.uom}
                      </p>
                    ) : null}
                  </td>
                  <td className={bodyCellClass}>
                    {line.vendor ? formatVendorDisplay(line.vendor) : "—"}
                  </td>
                  <td className={`${bodyCellClass} text-right tabular-nums font-semibold`}>
                    {line.quantity}
                  </td>
                  <td className={`${bodyCellClass} text-right tabular-nums`}>
                    {line.quantityReceived}
                  </td>
                  <td className={bodyCellClass}>
                    {formatDateInAppTimeZone(line.orderedAt)}
                  </td>
                  <td className={bodyCellClass}>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-bold ${lineStatusBadgeClass(line.status)}`}
                    >
                      {line.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <JobPreorderAddModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={onAddPreorder}
        existingLines={lines}
        vendors={vendors}
        jobNumber={jobNumber}
        saving={saving}
      />
    </div>
  );
}
