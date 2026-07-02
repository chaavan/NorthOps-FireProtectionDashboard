"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Calculator,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  LayoutGrid,
  Moon,
  Package,
  Plus,
  ShoppingCart,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import UserProfile from "./UserProfile";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { canAccessJobDirectory, canAccessCalendar, type PermissionKey } from "@/lib/permissionCatalog";
import { useTheme } from "@/lib/ThemeContext";
import BrandLogo from "@/components/BrandLogo";
import { softwareConfig } from "@/lib/softwareConfig";
import SurveySidebarEntry from "@/components/survey/SurveySidebarEntry";

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  children?: NavItem[];
  requireAdmin?: boolean;
  requireEstimateAccess?: boolean;
  requireInventoryAccess?: boolean;
  requireDeveloper?: boolean;
  permissionKey?: PermissionKey;
}

interface DashboardSidebarProps {
  onCollapsedChange?: (collapsed: boolean) => void;
  onBeforeNavigate?: (path: string) => boolean | Promise<boolean>;
  onBeforeLogout?: () => boolean | Promise<boolean>;
}

const SIDEBAR_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const SIDEBAR_MS = "500ms";
const NAV_ICON_PROPS = { strokeWidth: 2.25, "aria-hidden": true as const };

function splitBrandName(name: string): { primary: string; secondary: string | null } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return { primary: "TOTAL", secondary: "FIRE PROTECTION" };
  }
  if (words.length === 1) {
    return { primary: words[0].toUpperCase(), secondary: null };
  }
  return {
    primary: words[0].toUpperCase(),
    secondary: words.slice(1).join(" ").toUpperCase(),
  };
}

function SidebarFooterSection({
  collapsed,
  children,
}: {
  collapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`shrink-0 border-t border-gray-200 px-2 py-4 dark:border-slate-700 ${
        collapsed ? "flex justify-center" : ""
      }`}
    >
      {children}
    </div>
  );
}

function sidebarActionButtonClass(collapsed: boolean) {
  return `group/action flex shrink-0 items-center justify-center rounded-lg font-semibold transition-all duration-300 ease-out ${
    collapsed ? "h-10 w-10 p-0" : "w-full gap-2 px-4 py-3"
  }`;
}

function SidebarNavItem({
  label,
  active,
  collapsed,
  onClick,
  icon: Icon,
}: {
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  icon: LucideIcon;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`
        group/nav relative w-full overflow-hidden rounded-xl
        transition-all duration-300 ease-out
        ${collapsed ? "flex justify-center px-0 py-3" : "flex items-center gap-3 px-3 py-2.5"}
        ${
          active
            ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30"
            : "text-slate-600 hover:bg-slate-100/90 hover:text-slate-900 hover:shadow-md hover:shadow-slate-900/[0.06] dark:text-slate-300 dark:hover:bg-slate-700/75 dark:hover:text-white dark:hover:shadow-black/20"
        }
      `}
    >
      {!active ? (
        <span
          aria-hidden
          className="absolute inset-y-2 left-0 w-1 origin-left scale-y-0 rounded-r-full bg-blue-500 opacity-0 transition-all duration-300 ease-out group-hover/nav:scale-y-100 group-hover/nav:opacity-100"
        />
      ) : null}

      <span
        className={`
          relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg
          transition-all duration-300 ease-out
          ${
            active
              ? "bg-white/15 shadow-inner"
              : "group-hover/nav:scale-105 group-hover/nav:bg-blue-500/10 group-hover/nav:shadow-sm group-hover/nav:shadow-blue-500/10 dark:group-hover/nav:bg-blue-400/15"
          }
        `}
      >
        <Icon
          className={`h-5 w-5 shrink-0 transition-all duration-300 ease-out group-hover/nav:scale-110 ${
            active ? "text-white" : "text-current group-hover/nav:text-blue-600 dark:group-hover/nav:text-blue-400"
          }`}
          {...NAV_ICON_PROPS}
        />
      </span>

      <span
        className={`
          block min-w-0 overflow-hidden whitespace-nowrap font-semibold
          transition-all ease-[cubic-bezier(0.32,0.72,0,1)]
          ${collapsed ? "max-w-0 opacity-0" : "max-w-[12rem] opacity-100"}
        `}
        style={{ transitionDuration: SIDEBAR_MS }}
      >
        {label}
      </span>
    </button>
  );
}

