'use client';

import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import LocationPortal from '@/components/portal/LocationPortal';
import { softwareConfig } from '@/lib/softwareConfig';

function SelectPageContent() {
  const router = useRouter();

  useEffect(() => {
    if (!softwareConfig.locationSelectEnabled) {
      router.replace('/login');
    }
  }, [router]);

  if (!softwareConfig.locationSelectEnabled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-400">
        Redirecting...
      </div>
    );
  }

  return <LocationPortal />;
}

export default function SelectPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-400">
          Loading...
        </div>
      }
    >
      <SelectPageContent />
    </Suspense>
  );
}
