"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PermissionKey } from "@/lib/permissionCatalog";

export type EstimateEditorPermissions = {
  canEditInfo: boolean;
  canEditWorkbook: boolean;
  canEditPricing: boolean;
  canChangeStatus: boolean;
  canGeneratePdf: boolean;
  canManageVariants: boolean;
};

const readOnlyPermissions: EstimateEditorPermissions = {
  canEditInfo: false,
  canEditWorkbook: false,
  canEditPricing: false,
  canChangeStatus: false,
  canGeneratePdf: false,
  canManageVariants: false,
};

const EstimateEditorPermissionsContext =
  createContext<EstimateEditorPermissions | null>(null);

export function resolveEstimateEditorPermissions(
  hasPermission: (key: PermissionKey) => boolean,
  options?: { elevated?: boolean },
): EstimateEditorPermissions {
  const elevated = options?.elevated === true;
  return {
    canEditInfo: elevated || hasPermission("estimates.edit_info"),
    canEditWorkbook: elevated || hasPermission("estimates.edit"),
    canEditPricing: elevated || hasPermission("estimates.pricing_controls.edit"),
    canChangeStatus: elevated || hasPermission("estimates.change_status"),
    canGeneratePdf: elevated || hasPermission("estimates.pdf.generate"),
    canManageVariants: elevated || hasPermission("estimates.variants.manage"),
  };
}

export function EstimateEditorPermissionsProvider({
  value,
  children,
}: {
  value: EstimateEditorPermissions;
  children: ReactNode;
}) {
  return (
    <EstimateEditorPermissionsContext.Provider value={value}>
      {children}
    </EstimateEditorPermissionsContext.Provider>
  );
}

export function useEstimateEditorPermissions(): EstimateEditorPermissions {
  const value = useContext(EstimateEditorPermissionsContext);
  return value ?? readOnlyPermissions;
}
