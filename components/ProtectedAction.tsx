'use client';

import { useAuth } from '@/lib/hooks/useAuth';

interface ProtectedActionProps {
  children: React.ReactNode;
  requireEdit?: boolean;
  requireAdmin?: boolean;
  fallback?: React.ReactNode;
}

/**
 * Wrapper component that only renders children if user has required permissions
 * Use this to hide/show UI elements based on user role
 */
export default function ProtectedAction({
  children,
  requireEdit = false,
  requireAdmin = false,
  fallback = null,
}: ProtectedActionProps) {
  const { canEdit, isAdmin, isPrivileged, isLoading } = useAuth();

  if (isLoading) {
    return <>{fallback}</>;
  }

  // Check admin permission
  if (requireAdmin && !isPrivileged) {
    return <>{fallback}</>;
  }

  // Check edit permission
  if (requireEdit && !canEdit) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

