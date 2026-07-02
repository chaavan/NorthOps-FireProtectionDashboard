'use client';

import { Suspense } from 'react';
import LocationPortal from '@/components/portal/LocationPortal';

export default function SelectPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-400">
          Loading...
        </div>
      }
    >
      <LocationPortal />
    </Suspense>
  );
}
