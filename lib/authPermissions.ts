import type { RoleKey } from "@/lib/roleTypes";
import { isEstimateTabEnabled } from "@/lib/featureFlags";

export function canEdit(role?: RoleKey): boolean {
  return (
    role === "ADMIN" ||
    role === "PROJECT_MANAGER" ||
    role === "SALES" ||
    role === "DESIGNER"
  );
}

export function canEditOverviewTab(role?: RoleKey): boolean {
  return role === "ADMIN" || role === "PROJECT_MANAGER";
}

export function canView(role?: RoleKey): boolean {
  return (
    role === "ADMIN" ||
    role === "PROJECT_MANAGER" ||
    role === "DESIGNER" ||
    role === "SALES" ||
    role === "EDITOR" ||
    role === "VIEWER"
  );
}

export function isAdmin(role?: RoleKey | null): boolean {
  return role === "ADMIN";
}

export function canAccessPullerTab(role?: RoleKey): boolean {
  return canView(role);
}

export function canAccessDeliveryTab(role?: RoleKey): boolean {
  return (
    role === "ADMIN" ||
    role === "PROJECT_MANAGER" ||
    role === "SALES" ||
    role === "EDITOR" ||
    role === "VIEWER"
  );
}

export function canAccessPurchaseOrderTab(role?: RoleKey): boolean {
  return role === "ADMIN";
}

export function canAccessEstimateTab(role?: RoleKey): boolean {
  return isEstimateTabEnabled() && (role === "ADMIN" || role === "SALES");
}

export function canEditDeliveryTab(role?: RoleKey): boolean {
  return (
    role === "ADMIN" ||
    role === "PROJECT_MANAGER" ||
    role === "SALES" ||
    role === "EDITOR" ||
    role === "VIEWER"
  );
}

export function isProjectManager(role?: RoleKey): boolean {
  return role === "PROJECT_MANAGER";
}

export function isDesigner(role?: RoleKey): boolean {
  return role === "DESIGNER";
}

export function isSales(role?: RoleKey): boolean {
  return role === "SALES";
}

export function canAccessInventory(role?: RoleKey): boolean {
  return role === "ADMIN" || role === "PROJECT_MANAGER";
}
