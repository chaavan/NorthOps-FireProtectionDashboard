"use client";

import type { ChangeEvent, FocusEvent } from "react";
import type { EstimateChangeOrder, EstimateDraft } from "@/lib/estimateTypes";
import EstimateSectionCard from "@/components/estimate/EstimateSectionCard";
import {
  estimateBadge,
  estimateInputField,
  estimateItemPanel,
  estimateLabel,
  estimateMutedPanel,
} from "@/lib/estimate/estimateUi";

type Props = {
  draft: EstimateDraft;
  saveState?: string;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<EstimateChangeOrder>) => void;
  onBlur: (section: "changeOrders", event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
};

function saveLabel(saveState?: string) {
  if (saveState === "saving") return "Saving...";
  if (saveState === "saved") return "Saved";
  if (saveState === "error") return "Save failed";
  return "Change orders";
}

export default function EstimateChangeOrdersSection({
  draft,
  saveState,
  onAdd,
  onRemove,
  onChange,
  onBlur,
}: Props) {
  const orders = draft.changeOrders ?? [];

  const handleText =
    (id: string, field: "title" | "description") =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(id, { [field]: event.target.value });
    };

  const handleNumber =
    (id: string, field: "amount" | "hours") =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value === "" ? null : Number(event.target.value);
      if (field === "amount") {
        onChange(id, { amount: next === null ? 0 : next });
      } else {
        onChange(id, { hours: next });
      }
    };

  return (
    <EstimateSectionCard
      title="Change Orders"
      description="Track post-bid scope changes (amount and hours are informational and appear on the exported PDF)."
      rightSlot={
        <div className="flex items-center gap-2">
          <div className={estimateBadge}>
            {saveLabel(saveState)}
          </div>
          <button
            type="button"
            onClick={onAdd}
            className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-400/20"
          >
            + Add change order
          </button>
        </div>
      }
    >
      {orders.length === 0 ? (
        <div className={estimateMutedPanel}>
          No change orders yet. Use &quot;+ Add change order&quot; to track scope modifications.
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <div
              key={order.id}
              className={`${estimateItemPanel} lg:grid-cols-[1.4fr_1fr_auto]`}
            >
              <div className="grid gap-2">
                <label className="grid gap-1 text-xs text-slate-500 dark:text-slate-400">
                  Title
                  <input
                    type="text"
                    value={order.title}
                    onChange={handleText(order.id, "title")}
                    onBlur={(event) => onBlur("changeOrders", event)}
                    className={estimateInputField}
                    placeholder="Added Fire Pump Lead-In"
                  />
                </label>
                <label className="grid gap-1 text-xs text-slate-500 dark:text-slate-400">
                  Description
                  <textarea
                    value={order.description}
                    onChange={handleText(order.id, "description")}
                    onBlur={(event) => onBlur("changeOrders", event)}
                    rows={2}
                    className={estimateInputField}
                  />
                </label>
              </div>
              <div className="grid gap-2">
                <label className="grid gap-1 text-xs text-slate-500 dark:text-slate-400">
                  Amount ($)
                  <input
                    type="number"
                    step="0.01"
                    value={order.amount ?? ""}
                    onChange={handleNumber(order.id, "amount")}
                    onBlur={(event) => onBlur("changeOrders", event)}
                    className={estimateInputField}
                  />
                </label>
                <label className="grid gap-1 text-xs text-slate-500 dark:text-slate-400">
                  Added Hours
                  <input
                    type="number"
                    step="0.01"
                    value={order.hours ?? ""}
                    onChange={handleNumber(order.id, "hours")}
                    onBlur={(event) => onBlur("changeOrders", event)}
                    className={estimateInputField}
                  />
                </label>
              </div>
              <div className="flex items-start justify-end">
                <button
                  type="button"
                  onClick={() => onRemove(order.id)}
                  className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </EstimateSectionCard>
  );
}
