"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  buildSoftwareLoginUrl,
  getSoftwareCatalog,
  type SoftwareEntry,
} from "@/lib/softwareCatalog";
import { sanitizeCallbackUrl } from "@/lib/softwareConfig";

const catalog = getSoftwareCatalog();

function SoftwareCard({
  entry,
  callbackUrl,
}: {
  entry: SoftwareEntry;
  callbackUrl: string | null;
}) {
  const router = useRouter();
  const isActive = entry.status === "active";

  const handleSelect = () => {
    if (!isActive) return;
    const target = buildSoftwareLoginUrl(entry, callbackUrl);
    if (target.startsWith("http://") || target.startsWith("https://")) {
      window.location.href = target;
      return;
    }
    router.push(target);
  };

  return (
    <button
      type="button"
      onClick={handleSelect}
      disabled={!isActive}
      className={`group relative flex w-full flex-col items-center rounded-2xl border p-6 text-left transition-all duration-300 sm:p-8 ${
        isActive
          ? "border-white/20 bg-white/80 shadow-xl backdrop-blur-xl hover:scale-[1.02] hover:border-blue-400/50 hover:shadow-2xl dark:border-slate-700/50 dark:bg-slate-800/80 dark:hover:border-blue-500/50"
          : "cursor-not-allowed border-slate-200/50 bg-white/50 opacity-70 dark:border-slate-700/30 dark:bg-slate-800/40"
      }`}
    >
      {!isActive ? (
        <span className="absolute right-4 top-4 rounded-full bg-slate-200 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          Coming soon
        </span>
      ) : null}

      <div className="relative mb-5">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 opacity-30 blur-xl transition-opacity group-hover:opacity-50" />
        <img
          src={entry.logoUrl}
          alt={entry.name}
          className="relative h-16 w-16 rounded-2xl shadow-lg ring-4 ring-white/50 dark:ring-slate-700/50 sm:h-20 sm:w-20"
        />
      </div>

      <h2 className="mb-2 text-center text-lg font-bold text-slate-900 dark:text-white sm:text-xl">
        {entry.name}
      </h2>
      <p className="text-center text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        {entry.description}
      </p>

      {isActive ? (
        <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 dark:text-blue-400">
          Open
          <svg
            className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 7l5 5m0 0l-5 5m5-5H6"
            />
          </svg>
        </span>
      ) : null}
    </button>
  );
}

export default function SoftwarePortal() {
  const searchParams = useSearchParams();
  const rawCallback = searchParams?.get("callbackUrl");
  const sanitized = rawCallback ? sanitizeCallbackUrl(rawCallback) : null;
  const safeCallback =
    sanitized && sanitized !== "/" ? sanitized : null;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-4 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="animate-float absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-blue-400/20 blur-3xl dark:bg-blue-500/10" />
        <div
          className="animate-float absolute bottom-1/4 right-1/4 h-96 w-96 rounded-full bg-indigo-400/20 blur-3xl dark:bg-indigo-500/10"
          style={{ animationDelay: "1s" }}
        />
      </div>

      <div className="relative z-10 w-full max-w-4xl">
        <div className="mb-10 text-center">
          <h1 className="mb-3 text-3xl font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent dark:from-blue-400 dark:via-indigo-400 dark:to-purple-400 sm:text-4xl">
            Select Software
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Choose the application you want to sign in to
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
          {catalog.map((entry) => (
            <SoftwareCard
              key={entry.id}
              entry={entry}
              callbackUrl={safeCallback}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
