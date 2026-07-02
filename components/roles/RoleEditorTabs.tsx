"use client";

import {
  estimateViewToggleActive,
  estimateViewToggleGroup,
  estimateViewToggleInactive,
} from "@/lib/estimate/estimateUi";

export type RoleEditorTab = "overview" | "permissions";

type RoleEditorTabsProps = {
  activeTab: RoleEditorTab;
  onSelect: (tab: RoleEditorTab) => void;
  permissionsDisabled?: boolean;
};

export default function RoleEditorTabs({
  activeTab,
  onSelect,
  permissionsDisabled = false,
}: RoleEditorTabsProps) {
  return (
    <div className={estimateViewToggleGroup}>
      <button
        type="button"
        onClick={() => onSelect("overview")}
        className={activeTab === "overview" ? estimateViewToggleActive : estimateViewToggleInactive}
      >
        Overview
      </button>
      <button
        type="button"
        disabled={permissionsDisabled}
        onClick={() => onSelect("permissions")}
        className={
          activeTab === "permissions"
            ? estimateViewToggleActive
            : `${estimateViewToggleInactive}${permissionsDisabled ? " opacity-50" : ""}`
        }
      >
        Permissions
      </button>
    </div>
  );
}
