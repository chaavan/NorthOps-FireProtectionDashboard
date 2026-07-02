"use client";

import { Suspense } from "react";
import EditRolePage from "./EditRolePageClient";

export default function EditRoleRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-slate-100 dark:bg-slate-900">
          <p className="text-slate-500">Loading role...</p>
        </div>
      }
    >
      <EditRolePage />
    </Suspense>
  );
}
