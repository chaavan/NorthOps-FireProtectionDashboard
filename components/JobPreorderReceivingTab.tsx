"use client";

import { Fragment, useMemo, useState } from "react";
import WarningConfirmModal from "@/components/WarningConfirmModal";
import { formatVendorDisplay } from "@/lib/vendorUtils";
import { formatDateInAppTimeZone } from "@/lib/timezone";
import {
  aggregateReceivingByPart,
  lineStatusBadgeClass,
  maxUnreceivableForLine,
  partStatusBadgeClass,
  type JobPartCatalogEntry,
  type JobPreorderLineDto,
  type ReceivingPartRow,
} from "@/lib/jobPreorderTabUtils";
import type { JobLineItem } from "@/lib/types";

type SortKey = "part" | "pending" | "lastOrdered";
type SortDir = "asc" | "desc";

type JobPreorderReceivingTabProps = {
  canEdit: boolean;
  loading: boolean;
  saving: boolean;
  lines: JobPreorderLineDto[];
  jobLineItems: JobLineItem[];
  poolAvailableByPart: Record<string, number>;
  catalogByPart: Map<string, JobPartCatalogEntry>;
  onReceive: (lineId: string, quantity: number) => Promise<void>;
  onUnreceive: (lineId: string, quantity: number) => Promise<void>;
  onDelete: (lineId: string) => Promise<void>;
};

const headerCellClass =
  "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap";

const bodyCellClass =
  "px-3 py-3 align-middle text-sm text-slate-900 dark:text-slate-100 whitespace-nowrap";

const subHeaderCellClass =
  "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap";

const subBodyCellClass =
  "px-3 py-2.5 align-middle text-sm text-slate-900 dark:text-slate-100";

function pendingForLine(line: JobPreorderLineDto) {
  return Math.max(0, line.quantity - line.quantityReceived);
}

