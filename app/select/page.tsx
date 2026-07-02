'use client';

import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useHasMounted } from '@/lib/hooks/useHasMounted';
import LocationPortal from '@/components/portal/LocationPortal';
import { softwareConfig } from '@/lib/softwareConfig';

function SelectPageContent() {
  const router = useRouter();
  const mounted = useHasMounted();

  useEffect(() => {
    if (!mounted) return;
    if (!softwareConfig.locationSelectEnabled) {
      router.replace('/login');
    }
  }, [mounted, router]);

  if (!mounted || !softwareConfig.locationSelectEnabled) {
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
