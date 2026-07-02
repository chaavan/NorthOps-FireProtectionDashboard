"use client";

import { useEffect, useId, useState } from "react";
import { Mail, Package, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import type { UnifiedVendor } from "@/lib/vendorService";
import { isValidEmail } from "@/lib/suppliers";
import { formatVendorDisplay } from "@/lib/vendorUtils";
import {
  vendorAvatarColor,
  vendorInitials,
} from "@/components/vendors/vendorHubUtils";

export type VendorFormMode = "create" | "edit" | "configure";

export type VendorFormValues = {
  displayName: string;
  toEmails: string[];
  ccEmails: string[];
  isActive: boolean;
};

type VendorFormModalProps = {
  isOpen: boolean;
  mode: VendorFormMode;
  initialVendor?: UnifiedVendor | null;
  presetVendorKey?: string | null;
  isSaving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (values: VendorFormValues) => Promise<void>;
};

const EMPTY_FORM: VendorFormValues = {
  displayName: "",
  toEmails: [""],
  ccEmails: [],
  isActive: true,
};

function normalizeEmailRows(emails: string[]): string[] {
  const trimmed = emails.map((email) => email.trim()).filter(Boolean);
  return trimmed.length > 0 ? trimmed : [""];
}

function emailsFromVendor(emails: string[]): string[] {
  return emails.length > 0 ? emails : [""];
}

type EmailListFieldProps = {
  id: string;
  label: string;
  helper?: string;
  optional?: boolean;
  allowClearAll?: boolean;
  emails: string[];
  disabled?: boolean;
  invalidIndices: Set<number>;
  onChange: (emails: string[]) => void;
};

function EmailListField({
  id,
  label,
  helper,
  optional = false,
  allowClearAll = false,
  emails,
  disabled = false,
  invalidIndices,
  onChange,
}: EmailListFieldProps) {
  const rows = emails.length > 0 ? emails : [""];

  const updateRow = (index: number, value: string) => {
    const next = [...rows];
    next[index] = value;
    onChange(next);
  };

  const removeRow = (index: number) => {
    if (allowClearAll && rows.length <= 1) {
      onChange([]);
      return;
    }
    if (rows.length <= 1) {
      onChange([""]);
      return;
    }
    onChange(rows.filter((_, i) => i !== index));
  };

  const addRow = () => {
    onChange([...rows, ""]);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <label htmlFor={`${id}-0`} className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          {label}
          {optional ? (
            <span className="ml-1.5 text-xs font-normal text-slate-400 dark:text-slate-500">optional</span>
          ) : null}
        </label>
        <button
          type="button"
          onClick={addRow}
          disabled={disabled}
          className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-blue-600 transition hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
          Add email
        </button>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-600/60 dark:bg-slate-900/40">
        {rows.map((email, index) => {
          const isInvalid = invalidIndices.has(index);
          return (
            <div key={`${id}-${index}`} className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  strokeWidth={2}
                  aria-hidden
                />
                <input
                  id={index === 0 ? `${id}-0` : undefined}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => updateRow(index, event.target.value)}
                  disabled={disabled}
                  placeholder="name@vendor.com"
                  aria-invalid={isInvalid}
                  className={`w-full rounded-lg border bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:ring-2 disabled:opacity-60 dark:bg-slate-800 dark:text-white ${
                    isInvalid
                      ? "border-red-400 focus:border-red-500 focus:ring-red-500/20 dark:border-red-500/60"
                      : "border-slate-300 focus:border-blue-500 focus:ring-blue-500/20 dark:border-slate-600"
                  }`}
                />
              </div>
              <button
                type="button"
                onClick={() => removeRow(index)}
                disabled={disabled || (!allowClearAll && rows.length === 1 && !email.trim())}
                aria-label={`Remove email ${index + 1}`}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 dark:border-slate-600 dark:hover:border-red-900/40 dark:hover:bg-red-950/30 dark:hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>

      {helper ? (
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{helper}</p>
      ) : null}
    </div>
  );
}

const MODE_COPY: Record<
  VendorFormMode,
  { title: string; subtitle: string; submit: string; saving: string }
> = {
  create: {
    title: "Add Vendor",
    subtitle: "Add a vendor now and configure PO emails later if needed.",
    submit: "Add vendor",
    saving: "Adding...",
  },
  edit: {
    title: "Edit Vendor",
    subtitle: "Update this vendor's name, email routing, and active status.",
    submit: "Save changes",
    saving: "Saving...",
  },
  configure: {
    title: "Configure Vendor",
    subtitle: "Set up PO email routing for this inventory vendor.",
    submit: "Complete setup",
    saving: "Saving...",
  },
};

export default function VendorFormModal({
  isOpen,
  mode,
  initialVendor,
  presetVendorKey,
  isSaving = false,
  error = null,
  onClose,
  onSubmit,
}: VendorFormModalProps) {
  const [form, setForm] = useState<VendorFormValues>(EMPTY_FORM);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [invalidToIndices, setInvalidToIndices] = useState<Set<number>>(new Set());
  const [invalidCcIndices, setInvalidCcIndices] = useState<Set<number>>(new Set());
  const toFieldId = useId();
  const ccFieldId = useId();

  useEffect(() => {
    if (!isOpen) return;

    setValidationError(null);
    setInvalidToIndices(new Set());
    setInvalidCcIndices(new Set());

    if (mode === "edit" && initialVendor) {
      setForm({
        displayName: initialVendor.displayName,
        toEmails: emailsFromVendor(initialVendor.toEmails),
        ccEmails: initialVendor.ccEmails.length > 0 ? initialVendor.ccEmails : [],
        isActive: initialVendor.isActive,
      });
      return;
    }

    if (mode === "configure" && initialVendor) {
      setForm({
        displayName: initialVendor.displayName,
        toEmails: [""],
        ccEmails: [],
        isActive: true,
      });
      return;
    }

    setForm({
      displayName: "",
      toEmails: [""],
      ccEmails: [],
      isActive: true,
    });
  }, [isOpen, mode, initialVendor, presetVendorKey]);

  if (!isOpen) return null;

  const copy = MODE_COPY[mode];
  const ccRows = form.ccEmails.length > 0 ? form.ccEmails : [];
  const isConfigure = mode === "configure";
  const isEdit = mode === "edit";
  const headerIcon = isConfigure ? Settings2 : isEdit ? Pencil : Plus;
  const HeaderIcon = headerIcon;
  const headerAccent = isConfigure
    ? "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30"
    : isEdit
      ? "border-indigo-200 bg-indigo-50 dark:border-indigo-900/40 dark:bg-indigo-950/30"
      : "border-slate-200 bg-slate-50 dark:border-slate-700/60 dark:bg-slate-800/50";
  const iconAccent = isConfigure
    ? "bg-amber-600 text-white"
    : isEdit
      ? "bg-indigo-600 text-white"
      : "bg-blue-600 text-white";
  const submitAccent = isConfigure
    ? "bg-amber-600 hover:bg-amber-700"
    : "bg-blue-600 hover:bg-blue-700";

  const validateEmails = (emails: string[], label: string) => {
    const invalid = new Set<number>();
    for (let i = 0; i < emails.length; i += 1) {
      const value = emails[i].trim();
      if (value && !isValidEmail(value)) invalid.add(i);
    }
    if (invalid.size > 0) {
      return { ok: false as const, invalid, message: `Fix invalid ${label} before saving.` };
    }
    return { ok: true as const, invalid, message: null };
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setValidationError(null);

    const toCheck = validateEmails(form.toEmails, "To addresses");
    const ccCheck = validateEmails(form.ccEmails, "CC addresses");
    setInvalidToIndices(toCheck.invalid);
    setInvalidCcIndices(ccCheck.invalid);

    if (!toCheck.ok || !ccCheck.ok) {
      setValidationError(toCheck.message ?? ccCheck.message);
      return;
    }

    const toEmails = form.toEmails.map((email) => email.trim()).filter(Boolean);
    const ccEmails = form.ccEmails.map((email) => email.trim()).filter(Boolean);

    await onSubmit({
      ...form,
      displayName: form.displayName.trim(),
      toEmails,
      ccEmails,
    });
  };

  const displayError = validationError ?? error;

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`border-b px-6 py-4 ${headerAccent}`}>
          <div className="flex items-start gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconAccent}`}>
              <HeaderIcon className="h-5 w-5" strokeWidth={2.25} aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">{copy.title}</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{copy.subtitle}</p>
            </div>
          </div>
        </div>

        <form className="space-y-5 p-6" onSubmit={handleSubmit}>
          {displayError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
              {displayError}
            </div>
          ) : null}

          {isConfigure && initialVendor ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white ${vendorAvatarColor(initialVendor.vendorKey)}`}
                >
                  {vendorInitials(initialVendor.displayName)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                    From inventory
                  </p>
                  <p className="mt-0.5 text-base font-bold text-slate-900 dark:text-white">
                    {initialVendor.displayName}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                    Key: {formatVendorDisplay(initialVendor.vendorKey)}
                  </p>
                  {initialVendor.partCount > 0 ? (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                      <Package className="h-4 w-4 text-slate-400" strokeWidth={2} aria-hidden />
                      {initialVendor.partCount.toLocaleString()} part
                      {initialVendor.partCount === 1 ? "" : "s"} linked in inventory
                    </p>
                  ) : null}
                </div>
              </div>
              <p className="mt-3 text-sm text-amber-900/90 dark:text-amber-200/90">
                Add PO emails below to enable purchase order routing for this vendor.
              </p>
            </div>
          ) : null}

          {!isConfigure ? (
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">
                Vendor name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.displayName}
                onChange={(event) => setForm((prev) => ({ ...prev, displayName: event.target.value }))}
                disabled={isSaving}
                placeholder="e.g. Core & Main"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700/50 dark:text-white"
              />
            </div>
          ) : null}

          <EmailListField
            id={toFieldId}
            label="To emails"
            optional
            emails={form.toEmails}
            disabled={isSaving}
            invalidIndices={invalidToIndices}
            onChange={(toEmails) => {
              setInvalidToIndices(new Set());
              setForm((prev) => ({ ...prev, toEmails: normalizeEmailRows(toEmails) }));
            }}
          />

          {ccRows.length > 0 ? (
            <EmailListField
              id={ccFieldId}
              label="CC emails"
              optional
              allowClearAll
              emails={form.ccEmails}
              disabled={isSaving}
              invalidIndices={invalidCcIndices}
              onChange={(ccEmails) => {
                setInvalidCcIndices(new Set());
                setForm((prev) => ({ ...prev, ccEmails }));
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, ccEmails: [""] }))}
              disabled={isSaving}
              className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800/60"
            >
              <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden />
              Add CC recipients
            </button>
          )}

          {isEdit ? (
            <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                disabled={isSaving}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Active vendor
            </label>
          ) : null}

          <div className="flex gap-3 border-t border-slate-200 pt-4 dark:border-slate-700/60">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || (!isConfigure && !form.displayName.trim())}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 ${submitAccent}`}
            >
              {isSaving ? copy.saving : copy.submit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
