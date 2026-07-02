"use client";

import type { ChangeEvent, FocusEvent } from "react";
import type { EstimateDraft } from "@/lib/estimateTypes";
import EstimateSectionCard from "@/components/estimate/EstimateSectionCard";
import { estimateBadge, estimateInputField, estimateLabel } from "@/lib/estimate/estimateUi";

type Props = {
  draft: EstimateDraft;
  saveState?: string;
  onProjectChange: (
    field: keyof EstimateDraft["project"] | keyof EstimateDraft["inputs"],
    value: string | number | null,
  ) => void;
  onBlur: (section: "project", event: FocusEvent<HTMLInputElement>) => void;
};

function fieldClassName() {
  return `block w-full min-w-0 max-w-full ${estimateInputField}`;
}

function saveLabel(saveState?: string) {
  if (saveState === "saving") return "Saving...";
  if (saveState === "saved") return "Saved";
  if (saveState === "error") return "Save failed";
  return "Autosaves on blur";
}

export default function EstimateProjectSection({
  draft,
  saveState,
  onProjectChange,
  onBlur,
}: Props) {
  const handleTextChange =
    (field: keyof EstimateDraft["project"]) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      onProjectChange(field, event.target.value);
    };

  const handleNumberChange =
    (field: keyof EstimateDraft["project"] | keyof EstimateDraft["inputs"]) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      onProjectChange(
        field,
        event.target.value === "" ? null : Number(event.target.value),
      );
    };

  return (
    <EstimateSectionCard
      title="Project & Bid Inputs"
      description="Project metadata and estimate-level settings."
      rightSlot={
        <div className={estimateBadge}>
          {saveLabel(saveState)}
        </div>
      }
    >
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <div className="grid min-w-0 gap-3">
          <label className={`min-w-0 ${estimateLabel}`}>
            Project Name
            <input
              value={draft.project.projectName}
              onChange={handleTextChange("projectName")}
              onBlur={(event) => onBlur("project", event)}
              className={fieldClassName()}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={`min-w-0 ${estimateLabel}`}>
              System Label
              <input
                value={draft.project.systemLabel}
                onChange={handleTextChange("systemLabel")}
                onBlur={(event) => onBlur("project", event)}
                placeholder="e.g. Base · Alt #1 · Demo"
                className={fieldClassName()}
              />
            </label>
            <label className={`min-w-0 ${estimateLabel}`}>
              Estimator
              <input
                value={draft.project.estimator}
                onChange={handleTextChange("estimator")}
                onBlur={(event) => onBlur("project", event)}
                className={fieldClassName()}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={`min-w-0 ${estimateLabel}`}>
              Estimate Date
              <input
                type="date"
                value={draft.project.date}
                onChange={handleTextChange("date")}
                onBlur={(event) => onBlur("project", event)}
                className={fieldClassName()}
              />
            </label>
            <label className={`min-w-0 ${estimateLabel}`}>
              Bid Due Date
              <input
                type="date"
                value={draft.project.bidDueDate}
                onChange={handleTextChange("bidDueDate")}
                onBlur={(event) => onBlur("project", event)}
                className={fieldClassName()}
              />
            </label>
          </div>
          <label className={`min-w-0 ${estimateLabel}`}>
            Location
            <input
              value={draft.project.projectLocationLine1}
              onChange={handleTextChange("projectLocationLine1")}
              onBlur={(event) => onBlur("project", event)}
              className={fieldClassName()}
            />
          </label>
          <label className={`min-w-0 ${estimateLabel}`}>
            Area / Notes
            <input
              value={draft.project.projectLocationLine2}
              onChange={handleTextChange("projectLocationLine2")}
              onBlur={(event) => onBlur("project", event)}
              className={fieldClassName()}
            />
          </label>
        </div>

        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className={`min-w-0 ${estimateLabel}`}>
            Miles To Job
            <input
              type="number"
              step="0.01"
              value={draft.inputs.milesToJobSite ?? ""}
              onChange={handleNumberChange("milesToJobSite")}
              onBlur={(event) => onBlur("project", event)}
              className={fieldClassName()}
            />
          </label>
          <label className={`min-w-0 ${estimateLabel}`}>
            Sales Tax %
            <input
              type="number"
              step="0.01"
              value={draft.inputs.salesTaxPercent}
              onChange={handleNumberChange("salesTaxPercent")}
              onBlur={(event) => onBlur("project", event)}
              className={fieldClassName()}
            />
          </label>
          <label className={`min-w-0 ${estimateLabel}`}>
            Material Inflation %
            <input
              type="number"
              step="0.01"
              value={draft.inputs.materialInflationPercent}
              onChange={handleNumberChange("materialInflationPercent")}
              onBlur={(event) => onBlur("project", event)}
              className={fieldClassName()}
            />
          </label>
          <label className={`min-w-0 ${estimateLabel}`}>
            Overhead %
            <input
              type="number"
              step="0.01"
              value={draft.inputs.overheadPercent}
              onChange={handleNumberChange("overheadPercent")}
              onBlur={(event) => onBlur("project", event)}
              className={fieldClassName()}
            />
          </label>
          <label className={`min-w-0 ${estimateLabel}`}>
            Profit %
            <input
              type="number"
              step="0.01"
              value={draft.inputs.profitPercent}
              onChange={handleNumberChange("profitPercent")}
              onBlur={(event) => onBlur("project", event)}
              className={fieldClassName()}
            />
          </label>
          <label className={`min-w-0 ${estimateLabel}`}>
            Subs Markup %
            <input
              type="number"
              step="0.01"
              value={draft.inputs.subsMarkupPercent}
              onChange={handleNumberChange("subsMarkupPercent")}
              onBlur={(event) => onBlur("project", event)}
              className={fieldClassName()}
            />
          </label>
          <label className={`min-w-0 ${estimateLabel}`}>
            Fees
            <input
              type="number"
              step="0.01"
              value={draft.inputs.fees ?? ""}
              onChange={handleNumberChange("fees")}
              onBlur={(event) => onBlur("project", event)}
              className={fieldClassName()}
            />
          </label>
          <label className={`min-w-0 ${estimateLabel}`}>
            PE Stamp
            <input
              type="number"
              step="0.01"
              value={draft.inputs.peStamp ?? ""}
              onChange={handleNumberChange("peStamp")}
              onBlur={(event) => onBlur("project", event)}
              className={fieldClassName()}
            />
          </label>
          <label className={`min-w-0 ${estimateLabel}`}>
            Bond Cost
            <input
              type="number"
              step="0.01"
              value={draft.inputs.bondCost ?? ""}
              onChange={handleNumberChange("bondCost")}
              onBlur={(event) => onBlur("project", event)}
              className={fieldClassName()}
            />
          </label>
          <label className={`min-w-0 ${estimateLabel}`}>
            Square Footage
            <input
              type="number"
              step="1"
              value={draft.project.squareFootage ?? ""}
              onChange={handleNumberChange("squareFootage")}
              onBlur={(event) => onBlur("project", event)}
              className={fieldClassName()}
            />
          </label>
        </div>
      </div>
    </EstimateSectionCard>
  );
}
