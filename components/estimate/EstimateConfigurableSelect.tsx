"use client";

import { useCallback, useEffect, useMemo, useState, type FocusEvent } from "react";
import type { EstimateLookupCategory, EstimateLookupOptionRecord } from "@/lib/estimateTypes";
import { estimateInputFieldCompact, estimateLabelCompact } from "@/lib/estimate/estimateUi";

const OTHER_VALUE = "__other__";
const ADD_VALUE = "__add__";

type Props = {
  label: string;
  category: EstimateLookupCategory;
  optionId: string | null;
  otherValue: string | null;
  inputClassName?: string;
  allowAddOptions?: boolean;
  disabled?: boolean;
  onChange: (value: { optionId: string | null; other: string | null }) => void;
  onBlur?: (event: FocusEvent<HTMLInputElement | HTMLSelectElement>) => void;
};

function resolveSelectValue(optionId: string | null, otherValue: string | null): string {
  if (otherValue) return OTHER_VALUE;
  return optionId ?? "";
}

export default function EstimateConfigurableSelect({
  label,
  category,
  optionId,
  otherValue,
  inputClassName,
  allowAddOptions = false,
  disabled = false,
  onChange,
  onBlur,
}: Props) {
  const inputClass = inputClassName ?? estimateInputFieldCompact;
  const [options, setOptions] = useState<EstimateLookupOptionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"select" | "other" | "add">("select");
  const [draftText, setDraftText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectValue = resolveSelectValue(optionId, otherValue);

  const legacyOption = useMemo(() => {
    if (!optionId || otherValue) return null;
    if (options.some((option) => option.id === optionId)) return null;
    return optionId;
  }, [optionId, otherValue, options]);

  const loadOptions = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(
        `/api/estimates/lookup-options?category=${encodeURIComponent(category)}`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to load options");
      setOptions(payload.options || []);
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [category]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    if (otherValue) {
      setMode("other");
      setDraftText(otherValue);
      return;
    }
    setMode("select");
    setDraftText("");
  }, [otherValue, optionId]);

  useEffect(() => {
    if (allowAddOptions || mode !== "add") return;
    setMode("select");
    setDraftText("");
    setSaveError(null);
  }, [allowAddOptions, mode]);

  const handleSelectChange = (nextValue: string) => {
    if (disabled) return;
    setSaveError(null);
    if (nextValue === OTHER_VALUE) {
      setMode("other");
      setDraftText(otherValue ?? "");
      onChange({ optionId: null, other: otherValue ?? "" });
      return;
    }
    if (nextValue === ADD_VALUE) {
      if (!allowAddOptions) return;
      setMode("add");
      setDraftText("");
      return;
    }
    setMode("select");
    setDraftText("");
    onChange({
      optionId: nextValue || null,
      other: null,
    });
  };

  const handleOtherBlur = (event: FocusEvent<HTMLInputElement>) => {
    onChange({
      optionId: null,
      other: draftText.trim() || null,
    });
    onBlur?.(event);
  };

  const handleSaveNewOption = async () => {
    const trimmed = draftText.trim();
    if (!trimmed) {
      setSaveError("Enter a name before saving.");
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/estimates/lookup-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, label: trimmed }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to save option");

      const saved = payload.option as EstimateLookupOptionRecord;
      setOptions((current) => {
        const withoutDuplicate = current.filter((option) => option.id !== saved.id);
        return [...withoutDuplicate, saved].sort((a, b) => a.label.localeCompare(b.label));
      });
      setMode("select");
      setDraftText("");
      onChange({ optionId: saved.id, other: null });
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <label className={`${estimateLabelCompact} sm:col-span-2`}>
      {label}
      {mode === "select" ? (
        <select
          value={selectValue}
          onChange={(event) => handleSelectChange(event.target.value)}
          onBlur={(event) => onBlur?.(event)}
          className={inputClass}
          disabled={disabled || isLoading}
        >
          <option value="">Select {label.toLowerCase()}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
          {legacyOption ? (
            <option value={legacyOption}>Saved value (no longer in list)</option>
          ) : null}
          <option value={OTHER_VALUE}>Other</option>
          {allowAddOptions ? <option value={ADD_VALUE}>+ Add new...</option> : null}
        </select>
      ) : null}

      {mode === "other" ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              onBlur={handleOtherBlur}
              placeholder={`Enter ${label.toLowerCase()} (one-off)`}
              disabled={disabled}
              readOnly={disabled}
              className={inputClass}
            />
            {!disabled ? (
            <button
              type="button"
              onClick={() => {
                setMode("select");
                setDraftText("");
                onChange({ optionId: null, other: null });
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Back to list
            </button>
            ) : null}
          </div>
          <p className="text-xs text-slate-500">
            Other saves only for this estimate and is not added to the shared list.
          </p>
        </div>
      ) : null}

      {mode === "add" ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              placeholder={`New ${label.toLowerCase()}`}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => void handleSaveNewOption()}
              disabled={isSaving}
              className="rounded-lg border border-blue-400/50 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-500/20 disabled:opacity-50 dark:text-blue-200"
            >
              {isSaving ? "Saving..." : "Save to list"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("select");
                setDraftText("");
                setSaveError(null);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Saved types are available for all future estimates.
          </p>
          {saveError ? <p className="text-xs text-red-500">{saveError}</p> : null}
        </div>
      ) : null}

      {loadError ? <p className="text-xs text-red-500">{loadError}</p> : null}
    </label>
  );
}
