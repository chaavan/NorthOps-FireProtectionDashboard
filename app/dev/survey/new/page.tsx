"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import DashboardSidebar from "@/components/DashboardSidebar";
import AccessDeniedOverlay from "@/components/AccessDeniedOverlay";
import { usePermissions } from "@/lib/hooks/usePermissions";
import SurveyBuilder from "@/components/survey/SurveyBuilder";

export default function NewSurveyPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { isDeveloper, hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canAccessSurveyAdmin = isDeveloper || hasPermission("dev.survey.view");

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/login?callbackUrl=/dev/survey/new");
      return;
    }
  }, [router, session, status]);

  if (status === "loading" || permissionsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
        Loading...
      </div>
    );
  }

  if (!canAccessSurveyAdmin) {
    return (
      <div className="flex h-screen min-h-0 bg-slate-950 text-white">
        <DashboardSidebar />
        <main className="pointer-events-none flex min-h-0 flex-1 select-none flex-col px-4 py-4 blur-sm opacity-60 lg:px-6 lg:py-5">
          <div className="flex-1 rounded-3xl border border-white/10 bg-white/10" />
        </main>
        <AccessDeniedOverlay message="Developer access is required to create surveys." />
      </div>
    );
  }

  return (
    <div className="flex h-screen min-h-0 bg-slate-950 text-white">
      <DashboardSidebar />
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:h-screen lg:overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col px-4 py-4 lg:px-6 lg:py-5">
          <SurveyBuilder />
        </div>
      </main>
    </div>
  );
}
