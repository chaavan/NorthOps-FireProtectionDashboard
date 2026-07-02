'use client';

import Link from 'next/link';
import DashboardSidebar from '@/components/DashboardSidebar';

export const inventoryPrimaryButtonClass =
  'px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed';

export const inventorySecondaryButtonClass =
  'px-4 py-2 bg-slate-200 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600/80 rounded-xl font-semibold text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all disabled:opacity-50 disabled:cursor-not-allowed';

export const inventoryTabActiveClass =
  'bg-blue-600 text-white shadow-lg rounded-xl px-4 py-2 font-semibold text-sm transition-all';

export const inventoryTabInactiveClass =
  'bg-slate-200 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600/80 rounded-xl px-4 py-2 font-semibold text-sm hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all';

interface InventoryPageShellProps {
  title: string;
  subtitle?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  headerActions?: React.ReactNode;
  banner?: React.ReactNode;
  /** When true, the inner card scrolls (long forms/review). When false, children manage their own scroll regions. */
  contentScroll?: boolean;
  children: React.ReactNode;
}

export default function InventoryPageShell({
  title,
  subtitle,
  backHref,
  backLabel,
  headerActions,
  banner,
  contentScroll = false,
  children,
}: InventoryPageShellProps) {
  return (
    <div className="h-screen bg-slate-100 dark:bg-slate-900 flex">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="sticky top-0 z-10 bg-white dark:bg-slate-800/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700/50">
          <div className="px-6 py-4">
            {backHref && backLabel && (
              <Link
                href={backHref}
                className="text-sm text-blue-600 hover:underline dark:text-blue-400 font-medium"
              >
                ← {backLabel}
              </Link>
            )}
            <div
              className={`flex flex-wrap items-center justify-between gap-4 ${backHref ? 'mt-2' : ''}`}
            >
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">{title}</h1>
                {subtitle ? (
                  <div className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium">{subtitle}</div>
                ) : null}
              </div>
              {headerActions && (
                <div className="flex flex-wrap items-center gap-2">{headerActions}</div>
              )}
            </div>
          </div>
        </header>

        {banner}

        <main className="flex-1 flex flex-col overflow-hidden px-6 py-6 bg-slate-100 dark:bg-slate-900 min-h-0">
          <div
            className={`bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl p-6 sm:p-8 flex flex-col min-h-0 flex-1 shadow-sm dark:shadow-none ${
              contentScroll ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden'
            }`}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function InventoryLoadingSpinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
        <p className="text-slate-600 dark:text-slate-400 font-medium">{label}</p>
      </div>
    </div>
  );
}
