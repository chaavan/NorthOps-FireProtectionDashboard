"use client";

import { AlertTriangle } from "lucide-react";

type AccessDeniedOverlayProps = {
  message: string;
  className?: string;
};

export default function AccessDeniedOverlay({
  message,
  className = "",
}: AccessDeniedOverlayProps) {
  return (
    <div
      className={`fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/45 px-4 py-8 backdrop-blur-[2px] ${className}`}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="access-denied-title"
      aria-describedby="access-denied-message"
    >
      <div className="w-full max-w-sm rounded-2xl border border-slate-700/70 bg-slate-900/95 px-6 py-7 text-center shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-red-300">
          <AlertTriangle className="h-7 w-7" aria-hidden="true" />
        </div>
        <h2 id="access-denied-title" className="mt-5 text-2xl font-bold text-white">
          Access denied
        </h2>
        <p id="access-denied-message" className="mt-3 text-sm leading-6 text-slate-300">
          {message}
        </p>
      </div>
    </div>
  );
}

