import { NextResponse } from "next/server";
import { softwareConfig } from "@/lib/softwareConfig";

export function requireRolePermissionManagementEnabled() {
  if (softwareConfig.rolePermissionManagementEnabled) {
    return { ok: true as const };
  }

  return {
    ok: false as const,
    response: NextResponse.json(
      { error: "Role permission management is disabled." },
      { status: 404 },
    ),
  };
}
