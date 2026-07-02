"use client";

import type { ChangeEvent, FocusEvent } from "react";
import type { EstimateDraft } from "@/lib/estimateTypes";
import EstimateSectionCard from "@/components/estimate/EstimateSectionCard";
import {
  estimateBadge,
  estimateInputField,
  estimateInsetPanel,
  estimateLabel,
  estimatePanelTitle,
  estimateSectionDescription,
} from "@/lib/estimate/estimateUi";
import {
  SUBS_MISC_CUSTOM_CELLS,
  SUBS_MISC_FIXED_LABELS,
} from "@/lib/estimate/system1Template";

type Props = {
  draft: EstimateDraft;
  saveState?: string;
  onMiscChange: (cell: string, value: number | null) => void;
  onMiscLabelChange?: (cell: string, value: string) => void;
  onBlur: (section: "subsAndFees", event: FocusEvent<HTMLInputElement>) => void;
};

const FIXED_MISC_FIELDS = Object.entries(SUBS_MISC_FIXED_LABELS).map(
  ([cell, label]) => ({ cell, label }),
);

export default function EstimateSubsFeesSection({
  draft,
  saveState,
  onMiscChange,
  onMiscLabelChange,
  onBlur,
}: Props) {
  const toInputValue = (value: string | number | boolean | null | undefined) => {
    if (value === null || value === undefined || value === "") {
      return "";
    }
    if (typeof value === "boolean") {
      return value ? "1" : "0";
    }
    return value;
  };

  const handleAmountChange =
    (cell: string) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      onMiscChange(cell, event.target.value === "" ? null : Number(event.target.value));
    };

  const handleLabelChange =
    (cell: string) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      onMiscLabelChange?.(cell, event.target.value);
    };

  const customLabels = draft.subsAndFees.miscellaneousLabels ?? {};

  return (
    <EstimateSectionCard
      title="Subs, Fees & Misc"
      description="Direct-entry subcontractor and fee buckets from the worksheet. Add custom rows in the 'Other' fields below."
      rightSlot={
        <div className={estimateBadge}>
          {saveState === "saving"
            ? "Saving..."
            : saveState === "saved"
              ? "Saved"
              : saveState === "error"
                ? "Save failed"
                : "Misc costs"}
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {FIXED_MISC_FIELDS.map((field) => (
          <label key={field.cell} className={estimateLabel}>
            <span className="flex items-center justify-between">
              <span>{field.label}</span>
              <span className="text-xs text-slate-500">{field.cell}</span>
            </span>
            <input
              type="number"
              step="0.01"
              value={toInputValue(draft.subsAndFees.miscellaneousCosts[field.cell])}
              onChange={handleAmountChange(field.cell)}
              onBlur={(event) => onBlur("subsAndFees", event)}
              data-estimate-cell={field.cell}
              className={estimateInputField}
            />
          </label>
        ))}
      </div>

      <div className={`mt-4 ${estimateInsetPanel}`}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className={estimatePanelTitle}>Other misc line items</div>
            <div className={estimateSectionDescription}>
              Use these for anything that doesn&apos;t fit the named buckets above (e.g. Detection, Signage, Specialty).
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {SUBS_MISC_CUSTOM_CELLS.map((cell, index) => {
            const fallbackLabel = `Other ${index + 1}`;
            return (
              <div key={cell} className="grid gap-1">
                <label className="grid gap-1 text-xs text-slate-400">
                  <span className="flex items-center justify-between">
                    <span>Label</span>
                    <span className="text-xs text-slate-500">{cell}</span>
                  </span>
                  <input
                    type="text"
                    value={customLabels[cell] ?? ""}
                    placeholder={fallbackLabel}
                    onChange={handleLabelChange(cell)}
                    onBlur={(event) =>
                      onBlur(
                        "subsAndFees",
                        event as unknown as FocusEvent<HTMLInputElement>,
                      )
                    }
                    className={estimateInputField}
                  />
                </label>
                <label className="grid gap-1 text-xs text-slate-400">
                  <span>Amount</span>
                  <input
                    type="number"
                    step="0.01"
                    value={toInputValue(draft.subsAndFees.miscellaneousCosts[cell])}
                    onChange={handleAmountChange(cell)}
                    onBlur={(event) => onBlur("subsAndFees", event)}
                    data-estimate-cell={cell}
                    className={estimateInputField}
                  />
                </label>
              </div>
            );
          })}
        </div>
      </div>
    </EstimateSectionCard>
  );
}
