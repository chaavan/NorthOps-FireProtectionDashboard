"use client";

import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
import DashboardSidebar from "@/components/DashboardSidebar";
import { usePermissions } from "@/lib/hooks/usePermissions";

export function useAppBootstrap() {
  const { status } = useSession();
  const { isLoading: permissionsLoading } = usePermissions();

  const isBootstrapping =
    status === "loading" || (status === "authenticated" && permissionsLoading);

  return {
    isBootstrapping,
    isAuthenticated: status === "authenticated",
    sessionStatus: status,
  };
}

type DashboardBootstrapShellProps = {
  children?: ReactNode;
  message?: string;
};

export default function DashboardBootstrapShell({
  children,
  message = "Loading dashboard...",
}: DashboardBootstrapShellProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-slate-900">
      <DashboardSidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children ?? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{message}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function DashboardContentSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4 px-6 py-6">
      <div className="h-16 animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-700/50" />
      <div className="h-12 animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-700/40" />
      <div className="flex-1 animate-pulse rounded-xl bg-slate-200/60 dark:bg-slate-700/35" />
    </div>
  );
}
