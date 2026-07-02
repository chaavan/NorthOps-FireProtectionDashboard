import { Suspense } from "react";
import DashboardSidebar from "@/components/DashboardSidebar";
import MaterialCatalogPage from "@/components/estimate/MaterialCatalogPage";

function MaterialCatalogLoading() {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <DashboardSidebar />
      <main className="min-w-0 flex-1 overflow-y-auto p-6 text-sm text-slate-500 dark:text-slate-400">
        Loading material catalog...
      </main>
    </div>
  );
}

export default function EstimatesMaterialCatalogRoute() {
  return (
    <Suspense fallback={<MaterialCatalogLoading />}>
      <MaterialCatalogPage />
    </Suspense>
  );
}
