"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import DashboardSidebar from "@/components/DashboardSidebar";
import { ROLES_LIST_HREF } from "@/lib/roleUi";

type AdminRoleShellProps = {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  tabs?: React.ReactNode;
  children: React.ReactNode;
  onBeforeNavigate?: (path: string) => boolean | Promise<boolean>;
  onBeforeLogout?: () => boolean | Promise<boolean>;
};

export default function AdminRoleShell({
  title,
  subtitle,
  backHref = ROLES_LIST_HREF,
  backLabel = "Back to roles",
  badge,
  actions,
  tabs,
  children,
  onBeforeNavigate,
  onBeforeLogout,
}: AdminRoleShellProps) {
  const router = useRouter();

  const handleBackClick = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onBeforeNavigate) return;
    event.preventDefault();
    const allowed = await onBeforeNavigate(backHref);
    if (allowed) router.push(backHref);
  };

  return (
    <div className="flex h-screen bg-slate-100 dark:bg-slate-900">
      <DashboardSidebar onBeforeNavigate={onBeforeNavigate} onBeforeLogout={onBeforeLogout} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/95">
          <div className="px-4 py-3 sm:px-5 sm:py-4 lg:px-6">
            <Link
              href={backHref}
              onClick={handleBackClick}
              className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 sm:mb-3"
            >
              <span aria-hidden="true">←</span>
              {backLabel}
            </Link>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-xl font-bold text-slate-900 dark:text-white sm:text-2xl lg:text-3xl">
                    {title}
                  </h1>
                  {badge}
                </div>
                {subtitle ? (
                  <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
                    {subtitle}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {tabs}
                {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
              </div>
            </div>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3 sm:px-5 sm:py-4 lg:px-6 lg:py-5">
          {children}
        </main>
      </div>
    </div>
  );
}
