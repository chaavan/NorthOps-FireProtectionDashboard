"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  estimateInputFieldCompact,
  estimateModalCancelBtn,
  estimateModalDescription,
  estimateModalOverlay,
  estimateModalPanel,
  estimateModalTitle,
  estimatePrimaryButtonMd,
} from "@/lib/estimate/estimateUi";

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

type Props = {
  isOpen: boolean;
  estimatedTotal: number | null;
  isSubmitting?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (contractPrice: number) => void;
};

export default function WonContractPriceModal({
  isOpen,
  estimatedTotal,
  isSubmitting = false,
  error = null,
  onCancel,
  onConfirm,
}: Props) {
  const [contractPrice, setContractPrice] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setContractPrice("");
    setLocalError(null);
  }, [isOpen]);

  if (!isOpen || typeof document === "undefined") return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = Number(contractPrice);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setLocalError("Enter a contract price greater than zero.");
      return;
    }
    setLocalError(null);
    onConfirm(parsed);
  };

  return createPortal(
    <div className={estimateModalOverlay} onMouseDown={onCancel}>
      <div
        className={`w-full max-w-md p-5 ${estimateModalPanel}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className={estimateModalTitle}>Contract Price</h2>
        <p className={estimateModalDescription}>
          This estimate is being marked as Won. Enter the actual contract price.
        </p>
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900/40">
          <div className="text-xs uppercase tracking-wide text-slate-500">Estimated total</div>
          <div className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
            {formatCurrency(estimatedTotal)}
          </div>
        </div>
        <form className="mt-5 grid gap-4" onSubmit={submit}>
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Contract Price
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={contractPrice}
              onChange={(event) => setContractPrice(event.target.value)}
              className={estimateInputFieldCompact}
              placeholder="0.00"
              autoFocus
            />
          </label>
          {localError || error ? (
            <p className="text-sm text-red-500">{localError || error}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className={estimateModalCancelBtn}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`${estimatePrimaryButtonMd} !text-white disabled:opacity-50`}
            >
              {isSubmitting ? "Saving..." : "Mark as Won"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
