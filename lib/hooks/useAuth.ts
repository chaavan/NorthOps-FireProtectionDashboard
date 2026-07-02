'use client';

import { useSession } from 'next-auth/react';
import type { RoleKey } from '@/lib/roleTypes';
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

  return {
    session,
    user,
    role,
    isLoading: status === 'loading',
    isAuthenticated: status === 'authenticated',
    
    // Permission helpers - using functions from lib/authPermissions.ts
    canEdit: canEdit(role),
    canEditOverviewTab: canEditOverviewTab(role),
    canView: canView(role),
    isAdmin: isAdmin(role),
    isProjectManager: isProjectManager(role),
    isDesigner: isDesigner(role),
    isSales: isSales(role),
    isViewer: role === 'VIEWER',
    
    // Tab access permissions - using functions from lib/authPermissions.ts
    canAccessPullerTab: canAccessPullerTab(role),
    canAccessDeliveryTab: canAccessDeliveryTab(role),
    canAccessPurchaseOrderTab: canAccessPurchaseOrderTab(role),
    canAccessEstimateTab: canAccessEstimateTab(role),
    canEditDeliveryTab: canEditDeliveryTab(role),
  };
}

export function useRequireAuth(requiredRole?: RoleKey) {
  const { isAuthenticated, role, isLoading } = useAuth();

  if (isLoading) {
    return { authorized: false, loading: true };
  }

  if (!isAuthenticated) {
    return { authorized: false, loading: false };
  }

  if (!requiredRole) {
    return { authorized: true, loading: false };
  }

  const hasPermission = checkPermission(role, requiredRole);
  return { authorized: hasPermission, loading: false };
}

function checkPermission(userRole?: RoleKey, requiredRole?: RoleKey): boolean {
  if (!userRole || !requiredRole) return false;
  
  // Admin has all permissions
  if (userRole === 'ADMIN') return true;
  
  // Users can only access their own role level
  if (userRole === requiredRole) {
    return true;
  }
  
  return false;
}

