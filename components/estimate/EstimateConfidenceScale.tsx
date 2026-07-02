"use client";

import type { EstimateConfidenceLevel } from "@/lib/estimateTypes";
import { CONFIDENCE_LEVELS } from "@/lib/estimate/estimateMetadata";
import { estimateLabelCompact } from "@/lib/estimate/estimateUi";

type Props = {
  value: EstimateConfidenceLevel | null;
  allowClear?: boolean;
  disabled?: boolean;
  onChange: (value: EstimateConfidenceLevel | null) => void;
};

export default function EstimateConfidenceScale({
  value,
  allowClear = false,
  disabled = false,
  onChange,
}: Props) {
  return (
    <div className="sm:col-span-2">
      <div className={`${estimateLabelCompact} mb-3`}>Confidence Level</div>
      <div
        className="relative px-1"
        role="radiogroup"
        aria-label="Confidence level"
      >
        <div className="absolute left-3 right-3 top-[11px] h-0.5 bg-slate-200 dark:bg-slate-700" />
        <div className="relative grid grid-cols-5 gap-1">
          {CONFIDENCE_LEVELS.map((level) => {
            const isSelected = value === level.value;
            return (
              <button
                key={level.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={disabled}
                onClick={() => onChange(level.value)}
                className="group flex flex-col items-center gap-2 px-1 text-center disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span
                  className={`relative z-10 h-6 w-6 rounded-full border-2 transition ${
                    isSelected
                      ? "border-blue-500 bg-blue-500 shadow-[0_0_0_4px_rgba(59,130,246,0.15)] dark:border-blue-400 dark:bg-blue-400"
                      : "border-slate-300 bg-white group-hover:border-blue-300 dark:border-slate-600 dark:bg-slate-800 dark:group-hover:border-blue-400/70"
                  }`}
                />
                <span
                  className={`text-[10px] font-semibold leading-tight sm:text-xs ${
                    isSelected
                      ? "text-blue-700 dark:text-blue-300"
                      : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {level.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {allowClear && value ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(null)}
          className="mt-3 text-xs font-semibold text-slate-500 transition hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Clear selection
        </button>
      ) : null}
    </div>
  );
}
