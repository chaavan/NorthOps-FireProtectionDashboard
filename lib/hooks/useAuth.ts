'use client';

import { useSession } from 'next-auth/react';
import type { RoleKey } from '@/lib/roleTypes';
import { SYSTEM_ROLE_KEYS } from '@/lib/systemRoleClient';
import { hasClientElevatedAccess } from '@/lib/clientPermissionChecks';
import {
  canEdit,
  canView,
  isAdmin,
  canAccessPullerTab,
  canAccessDeliveryTab,
  canAccessPurchaseOrderTab,
  canAccessEstimateTab,
  canEditDeliveryTab,
  isProjectManager,
  isDesigner,
  isSales,
  canEditOverviewTab,
} from '@/lib/authPermissions';

export function useAuth() {
  const { data: session, status } = useSession();
  
  const user = session?.user as any;
  const role = user?.role as RoleKey | undefined;
  const isSuperAdmin =
    user?.isSuperAdmin === true || role === SYSTEM_ROLE_KEYS.SUPER_ADMIN;
  const isDeveloper =
    user?.isDeveloper === true || role === SYSTEM_ROLE_KEYS.DEVELOPER;
  const isPrivileged = hasClientElevatedAccess({ role, isSuperAdmin, isDeveloper });

  return {
    session,
    user,
    role,
    isSuperAdmin,
    isDeveloper,
    isLoading: status === 'loading',
    isAuthenticated: status === 'authenticated',
    
    // Permission helpers - using functions from lib/authPermissions.ts
    canEdit: canEdit(role) || isPrivileged,
    canEditOverviewTab: canEditOverviewTab(role) || isPrivileged,
    canView: canView(role) || isPrivileged,
    isAdmin: isAdmin(role) || isSuperAdmin,
    isPrivileged,
    isProjectManager: isProjectManager(role),
    isDesigner: isDesigner(role),
    isSales: isSales(role),
    isViewer: role === 'VIEWER',
    
    // Tab access permissions - using functions from lib/authPermissions.ts
    canAccessPullerTab: canAccessPullerTab(role) || isPrivileged,
    canAccessDeliveryTab: canAccessDeliveryTab(role) || isPrivileged,
    canAccessPurchaseOrderTab: canAccessPurchaseOrderTab(role) || isPrivileged,
    canAccessEstimateTab: canAccessEstimateTab(role) || isPrivileged,
    canEditDeliveryTab: canEditDeliveryTab(role) || isPrivileged,
  };
}

export function useRequireAuth(requiredRole?: RoleKey) {
  const { isAuthenticated, role, isLoading, isPrivileged } = useAuth();

  if (isLoading) {
    return { authorized: false, loading: true };
  }

  if (!isAuthenticated) {
    return { authorized: false, loading: false };
  }

  if (!requiredRole) {
    return { authorized: true, loading: false };
  }

  const hasPermission = checkPermission(role, requiredRole, isPrivileged);
  return { authorized: hasPermission, loading: false };
}

function checkPermission(
  userRole?: RoleKey,
  requiredRole?: RoleKey,
  isPrivileged = false,
): boolean {
  if (!userRole || !requiredRole) return false;
  
  // Admin / Super Admin / Developer have all permissions (except dev-only survey tooling).
  if (userRole === 'ADMIN' || userRole === SYSTEM_ROLE_KEYS.SUPER_ADMIN || isPrivileged) {
    return true;
  }
  
  // Users can only access their own role level
  if (userRole === requiredRole) {
    return true;
  }
  
  return false;
}

