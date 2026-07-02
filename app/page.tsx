'use client';

import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useHasMounted } from '@/lib/hooks/useHasMounted';
import CalendarDashboard from '@/components/CalendarDashboard';
import LocationPortal from '@/components/portal/LocationPortal';
import AccessDeniedOverlay from '@/components/AccessDeniedOverlay';
import DashboardBootstrapShell, {
  useAppBootstrap,
} from '@/components/DashboardBootstrapShell';
import { softwareConfig } from '@/lib/softwareConfig';
import { usePermissions } from '@/lib/hooks/usePermissions';
import {
  canAccessCalendar,
  getFirstAccessibleAppRoute,
} from '@/lib/permissionCatalog';

function HomePageContent() {
  const router = useRouter();
  const mounted = useHasMounted();
  const { data: session, status } = useSession();
  const {
    permissions,
    isLoading: permissionsLoading,
    isDeveloper,
    isSuperAdmin,
  } = usePermissions();

  const routeContext = {
    permissions,
    isDeveloper,
    isSuperAdmin,
  };
  const canViewCalendar = canAccessCalendar(routeContext);
  const fallbackRoute = getFirstAccessibleAppRoute(routeContext);

  const { isBootstrapping } = useAppBootstrap();
  const portalEnabled = softwareConfig.portalEnabled;

  useEffect(() => {
    if (!mounted || status === 'loading') return;
    if (!portalEnabled && !session) {
      router.replace('/login');
      return;
    }
    if (isBootstrapping) return;
    if (!portalEnabled && !session) return;

    if (!canViewCalendar && fallbackRoute && fallbackRoute !== '/') {
      router.replace(fallbackRoute);
    }
  }, [
    mounted,
    status,
    isBootstrapping,
    session,
    router,
    canViewCalendar,
    fallbackRoute,
    portalEnabled,
  ]);

  if (!mounted || (status === 'loading' && !portalEnabled)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-400">
        Loading...
      </div>
    );
  }

  if (!portalEnabled && !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-400">
        Redirecting to sign in...
      </div>
    );
  }

  if (isBootstrapping && portalEnabled) {
    return <DashboardBootstrapShell message="Loading calendar..." />;
  }

  if (portalEnabled && !session) {
    return <LocationPortal />;
  }

  if (!canViewCalendar) {
    if (fallbackRoute && fallbackRoute !== '/') {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-400">
          Redirecting...
        </div>
      );
    }

    return (
      <div className="relative flex min-h-screen items-center justify-center bg-gray-50 dark:bg-slate-900">
        <AccessDeniedOverlay message="You do not have permission to access any pages. Contact an administrator." />
      </div>
    );
  }

  return <CalendarDashboard />;
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-400">
          Loading...
        </div>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}