export default function JobPreorderReceivingTab({
  canEdit,
  loading,
  saving,
  lines,
  jobLineItems,
  poolAvailableByPart,
  catalogByPart,
  onReceive,
  onUnreceive,
  onDelete,
}: JobPreorderReceivingTabProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("part");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedPartKeys, setExpandedPartKeys] = useState<Set<string>>(
    new Set(),
  );
  const [receiveQtyByLine, setReceiveQtyByLine] = useState<
    Record<string, string>
  >({});
  const [unreceiveQtyByLine, setUnreceiveQtyByLine] = useState<
    Record<string, string>
  >({});
  const [activeLineAction, setActiveLineAction] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JobPreorderLineDto | null>(
    null,
  );

  const partRows = useMemo(
    () =>
      aggregateReceivingByPart(
        lines,
        jobLineItems,
        poolAvailableByPart,
        catalogByPart,
      ),
    [lines, jobLineItems, poolAvailableByPart, catalogByPart],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = partRows;
    if (q) {
      list = list.filter(
        (row) =>
          row.partNumber.toLowerCase().includes(q) ||
          (row.description ?? "").toLowerCase().includes(q),
      );
    }
    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "pending") {
        cmp = a.pendingTotal - b.pendingTotal;
      } else if (sortKey === "lastOrdered") {
        const aTime = a.lastOrderedAt ? new Date(a.lastOrderedAt).getTime() : 0;
        const bTime = b.lastOrderedAt ? new Date(b.lastOrderedAt).getTime() : 0;
        cmp = aTime - bTime;
      } else {
        cmp = a.partNumber.localeCompare(b.partNumber);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [partRows, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  const toggleExpanded = (partKey: string) => {
    setExpandedPartKeys((prev) => {
      const next = new Set(prev);
      if (next.has(partKey)) next.delete(partKey);
      else next.add(partKey);
      return next;
    });
  };

  const handleReceive = async (line: JobPreorderLineDto) => {
    const pending = pendingForLine(line);
    const qty = Math.floor(Number(receiveQtyByLine[line.id] ?? ""));
    if (!Number.isFinite(qty) || qty <= 0 || qty > pending) return;
    setActiveLineAction(line.id);
    try {
      await onReceive(line.id, qty);
      setReceiveQtyByLine((prev) => {
        const next = { ...prev };
        delete next[line.id];
        return next;
      });
    } finally {
      setActiveLineAction(null);
    }
  };

  const handleReceiveRemaining = async (line: JobPreorderLineDto) => {
    const pending = pendingForLine(line);
    if (pending <= 0) return;
    setActiveLineAction(line.id);
    try {
      await onReceive(line.id, pending);
      setReceiveQtyByLine((prev) => {
        const next = { ...prev };
        delete next[line.id];
        return next;
      });
    } finally {
      setActiveLineAction(null);
    }
  };

  const handleUnreceive = async (
    line: JobPreorderLineDto,
    poolAvailableForPart: number,
  ) => {
    const maxUndo = maxUnreceivableForLine(line, poolAvailableForPart);
    const qty = Math.floor(Number(unreceiveQtyByLine[line.id] ?? ""));
    if (!Number.isFinite(qty) || qty <= 0 || qty > maxUndo) return;
    setActiveLineAction(line.id);
    try {
      await onUnreceive(line.id, qty);
      setUnreceiveQtyByLine((prev) => {
        const next = { ...prev };
        delete next[line.id];
        return next;
      });
    } finally {
      setActiveLineAction(null);
    }
  };

  const handleUnreceiveAll = async (
    line: JobPreorderLineDto,
    poolAvailableForPart: number,
  ) => {
    const maxUndo = maxUnreceivableForLine(line, poolAvailableForPart);
    if (maxUndo <= 0) return;
    setActiveLineAction(line.id);
    try {
      await onUnreceive(line.id, maxUndo);
      setUnreceiveQtyByLine((prev) => {
        const next = { ...prev };
        delete next[line.id];
        return next;
      });
    } finally {
      setActiveLineAction(null);
    }
  };

  const renderExpandedLines = (row: ReceivingPartRow) => (
    <tr key={`${row.partKey}-detail`}>
      <td colSpan={9} className="bg-slate-50/90 px-2 py-2 dark:bg-slate-900/40">
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700/60 dark:bg-slate-800/50">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700/60 dark:bg-slate-800/80">
                <th className={subHeaderCellClass}>Vendor</th>
                <th className={subHeaderCellClass}>Ordered date</th>
                <th className={`${subHeaderCellClass} text-right`}>Ordered</th>
                <th className={`${subHeaderCellClass} text-right`}>Received</th>
                <th className={subHeaderCellClass}>Receive / Undo</th>
                {canEdit && (
                  <th className={`${subHeaderCellClass} text-right`}>Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
              {row.lines.map((line) => {
                const pending = pendingForLine(line);
                const maxUndo = maxUnreceivableForLine(line, row.poolAvailable);
                const busy = activeLineAction === line.id;
                return (
                  <tr key={line.id}>
                    <td className={subBodyCellClass}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${lineStatusBadgeClass(line.status)}`}
                        >
                          {line.status}
                        </span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {line.vendor
                            ? formatVendorDisplay(line.vendor)
                            : "No vendor"}
                        </span>
                      </div>
                    </td>
                    <td className={`${subBodyCellClass} text-slate-600 dark:text-slate-400`}>
                      {formatDateInAppTimeZone(line.orderedAt)}
                    </td>
                    <td className={`${subBodyCellClass} text-right tabular-nums font-semibold`}>
                      {line.quantity}
                      {line.uom ? (
                        <span className="ml-1 text-xs font-normal text-slate-500">
                          {line.uom}
                        </span>
                      ) : null}
                    </td>
                    <td className={`${subBodyCellClass} text-right tabular-nums font-semibold`}>
                      {line.quantityReceived}
                    </td>
                    <td className={subBodyCellClass}>
                      <div className="flex flex-col gap-2">
                        {canEdit && pending > 0 ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              max={pending}
                              aria-label="Receive quantity"
                              placeholder="Qty"
                              value={receiveQtyByLine[line.id] ?? ""}
                              onChange={(e) =>
                                setReceiveQtyByLine((prev) => ({
                                  ...prev,
                                  [line.id]: e.target.value,
                                }))
                              }
                              disabled={saving || busy}
                              className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums dark:border-slate-600 dark:bg-slate-700/50 dark:text-white"
                            />
                            <button
                              type="button"
                              onClick={() => void handleReceive(line)}
                              disabled={saving || busy}
                              className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Receive
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleReceiveRemaining(line)}
                              disabled={saving || busy}
                              className="rounded-lg border border-emerald-500/50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10 disabled:opacity-50"
                            >
                              All
                            </button>
                          </div>
                        ) : pending === 0 ? (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            Fully received
                          </span>
                        ) : null}
                        {canEdit && maxUndo > 0 ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              max={maxUndo}
                              aria-label="Undo receive quantity"
                              placeholder="Qty"
                              value={unreceiveQtyByLine[line.id] ?? ""}
                              onChange={(e) =>
                                setUnreceiveQtyByLine((prev) => ({
                                  ...prev,
                                  [line.id]: e.target.value,
                                }))
                              }
                              disabled={saving || busy}
                              className="w-20 rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm tabular-nums dark:border-amber-600/50 dark:bg-slate-700/50 dark:text-white"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                void handleUnreceive(line, row.poolAvailable)
                              }
                              disabled={saving || busy}
                              className="rounded-lg bg-amber-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                            >
                              Undo
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleUnreceiveAll(line, row.poolAvailable)
                              }
                              disabled={saving || busy}
                              className="rounded-lg border border-amber-500/50 px-2.5 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-50 dark:text-amber-200 dark:hover:bg-amber-500/10 disabled:opacity-50"
                            >
                              Undo all
                            </button>
                          </div>
                        ) : line.quantityReceived > 0 && row.pulledJobwide > 0 ? (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            Pulled from pool — cannot undo
                          </span>
                        ) : null}
                      </div>
                    </td>
                    {canEdit && (
                      <td className={`${subBodyCellClass} text-right`}>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(line)}
                          disabled={saving || busy}
                          className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WarningConfirmModal
        isOpen={deleteTarget !== null}
        title="Remove pre-order line?"
        message="This removes the order line from this job. Received stock that has been pulled on lists cannot be deleted."
        detail={
          deleteTarget
            ? `${deleteTarget.partNumber} · ordered ${deleteTarget.quantity}`
            : undefined
        }
        confirmLabel="Remove line"
        cancelLabel="Keep line"
        onConfirm={() => {
          if (!deleteTarget) return;
          const id = deleteTarget.id;
          setDeleteTarget(null);
          void onDelete(id);
        }}
        onCancel={() => setDeleteTarget(null)}
        confirming={saving}
      />
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700/50">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by part number or description..."
          className="w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700/50 dark:text-white"
        />
      </div>

      {loading && partRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 py-12 text-sm text-slate-500">
          Loading pre-orders...
        </div>
      ) : partRows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-12 text-center">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            No pre-orders yet for this job
          </p>
          <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
            Use Place orders to add parts for this job. Receive deliveries here,
            then pull from Overview when parts are on a list.
          </p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 py-12 text-sm text-slate-500">
          No pre-orders match your search.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[960px] border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/95">
              <tr className="border-b border-slate-200 dark:border-slate-700/60">
                <th className={`${headerCellClass} w-10`} />
                <th className={headerCellClass}>
                  <button
                    type="button"
                    onClick={() => toggleSort("part")}
                    className="font-semibold hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    Part{sortIndicator("part")}
                  </button>
                </th>
                <th className={headerCellClass}>Ordered</th>
                <th className={headerCellClass}>Received</th>
                <th className={headerCellClass}>
                  <button
                    type="button"
                    onClick={() => toggleSort("pending")}
                    className="font-semibold hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    Pending{sortIndicator("pending")}
                  </button>
                </th>
                <th className={headerCellClass}>Pool</th>
                <th className={headerCellClass}>Pulled</th>
                <th className={headerCellClass}>Status</th>
                <th className={headerCellClass}>
                  <button
                    type="button"
                    onClick={() => toggleSort("lastOrdered")}
                    className="font-semibold hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    Last ordered{sortIndicator("lastOrdered")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
              {filteredRows.map((row) => {
                const expanded = expandedPartKeys.has(row.partKey);
                return (
                  <Fragment key={row.partKey}>
                    <tr
                      className="cursor-pointer bg-white transition-colors hover:bg-slate-50 dark:bg-slate-800/30 dark:hover:bg-slate-700/40"
                      onClick={() => toggleExpanded(row.partKey)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleExpanded(row.partKey);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-expanded={expanded}
                      aria-label={
                        expanded
                          ? `Collapse orders for ${row.partNumber}`
                          : `Expand orders for ${row.partNumber}`
                      }
                    >
                      <td className={bodyCellClass}>
                        <span
                          className="inline-block w-5 text-center text-slate-500"
                          aria-hidden
                        >
                          {expanded ? "▼" : "▶"}
                        </span>
                      </td>
                      <td className={bodyCellClass}>
                        <p className="font-mono text-sm font-bold">
                          {row.partNumber}
                        </p>
                        <p className="max-w-[200px] truncate text-xs text-slate-500 dark:text-slate-400">
                          {row.description || "No description"}
                        </p>
                      </td>
                      <td className={`${bodyCellClass} tabular-nums`}>
                        {row.orderedTotal}
                      </td>
                      <td className={`${bodyCellClass} tabular-nums`}>
                        {row.receivedTotal}
                      </td>
                      <td className={`${bodyCellClass} tabular-nums font-semibold`}>
                        {row.pendingTotal}
                      </td>
                      <td className={`${bodyCellClass} tabular-nums`}>
                        {row.poolAvailable}
                      </td>
                      <td className={`${bodyCellClass} tabular-nums`}>
                        {row.pulledJobwide}
                      </td>
                      <td className={bodyCellClass}>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-bold ${partStatusBadgeClass(row.status)}`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className={bodyCellClass}>
                        {row.lastOrderedAt
                          ? formatDateInAppTimeZone(row.lastOrderedAt)
                          : "—"}
                      </td>
                    </tr>
                    {expanded && renderExpandedLines(row)}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
