"use client";

type WarningConfirmModalProps = {
  isOpen: boolean;
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirming?: boolean;
};

export default function WarningConfirmModal({
  isOpen,
  title,
  message,
  detail,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  confirming = false,
}: WarningConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center px-4 py-8 sm:px-6">
        <button
          type="button"
          className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
          onClick={onCancel}
          disabled={confirming}
          aria-label="Close warning"
        />

        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="warning-confirm-title"
          aria-describedby="warning-confirm-message"
          className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-amber-200 bg-white text-left shadow-xl backdrop-blur-sm dark:border-amber-500/40 dark:bg-slate-800/95"
        >
          <div className="bg-amber-50/80 px-5 pb-4 pt-5 dark:bg-slate-800/80 sm:p-6 sm:pb-4">
            <div className="flex items-start gap-3">
              <div className="shrink-0">
                <svg
                  className="h-6 w-6 text-amber-600 dark:text-amber-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden
                >
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3
                  id="warning-confirm-title"
                  className="text-lg font-bold text-amber-900 dark:text-amber-300"
                >
                  {title}
                </h3>
                <p
                  id="warning-confirm-message"
                  className="mt-2 text-sm text-slate-700 dark:text-slate-300"
                >
                  {message}
                </p>
                {detail && (
                  <p className="mt-2 rounded-lg border border-amber-200/80 bg-white/80 px-3 py-2 text-sm font-medium text-slate-800 dark:border-amber-500/30 dark:bg-slate-900/50 dark:text-slate-200">
                    {detail}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700/50 dark:bg-slate-800/60 sm:flex-row sm:justify-end sm:px-6">
            <button
              type="button"
              onClick={onCancel}
              disabled={confirming}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirming}
              className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 text-sm font-bold text-white shadow-md shadow-amber-500/25 transition hover:from-amber-600 hover:to-amber-700 disabled:opacity-50"
            >
              {confirming ? "Working..." : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
