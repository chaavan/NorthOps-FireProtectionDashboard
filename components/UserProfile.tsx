"use client";

import { useAuth } from "@/lib/hooks/useAuth";
import {
  clearAllSnoozes,
  removeSurveyPopupDom,
} from "@/lib/survey/surveySnooze";
import { signOut } from "next-auth/react";
import { useState, useRef } from "react";

interface UserProfileProps {
  collapsed?: boolean;
  onBeforeLogout?: () => boolean | Promise<boolean>;
}

export default function UserProfile({ collapsed = false, onBeforeLogout }: UserProfileProps) {
  const { user, role, isLoading } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  if (isLoading || !user) {
    return null;
  }

  const getRoleBadgeColor = () => {
    const roleStr = role as string;
    switch (roleStr) {
      case "ADMIN":
        return "bg-gradient-danger text-white";
      case "PROJECT_MANAGER":
        return "bg-gradient-to-r from-blue-500 to-blue-600 text-white";
      case "DESIGNER":
        return "bg-gradient-to-r from-purple-500 to-purple-600 text-white";
      case "SALES":
        return "bg-gradient-to-r from-green-500 to-green-600 text-white";
      case "EDITOR":
        return "bg-gradient-to-r from-orange-500 to-orange-600 text-white";
      case "VIEWER":
        return "bg-gray-200 dark:bg-slate-600 text-gray-700 dark:text-slate-200";
      default:
        return "bg-gray-200 dark:bg-slate-600 text-gray-700 dark:text-slate-200";
    }
  };

  const handleLogout = async () => {
    if (onBeforeLogout) {
      const allowed = await onBeforeLogout();
      if (!allowed) return;
    }
    removeSurveyPopupDom();
    clearAllSnoozes();
    await signOut({ callbackUrl: "/login" });
  };

  const toggleMenu = () => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next && typeof window !== "undefined" && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const menuWidth = 260; // approximate width of the dropdown
        const menuHeight = 260; // approximate height of the dropdown
        const padding = 8;

        // Prefer opening above the button; fall back to below if not enough space.
        let top = rect.top - menuHeight - padding;
        if (top < padding) {
          top = rect.bottom + padding;
        }

        // Align to left when collapsed, to right edge of sidebar when expanded.
        let left = collapsed ? rect.left : rect.right - menuWidth;
        // Keep the menu fully within the viewport horizontally.
        left = Math.max(padding, Math.min(left, window.innerWidth - menuWidth - padding));

        setMenuPosition({ top, left });
      }
      return next;
    });
  };

  return (
    <div className="relative w-full">
      {/* User Button */}
      <button
        ref={buttonRef}
        onClick={toggleMenu}
        className={`w-full max-w-full flex items-center transition-all bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 shadow-md min-w-0 ${
          collapsed
            ? "justify-center p-2 rounded-xl"
            : "gap-3 px-4 py-2 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700/50"
        }`}
      >
        {/* Avatar */}
        <div className="w-10 h-10 flex-shrink-0 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold shadow-lg">
          {user.name?.charAt(0).toUpperCase() ||
            user.email?.charAt(0).toUpperCase()}
        </div>

        {/* User Info - Hidden when collapsed */}
        {!collapsed && (
          <div className="text-left min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
              {user.name || "User"}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate">
              {user.email}
            </p>
          </div>
        )}

        {/* Chevron */}
        {!collapsed && (
          <svg
            className={`w-4 h-4 flex-shrink-0 text-slate-500 dark:text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && menuPosition && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Menu - positioned via fixed coordinates so it is never clipped by sidebar overflow */}
          <div
            className="fixed w-64 bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700/50 rounded-xl shadow-2xl py-2 z-50 backdrop-blur-xl"
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            {/* User Info */}
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700/50">
              <p className="text-sm font-bold text-slate-900 dark:text-white">
                {user.name || "User"}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
            </div>

            {/* Role Badge */}
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700/50">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Role:
                </span>
                <span
                  className={`px-3 py-1 rounded-lg text-xs font-bold ${getRoleBadgeColor()}`}
                >
                  {role}
                </span>
              </div>
            </div>

            {/* Logout Button */}
            <div className="px-2 py-2">
              <button
                onClick={handleLogout}
                className="w-full px-4 py-2 text-left text-sm font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-xl transition-all flex items-center gap-2"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
                Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