export default function DashboardSidebar({
  onCollapsedChange,
  onBeforeNavigate,
  onBeforeLogout,
}: DashboardSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    hasPermission,
    permissions,
    isSuperAdmin,
    isDeveloper,
    isLoading: permissionsLoading,
  } = usePermissions();
  const { theme, toggleTheme } = useTheme();

  const [isCollapsed, setIsCollapsed] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("sidebarCollapsed");
    if (saved !== null) {
      setIsCollapsed(saved === "true");
    }
  }, []);

  useEffect(() => {
    onCollapsedChange?.(isCollapsed);
  }, [isCollapsed, onCollapsedChange]);

  const toggleSidebar = () => {
    const nextState = !isCollapsed;
    setIsCollapsed(nextState);
    localStorage.setItem("sidebarCollapsed", String(nextState));
    onCollapsedChange?.(nextState);
  };

  const navItems: NavItem[] = [
    { label: "Calendar", path: "/", icon: CalendarDays },
    { label: "Job Import", path: "/jobs", icon: ClipboardList, permissionKey: "job_import.view" },
    { label: "Inventory", path: "/parts", icon: Package },
    { label: "All Jobs", path: "/admin/jobs", icon: LayoutGrid },
    {
      label: "Vendor Orders",
      path: "/admin/orders",
      icon: ShoppingCart,
      requireAdmin: true,
    },
    {
      label: "Estimates",
      path: "/estimates",
      icon: Calculator,
      requireEstimateAccess: true,
    },
    {
      label: "Manage Users",
      path: "/admin/users",
      icon: Users,
      requireAdmin: true,
    },
    {
      label: "Survey",
      path: "/dev/survey",
      icon: ClipboardCheck,
      requireDeveloper: true,
    },
  ];

  const permissionByPath: Record<string, PermissionKey> = {
    "/jobs": "job_import.view",
    "/parts": "inventory.view",
    "/admin/jobs": "jobs.view",
    "/admin/orders": "orders.view",
    "/estimates": "estimates.view",
    "/admin/users": "users.view",
    "/dev/survey": "dev.survey.view",
  };

  const isActive = (path: string) => {
    if (path === "/") {
      return pathname === "/";
    }
    return pathname?.startsWith(path) ?? false;
  };

  const isExactPath = (path: string) => pathname === path;

  const handleNavigate = async (path: string) => {
    if (isExactPath(path)) return;
    if (onBeforeNavigate) {
      try {
        const allowed = await onBeforeNavigate(path);
        if (!allowed) return;
      } catch {
        return;
      }
    }
    router.push(path);
  };

  const brandLines = splitBrandName(softwareConfig.name);
  const navReady = !permissionsLoading;

  const sidebarTransition = { transition: `width ${SIDEBAR_MS} ${SIDEBAR_EASE}` };

  const labelRevealClass = `
    overflow-hidden whitespace-nowrap transition-all ease-[cubic-bezier(0.32,0.72,0,1)]
    ${isCollapsed ? "max-w-0 opacity-0 translate-x-1" : "max-w-[13rem] opacity-100 translate-x-0"}
  `;

  return (
    <div
      className={`flex h-dvh flex-col overflow-hidden border-r border-gray-200 bg-gradient-to-b from-gray-50 to-white shadow-2xl dark:border-slate-700 dark:from-slate-800 dark:to-slate-900 dark:text-white ${
        isCollapsed ? "w-16" : "w-[17.5rem]"
      } text-slate-900`}
      style={sidebarTransition}
    >
      {/* Logo / brand — stacked like company logo: TOTAL + FIRE PROTECTION */}
      <div
        className={`flex shrink-0 border-b border-gray-200 dark:border-slate-700 ${
          isCollapsed ? "items-center justify-center px-2 py-3" : "items-center gap-2.5 px-3 py-3"
        }`}
        style={sidebarTransition}
      >
        <BrandLogo
          src={softwareConfig.logoIconUrl}
          className={`shrink-0 object-center transition-transform duration-500 ease-out hover:scale-105 ${
            isCollapsed ? "h-8 w-auto" : "h-9 w-auto"
          }`}
        />
        <div
          className={`flex min-w-0 flex-1 flex-col justify-center overflow-hidden transition-all ease-[cubic-bezier(0.32,0.72,0,1)] ${
            isCollapsed ? "max-w-0 flex-[0] opacity-0" : "opacity-100"
          }`}
          style={{ transitionDuration: SIDEBAR_MS }}
        >
          <p className="font-serif text-[1.125rem] font-bold uppercase leading-none tracking-wide text-black dark:text-white">
            {brandLines.primary}
          </p>
          {brandLines.secondary ? (
            <p className="mt-1 font-serif text-[0.625rem] font-semibold uppercase leading-tight tracking-[0.14em] text-black dark:text-white">
              {brandLines.secondary}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={toggleSidebar}
          className={`
            shrink-0 self-center rounded-lg p-1 text-slate-500 transition-all duration-300 ease-out
            hover:scale-105 hover:bg-gray-100 hover:text-slate-800
            dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white
            ${isCollapsed ? "hidden w-0 overflow-hidden p-0 opacity-0" : ""}
          `}
          aria-label="Collapse sidebar"
        >
          <ChevronLeft className="h-4 w-4" {...NAV_ICON_PROPS} />
        </button>
      </div>

      {/* Expand control when collapsed */}
      <div
        className={`
          grid shrink-0 border-b border-gray-200 transition-all ease-[cubic-bezier(0.32,0.72,0,1)] dark:border-slate-700/50
          ${isCollapsed ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}
        `}
        style={{ transitionDuration: SIDEBAR_MS }}
      >
        <div className="overflow-hidden">
          <div className="flex justify-center py-2">
            <button
              type="button"
              onClick={toggleSidebar}
              className="rounded-lg p-2 text-slate-500 transition-all duration-300 ease-out hover:scale-110 hover:bg-gray-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
              aria-label="Expand sidebar"
            >
              <ChevronRight className="h-5 w-5" {...NAV_ICON_PROPS} />
            </button>
          </div>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-4">
        <div className="space-y-1">
          {!navReady ? (
            Array.from({ length: 7 }).map((_, index) => (
              <div
                key={`nav-skeleton-${index}`}
                className={`animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-700/45 ${
                  isCollapsed ? "mx-auto h-11 w-11" : "h-11 w-full"
                }`}
                style={{ animationDelay: `${index * 45}ms` }}
                aria-hidden
              />
            ))
          ) : (
            navItems.map((item) => {
            const permissionKey = item.permissionKey ?? permissionByPath[item.path];
            const routeContext = {
              permissions,
              isDeveloper,
              isSuperAdmin,
            };
            const canSeeAllJobs =
              isDeveloper ||
              isSuperAdmin ||
              canAccessJobDirectory(permissions);
            if (item.path === "/" && !canAccessCalendar(routeContext)) {
              return null;
            }
            if (item.path === "/admin/jobs" && !canSeeAllJobs) {
              return null;
            }
            if (item.requireDeveloper && !isDeveloper && !hasPermission("dev.survey.view")) {
              return null;
            }
            if (permissionKey && item.path !== "/admin/jobs" && !hasPermission(permissionKey)) {
              return null;
            }

            const active = isActive(item.path);
            const showChildren = !isCollapsed && active && item.children?.length;

            return (
              <div key={item.path} className="animate-fade-in">
                <SidebarNavItem
                  label={item.label}
                  active={active}
                  collapsed={isCollapsed}
                  icon={item.icon}
                  onClick={() => void handleNavigate(item.path)}
                />
                {showChildren ? (
                  <div className="mt-1 space-y-1 pl-10">
                    {item.children!.map((child) => (
                      <button
                        key={child.path}
                        type="button"
                        onClick={() => void handleNavigate(child.path)}
                        className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
                          isExactPath(child.path)
                            ? "bg-blue-500/20 text-blue-100"
                            : "text-slate-400 hover:bg-slate-700/60 hover:text-white"
                        }`}
                      >
                        {child.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
          )}
        </div>
      </nav>

      <SurveySidebarEntry collapsed={isCollapsed} />

      <SidebarFooterSection collapsed={isCollapsed}>
        <button
          type="button"
          onClick={toggleTheme}
          title={isCollapsed ? (theme === "dark" ? "Dark mode" : "Light mode") : undefined}
          className={`${sidebarActionButtonClass(isCollapsed)} hover:scale-[1.02] hover:shadow-md ${
            theme === "dark"
              ? "bg-slate-200 text-amber-600 hover:bg-slate-300 dark:bg-slate-700/50 dark:text-amber-300 dark:hover:bg-slate-700"
              : "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-slate-700/50 dark:text-amber-300 dark:hover:bg-slate-700"
          }`}
        >
          {theme === "dark" ? (
            <Moon className="h-5 w-5 shrink-0 transition-transform duration-300 group-hover/action:rotate-12" {...NAV_ICON_PROPS} />
          ) : (
            <Sun className="h-5 w-5 shrink-0 transition-transform duration-300 group-hover/action:rotate-45" {...NAV_ICON_PROPS} />
          )}
          <span className={labelRevealClass} style={{ transitionDuration: SIDEBAR_MS }}>
            {theme === "dark" ? "Dark mode" : "Light mode"}
          </span>
        </button>
      </SidebarFooterSection>

      {!navReady ? (
        <SidebarFooterSection collapsed={isCollapsed}>
          <div
            className={`animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-700/45 ${
              isCollapsed ? "h-10 w-10" : "h-11 w-full"
            }`}
            aria-hidden
          />
        </SidebarFooterSection>
      ) : (hasPermission("jobs.create") || hasPermission("job_import.upload")) ? (
        <SidebarFooterSection collapsed={isCollapsed}>
          <button
            type="button"
            onClick={() => void handleNavigate(hasPermission("jobs.create") ? "/jobs/create" : "/jobs")}
            title={isCollapsed ? (hasPermission("jobs.create") ? "Create New Job" : "Upload Job Import") : undefined}
            className={`${sidebarActionButtonClass(isCollapsed)} bg-blue-600 text-white shadow-lg shadow-blue-600/25 hover:scale-[1.03] hover:bg-blue-500 hover:shadow-xl hover:shadow-blue-600/35 active:scale-[0.98]`}
          >
            <Plus className="h-5 w-5 shrink-0 transition-transform duration-300 group-hover/action:rotate-90" {...NAV_ICON_PROPS} />
            <span className={labelRevealClass} style={{ transitionDuration: SIDEBAR_MS }}>
              {hasPermission("jobs.create") ? "Create New Job" : "Upload Job Import"}
            </span>
          </button>
        </SidebarFooterSection>
      ) : null}

      <div
        className={`min-w-0 shrink-0 border-t border-gray-200 px-2 py-4 dark:border-slate-700 ${
          isCollapsed ? "flex justify-center" : ""
        }`}
      >
        <UserProfile collapsed={isCollapsed} onBeforeLogout={onBeforeLogout} />
      </div>
    </div>
  );
}
