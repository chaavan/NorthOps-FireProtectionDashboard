"use client";

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import DashboardSidebar from "@/components/DashboardSidebar";
import { ChevronRight, Printer } from "lucide-react";
import { canAccessJobDirectory } from "@/lib/permissionCatalog";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { formatDateInAppTimeZone } from "@/lib/timezone";
import {
  getDefaultCalendarUiState,
  loadCalendarUiSnapshot,
  saveCalendarUiSnapshot,
  type CalendarJobTypeFilter,
  type CalendarStatusFilter,
  type CalendarViewMode,
} from "@/lib/calendarClientState";

type StatusFilter = CalendarStatusFilter;
type JobTypeFilter = CalendarJobTypeFilter;

type CalendarJob = {
  calendarEventId?: string;
  jobNumber: string;
  jobName: string;
  listNumber: string | null;
  area: string | null;
  date: string;
  lineCount: number;
  pulledCount: number;
  dateType: "ship" | "delivery";
  status:
    | "white"
    | "green"
    | "yellow"
    | "orange"
    | "pink"
    | "lime"
    | "blue"
    | "not-processed"
    | "delivery-only"
    | "purple"
    | "darker-blue"
    | "delivered";
  allDelivered: boolean;
  isServiceJob?: boolean;
  isDeliveryOnly?: boolean;
  purchaseOrderAccountedFor?: boolean;
};

type CalendarDeliveryEvent = {
  id: string;
  title: string;
  date: string;
  notes?: string | null;
  createdBy?: string | null;
};

interface DayJobsListProps {
  jobs: Array<Pick<CalendarJob, "calendarEventId" | "jobNumber" | "jobName" | "listNumber" | "area" | "status" | "allDelivered" | "isServiceJob" | "isDeliveryOnly" | "purchaseOrderAccountedFor">>;
  isToday: boolean;
  onDeleteDeliveryOnly?: (eventId: string) => void;
}

function DayJobsList({ jobs, isToday, onDeleteDeliveryOnly }: DayJobsListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(jobs.length);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    let rafId: number | null = null;

    const calculateVisibleJobs = () => {
      if (!containerRef.current) return;

      // Get the parent container (the date cell)
      const dateCell = containerRef.current.closest(
        "[class*='rounded-lg'][class*='cursor-pointer']",
      ) as HTMLElement;
      if (!dateCell) return;

      // Get available height for jobs (date cell minus date + badge row)
      const dateCellHeight = dateCell.clientHeight;
      const headerRow = dateCell.firstElementChild as HTMLElement;
      const dateNumberHeight = headerRow ? headerRow.offsetHeight + 8 : 40; // header row + margin
      const availableHeight = Math.max(
        0,
        dateCellHeight - dateNumberHeight - 8,
      );

      // Indicator height - compact for small screens
      const indicatorHeight = 18;

      // Get all job elements that are currently rendered
      const jobElements = Array.from(
        containerRef.current.children,
      ) as HTMLElement[];
      if (jobElements.length === 0 && jobs.length > 0) {
        // Jobs haven't rendered yet, estimate based on job count - always show at least 1
        const estimatedJobHeight = 20; // Compact height per job
        const maxVisible = Math.floor(
          (availableHeight - indicatorHeight) / estimatedJobHeight,
        );
        if (maxVisible < jobs.length) {
          setHasOverflow(true);
          setVisibleCount(Math.max(1, maxVisible));
        } else {
          setHasOverflow(false);
          setVisibleCount(jobs.length);
        }
        return;
      }

      if (jobElements.length === 0) {
        setHasOverflow(false);
        setVisibleCount(0);
        return;
      }

      // Measure actual job heights and calculate what fits
      let totalHeight = 0;
      let visible = 0;

      for (let i = 0; i < jobElements.length; i++) {
        const jobElement = jobElements[i];
        const jobHeight = jobElement.offsetHeight || 22;

        // Check if adding this job + indicator would fit
        const neededHeight =
          totalHeight +
          jobHeight +
          (i < jobElements.length - 1 ? indicatorHeight : 0);

        if (neededHeight <= availableHeight) {
          totalHeight += jobHeight;
          visible = i + 1;
        } else {
          break;
        }
      }

      // Always show at least 1 job when we have jobs
      if (visible === 0 && jobs.length > 0) {
        visible = 1;
      }

      // Update state
      if (visible < jobs.length) {
        setHasOverflow(true);
        setVisibleCount(Math.max(1, visible));
      } else {
        setHasOverflow(false);
        setVisibleCount(jobs.length);
      }

      // Recalculate with actual indicator height after it renders
      if (visible < jobs.length) {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(() => {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
          timeoutId = setTimeout(() => {
            if (indicatorRef.current && containerRef.current) {
              const actualIndicatorHeight =
                indicatorRef.current.offsetHeight || indicatorHeight;
              const jobElements = Array.from(
                containerRef.current.children,
              ) as HTMLElement[];
              let recalcTotal = 0;
              let recalcVisible = 0;

              for (let i = 0; i < jobElements.length; i++) {
                const jobElement = jobElements[i];
                const jobHeight = jobElement.offsetHeight || 22;
                const neededHeight =
                  recalcTotal + jobHeight + actualIndicatorHeight;

                if (neededHeight <= availableHeight) {
                  recalcTotal += jobHeight;
                  recalcVisible = i + 1;
                } else {
                  break;
                }
              }

              if (recalcVisible !== visible) {
                setVisibleCount(Math.max(1, recalcVisible));
              }
            }
          }, 50);
        });
      }
    };

    // Initial calculation
    calculateVisibleJobs();

    // Debounced recalculation after DOM updates
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(calculateVisibleJobs, 100);

    // Debounced resize listener (single for all cells, not per-cell observers)
    let resizeTimeoutId: NodeJS.Timeout | null = null;
    const handleResize = () => {
      if (resizeTimeoutId !== null) {
        clearTimeout(resizeTimeoutId);
      }
      resizeTimeoutId = setTimeout(calculateVisibleJobs, 200);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      if (resizeTimeoutId !== null) {
        clearTimeout(resizeTimeoutId);
      }
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      window.removeEventListener("resize", handleResize);
    };
  }, [jobs.length]);

  const getStatusBgColor = (
    status: string,
    allDelivered?: boolean,
    isServiceJob?: boolean,
    isDeliveryOnly?: boolean,
  ) => {
    if (isDeliveryOnly) {
      return "bg-cyan-600 text-white";
    }

    // Service jobs: gradient from purple (left) to status color (right)
    if (isServiceJob) {
      if (status === "delivered" || allDelivered) {
        return "bg-gradient-to-r from-purple-500/80 from-[15%] to-slate-700/85 text-slate-100 opacity-65";
      }
      switch (status) {
        case "not-processed":
          return "bg-gradient-to-r from-purple-600 from-[15%] to-red-600 text-white";
        case "green":
          return "bg-gradient-to-r from-purple-600 from-[15%] to-green-600 text-white";
        case "orange":
          return "bg-gradient-to-r from-purple-600 from-[15%] to-orange-500 text-white";
        case "pink":
          return "bg-gradient-to-r from-purple-600 from-[15%] to-pink-600 text-white";
        case "lime":
          return "bg-gradient-to-r from-purple-600 from-[15%] to-fuchsia-600 text-white";
        case "yellow":
          return "bg-gradient-to-r from-purple-600 from-[15%] to-yellow-500 text-white";
        case "blue":
          return "bg-gradient-to-r from-purple-600 from-[15%] to-blue-600 text-white";
        case "white":
        case "purple":
        case "darker-blue":
        default:
          return "bg-gradient-to-r from-purple-600 from-[15%] to-gray-500/80 text-white";
      }
    }

    // Non-service jobs: solid colors
    if (status === "delivered" || allDelivered) {
      return "bg-slate-700/85 text-slate-100 opacity-65";
    }

    switch (status) {
      case "not-processed":
        return "bg-red-600 text-white";
      case "white":
        return "bg-gray-500/80 text-gray-50";
      case "green":
        return "bg-green-600 text-white";
      case "yellow":
        return "bg-yellow-500 text-white";
      case "orange":
        return "bg-orange-500 text-white";
      case "pink":
        return "bg-pink-600 text-white";
      case "blue":
        return "bg-blue-600 text-white";
      case "purple":
        return "bg-purple-600 text-white";
      case "darker-blue": // Legacy support - map to purple
        return "bg-purple-600 text-white";
      default:
        return "bg-gray-500/80 text-gray-50";
    }
  };

  const hiddenCount = hasOverflow ? jobs.length - visibleCount : 0;
  const visibleJobs = hasOverflow ? jobs.slice(0, visibleCount) : jobs;

  return (
    <div className="flex-1 flex flex-col gap-0.5 overflow-hidden min-h-0 relative">
      {/* Jobs container - NO scrollbar, only show what fits */}
      <div ref={containerRef} className="flex-1 min-h-0 pr-0.5 overflow-hidden">
        {visibleJobs.map((job, idx) => (
          <div
            key={`${job.jobNumber}-${idx}`}
            className={`rounded px-1.5 py-0.5 mb-0.5 font-semibold truncate shadow-sm flex items-center gap-1 min-w-0 leading-tight ${getStatusBgColor(job.status, job.allDelivered, job.isServiceJob, job.isDeliveryOnly)}`}
            style={{ fontSize: "var(--calendar-job-font)" }}
            title={`${job.area || "No Area"} | ${job.jobName} | List #${job.listNumber || "-"} | Job #${job.jobNumber}${job.allDelivered ? " (Delivered)" : ""}${job.purchaseOrderAccountedFor ? " | PO accounted for" : ""}`}
          >
            <span className="truncate flex-1 min-w-0 flex items-center gap-0.5">
              {job.purchaseOrderAccountedFor ? (
                <span
                  className="flex-shrink-0 text-amber-300 drop-shadow-sm"
                  title="Purchase order accounted for"
                  aria-label="Purchase order accounted for"
                >
                  ★
                </span>
              ) : null}
              <span className="truncate">{job.jobNumber}</span>
            </span>
            {job.isDeliveryOnly && job.calendarEventId && onDeleteDeliveryOnly && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteDeliveryOnly(job.calendarEventId!);
                }}
                className="inline-flex items-center justify-center w-4 h-4 rounded bg-black/20 hover:bg-black/35 text-white/95"
                title="Delete delivery-only event"
                aria-label="Delete delivery-only event"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 7h12M9 7V5h6v2m-7 0 1 12h6l1-12" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>
      {/* Show "+X more" indicator when there are hidden jobs */}
      {hasOverflow && hiddenCount > 0 && (
        <div
          ref={indicatorRef}
          className={`font-bold text-center px-1.5 py-0.5 flex-shrink-0 border-t border-gray-300 dark:border-slate-600/40 text-xs leading-tight ${
            isToday
              ? "text-amber-800 dark:text-blue-100 bg-amber-100/50 dark:bg-blue-500/20"
              : "text-slate-800 dark:text-slate-200 bg-slate-200/50 dark:bg-slate-600/40"
          }`}
        >
          +{hiddenCount} more
        </div>
      )}
    </div>
  );
}

interface WeekGridProps {
  weekDates: Date[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  getJobsForDate: (date: Date) => CalendarJob[];
  onJobClick: (jobNumber: string, listNumber?: string | null) => void;
  onDeleteDeliveryOnly?: (eventId: string) => void;
  getStatusColor: (status: CalendarJob["status"], allDelivered?: boolean, isServiceJob?: boolean, isDeliveryOnly?: boolean) => string;
  toDateKey: (date: Date) => string;
  weekLabel?: string;
}

const WORKWEEK_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

function toWorkdayIndex(dayOfWeek: number): number {
  // JS day: 0=Sun, 1=Mon, ... 6=Sat
  // Workday index: Mon=0 ... Fri=4
  if (dayOfWeek === 0 || dayOfWeek === 6) return 0;
  return dayOfWeek - 1;
}

function toNearestWorkday(date: Date): Date {
  const normalized = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    12,
    0,
    0,
  );
  const day = normalized.getDay();
  if (day === 0) {
    // Sunday -> Monday
    normalized.setDate(normalized.getDate() + 1);
  } else if (day === 6) {
    // Saturday -> Friday
    normalized.setDate(normalized.getDate() - 1);
  }
  return normalized;
}

function WeekGrid({
  weekDates,
  selectedDate,
  onSelectDate,
  getJobsForDate,
  onJobClick,
  onDeleteDeliveryOnly,
  getStatusColor,
  toDateKey,
  weekLabel,
}: WeekGridProps) {
  const isSameDate = (a: Date, b: Date) => toDateKey(a) === toDateKey(b);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {weekLabel && (
        <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5 flex-shrink-0">
          {weekLabel}
        </div>
      )}
      <div
        className="grid grid-cols-5 flex-1 min-h-0 min-w-0"
        style={{ gridTemplateRows: "1fr", gap: "var(--calendar-gap)" }}
      >
        {weekDates.map((date) => {
          const dayJobs = getJobsForDate(date);
          const isToday = isSameDate(date, new Date());
          const isSelected = isSameDate(date, selectedDate);

          return (
            <div
              key={toDateKey(date)}
              onClick={() => onSelectDate(date)}
              className={`border rounded-xl flex flex-col min-h-0 overflow-hidden transition-all cursor-pointer ${
                isToday
                  ? "bg-amber-50 dark:bg-blue-600/30 border-amber-300 dark:border-blue-500/60 shadow-lg shadow-amber-200/50 dark:shadow-blue-500/20"
                  : isSelected
                    ? "bg-gray-200 dark:bg-slate-700/70 border-gray-300 dark:border-slate-500/70"
                    : "bg-gray-100 dark:bg-slate-700/40 border-gray-200 dark:border-slate-600/40 hover:border-gray-300 dark:hover:border-slate-500/60 hover:bg-gray-200 dark:hover:bg-slate-700/60"
              }`}
            >
              <div
                className={`sticky top-0 z-10 border-b border-gray-200/80 dark:border-slate-600/50 px-3.5 py-2.5 ${
                  isToday
                    ? "bg-amber-100/95 dark:bg-blue-700/50"
                    : "bg-white/95 dark:bg-slate-800/80"
                }`}
              >
                <p
                  className="font-bold text-slate-700 dark:text-slate-300 leading-tight tracking-tight"
                  style={{ fontSize: "var(--calendar-weekday-font)" }}
                >
                  {formatDateInAppTimeZone(date, { weekday: "short" })}
                </p>
                <p
                  className={`font-bold leading-tight mt-0.5 ${
                    isToday
                      ? "text-amber-700 dark:text-blue-200"
                      : "text-slate-900 dark:text-white"
                  }`}
                  style={{ fontSize: "var(--calendar-date-font)" }}
                >
                  {formatDateInAppTimeZone(date, { month: "short", day: "numeric" })}
                </p>
              </div>
              <div
                className="calendar-scroll flex-1 min-h-0 overflow-y-auto space-y-2"
                style={{ padding: "var(--calendar-cell-padding)" }}
              >
                {dayJobs.length === 0 ? (
                  <p
                    className="text-slate-500 dark:text-slate-400 px-1 py-1"
                    style={{ fontSize: "var(--calendar-job-detail-font)" }}
                  >
                    No jobs
                  </p>
                ) : (
                  dayJobs.map((job) => (
                    <div
                      key={`${job.jobNumber}-${job.listNumber || "1"}-${job.dateType}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (job.isDeliveryOnly) return;
                        onJobClick(job.jobNumber, job.listNumber);
                      }}
                      className={`rounded-md px-2.5 py-2 border shadow-sm min-w-0 ${getStatusColor(job.status, job.allDelivered, job.isServiceJob, job.isDeliveryOnly)}`}
                      style={{ fontSize: "var(--calendar-job-font)" }}
                      title={
                        job.isDeliveryOnly
                          ? `Delivery-only | ${job.jobName}${job.area ? ` | ${job.area}` : ""}`
                          : `${job.area || "No Area"} | ${job.jobName} | List #${job.listNumber || "-"} | Job #${job.jobNumber}${job.allDelivered ? " (Delivered)" : ""}${job.purchaseOrderAccountedFor ? " | PO accounted for" : ""}`
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold truncate flex-1 min-w-0 flex items-center gap-1" style={{ fontSize: "var(--calendar-job-font)" }}>
                          {job.purchaseOrderAccountedFor ? (
                            <span
                              className="flex-shrink-0 text-amber-200 drop-shadow-sm"
                              title="Purchase order accounted for"
                              aria-label="Purchase order accounted for"
                            >
                              ★
                            </span>
                          ) : null}
                          <span className="truncate">{job.jobName}</span>
                        </p>
                        {job.isDeliveryOnly && job.calendarEventId && onDeleteDeliveryOnly && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteDeliveryOnly(job.calendarEventId!);
                            }}
                            className="inline-flex items-center justify-center w-5 h-5 rounded bg-black/20 hover:bg-black/35 text-white/95 flex-shrink-0"
                            title="Delete delivery-only event"
                            aria-label="Delete delivery-only event"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 7h12M9 7V5h6v2m-7 0 1 12h6l1-12" />
                            </svg>
                          </button>
                        )}
                      </div>
                      <p className="opacity-90 truncate" style={{ fontSize: "var(--calendar-job-detail-font)" }}>
                        {job.area || "No Area"}
                      </p>
                      {job.isDeliveryOnly ? (
                        <p className="opacity-90 truncate" style={{ fontSize: "var(--calendar-job-detail-font)" }}>
                          Delivery-only event
                        </p>
                      ) : (
                        <p className="opacity-90 truncate" style={{ fontSize: "var(--calendar-job-detail-font)" }}>
                          List #{job.listNumber || "-"} | Job #{job.jobNumber}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CalendarDashboard() {
  const router = useRouter();
  const { permissions, isLoading: isPermissionsLoading, isSuperAdmin, isDeveloper } =
    usePermissions();
  const defaultUiState = getDefaultCalendarUiState();
  const [uiReady, setUiReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(defaultUiState.selectedDate);
  const [currentMonth, setCurrentMonth] = useState(defaultUiState.currentMonth);
  const [viewMode, setViewMode] = useState<CalendarViewMode>(defaultUiState.viewMode);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(defaultUiState.statusFilter);
  const [jobTypeFilter, setJobTypeFilter] = useState<JobTypeFilter>(
    defaultUiState.jobTypeFilter,
  );

  const canAccessJobs =
    isDeveloper || isSuperAdmin || canAccessJobDirectory(permissions);
  const canViewContractJobs =
    isDeveloper || isSuperAdmin || permissions["jobs.view_contract_jobs"] === true;
  const canViewServiceJobs =
    isDeveloper || isSuperAdmin || permissions["jobs.view_service_jobs"] === true;
  const isAccessDenied = !isPermissionsLoading && !canAccessJobs;
  const contractJobsOnly =
    !isPermissionsLoading && canViewContractJobs && !canViewServiceJobs;
  const serviceJobsOnly =
    !isPermissionsLoading && canViewServiceJobs && !canViewContractJobs;

  useEffect(() => {
    if (contractJobsOnly && jobTypeFilter !== "contract") {
      setJobTypeFilter("contract");
    } else if (serviceJobsOnly && jobTypeFilter !== "service") {
      setJobTypeFilter("service");
    }
  }, [contractJobsOnly, jobTypeFilter, serviceJobsOnly]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const saved = loadCalendarUiSnapshot();
    if (!saved) return;

    setSelectedDate((prev) =>
      prev.getTime() === saved.selectedDate.getTime() ? prev : saved.selectedDate,
    );
    setCurrentMonth((prev) =>
      prev.getTime() === saved.currentMonth.getTime() ? prev : saved.currentMonth,
    );
    setViewMode((prev) => (prev === saved.viewMode ? prev : saved.viewMode));
    setStatusFilter((prev) => (prev === saved.statusFilter ? prev : saved.statusFilter));
    setJobTypeFilter((prev) => (prev === saved.jobTypeFilter ? prev : saved.jobTypeFilter));
  }, []);

  useEffect(() => {
    setUiReady(true);
  }, []);

  useEffect(() => {
    if (!uiReady) return;
    saveCalendarUiSnapshot({
      viewMode,
      selectedDate,
      currentMonth,
      statusFilter,
      jobTypeFilter: contractJobsOnly
        ? "contract"
        : serviceJobsOnly
          ? "service"
          : jobTypeFilter,
    });
  }, [uiReady, viewMode, selectedDate, currentMonth, statusFilter, jobTypeFilter, contractJobsOnly, serviceJobsOnly]);

  // Calendar data: jobs grouped by date
  const [calendarData, setCalendarData] = useState<Record<string, CalendarJob[]>>({});
  const [deliveryOnlyEvents, setDeliveryOnlyEvents] = useState<CalendarDeliveryEvent[]>([]);

  // Load calendar data
  const loadCalendarData = async () => {
    if (isPermissionsLoading) return;
    if (isAccessDenied) {
      setCalendarData({});
      setDeliveryOnlyEvents([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const [jobsResponse, eventsResponse] = await Promise.all([
        fetch("/api/jobs/calendar"),
        fetch("/api/calendar/events"),
      ]);
      if (jobsResponse.status === 401 || eventsResponse.status === 401) {
        await signOut({ callbackUrl: "/login" });
        return;
      }
      if (!jobsResponse.ok) {
        throw new Error("Failed to load calendar data");
      }
      if (!eventsResponse.ok) {
        throw new Error("Failed to load delivery-only events");
      }
      const data = await jobsResponse.json();
      const eventsData = await eventsResponse.json();
      if (process.env.NODE_ENV === "development") {
        console.log(
          "Calendar data loaded:",
          Object.keys(data.calendarData || {}).length,
          "dates with jobs",
        );
      }
      setCalendarData(data.calendarData || {});
      setDeliveryOnlyEvents(eventsData.events || []);
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.error("Error loading calendar data:", err);
      }
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadCalendarData();
  }, [isPermissionsLoading, isAccessDenied]);

  // Refetch when tab becomes visible (e.g. user returns after editing job delivery date elsewhere)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadCalendarData();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isPermissionsLoading, isAccessDenied]);

  const handleDeleteDeliveryOnly = async (eventId: string) => {
    const confirmed = window.confirm("Delete this delivery-only event?");
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/calendar/events?id=${encodeURIComponent(eventId)}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Failed to delete delivery-only event");
      }
      await loadCalendarData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Calendar helpers
  const toDateKey = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const isSameDate = (a: Date, b: Date): boolean => toDateKey(a) === toDateKey(b);

  const getStartOfWeek = (date: Date): Date => {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
    const dayOfWeek = start.getDay(); // 0=Sun, 1=Mon
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    start.setDate(start.getDate() + diffToMonday);
    return start;
  };

  const getWeekDates = (anchorDate: Date): Date[] => {
    const startOfWeek = getStartOfWeek(anchorDate);
    return Array.from({ length: 5 }, (_, idx) => {
      const day = new Date(startOfWeek);
      day.setDate(startOfWeek.getDate() + idx);
      return day;
    });
  };

  const weekDates = getWeekDates(selectedDate);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[4];

  const getBiWeekDates = (anchorDate: Date): Date[][] => {
    const week1 = getWeekDates(anchorDate);
    // Start week 2 from the following Monday (week 1 Monday + 7 days).
    // Using week-end + 1 day can land on Saturday and get normalized back
    // to the same Monday, duplicating week 1 in the biweek view.
    const week1Start = week1[0];
    const week2Start = new Date(
      week1Start.getFullYear(),
      week1Start.getMonth(),
      week1Start.getDate() + 7,
      12,
      0,
      0,
    );
    const week2 = getWeekDates(week2Start);
    return [week1, week2];
  };

  const biWeekDates = getBiWeekDates(selectedDate);
  const biWeekStart = biWeekDates[0][0];
  const biWeekEnd = biWeekDates[1][4];

  const biWeekRangeLabel = (() => {
    const start = biWeekStart;
    const end = biWeekEnd;
    const sameYear = start.getFullYear() === end.getFullYear();
    const sameMonth = start.getMonth() === end.getMonth() && sameYear;
    if (sameMonth) {
      return `${formatDateInAppTimeZone(start, { month: "short", day: "numeric" })} - ${formatDateInAppTimeZone(end, { day: "numeric" })}, ${formatDateInAppTimeZone(end, { year: "numeric" })}`;
    }
    if (sameYear) {
      return `${formatDateInAppTimeZone(start, { month: "short", day: "numeric" })} - ${formatDateInAppTimeZone(end, { month: "short", day: "numeric", year: "numeric" })}`;
    }
    return `${formatDateInAppTimeZone(start, { month: "short", day: "numeric", year: "numeric" })} - ${formatDateInAppTimeZone(end, { month: "short", day: "numeric", year: "numeric" })}`;
  })();

  const formatWeekLabel = (start: Date, end: Date): string => {
    const sameYear = start.getFullYear() === end.getFullYear();
    const sameMonth = start.getMonth() === end.getMonth() && sameYear;
    if (sameMonth) {
      return `${formatDateInAppTimeZone(start, { month: "short", day: "numeric" })} - ${formatDateInAppTimeZone(end, { day: "numeric" })}, ${formatDateInAppTimeZone(end, { year: "numeric" })}`;
    }
    if (sameYear) {
      return `${formatDateInAppTimeZone(start, { month: "short", day: "numeric" })} - ${formatDateInAppTimeZone(end, { month: "short", day: "numeric", year: "numeric" })}`;
    }
    return `${formatDateInAppTimeZone(start, { month: "short", day: "numeric", year: "numeric" })} - ${formatDateInAppTimeZone(end, { month: "short", day: "numeric", year: "numeric" })}`;
  };

  const weekRangeLabel = (() => {
    const sameYear = weekStart.getFullYear() === weekEnd.getFullYear();
    const sameMonth = weekStart.getMonth() === weekEnd.getMonth() && sameYear;
    if (sameMonth) {
      return `${formatDateInAppTimeZone(weekStart, { month: "short", day: "numeric" })} - ${formatDateInAppTimeZone(weekEnd, { day: "numeric" })}, ${formatDateInAppTimeZone(weekEnd, { year: "numeric" })}`;
    }
    if (sameYear) {
      return `${formatDateInAppTimeZone(weekStart, { month: "short", day: "numeric" })} - ${formatDateInAppTimeZone(weekEnd, { month: "short", day: "numeric", year: "numeric" })}`;
    }
    return `${formatDateInAppTimeZone(weekStart, { month: "short", day: "numeric", year: "numeric" })} - ${formatDateInAppTimeZone(weekEnd, { month: "short", day: "numeric", year: "numeric" })}`;
  })();

  // Use local date to avoid timezone issues - create date at noon to avoid timezone shifts
  const firstDayOfMonth = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth(),
    1,
    12,
    0,
    0,
  );
  const lastDayOfMonth = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth() + 1,
    0,
    12,
    0,
    0,
  );
  const daysInMonth = lastDayOfMonth.getDate();
  const monthWorkdayDates = Array.from({ length: daysInMonth })
    .map(
      (_, i) =>
        new Date(
          currentMonth.getFullYear(),
          currentMonth.getMonth(),
          i + 1,
          12,
          0,
          0,
        ),
    )
    .filter((d) => d.getDay() !== 0 && d.getDay() !== 6);
  const monthWorkdayCount = monthWorkdayDates.length;
  const monthFirstWorkday = monthWorkdayDates[0] || firstDayOfMonth;
  const monthStartOffset = toWorkdayIndex(monthFirstWorkday.getDay());
  const monthTotalCells = Math.ceil((monthStartOffset + monthWorkdayCount) / 5) * 5;
  const monthTrailingCells = monthTotalCells - (monthStartOffset + monthWorkdayCount);

  const previousMonth = () => {
    if (viewMode === "month") {
      setCurrentMonth(
        new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1),
      );
      return;
    }
    const daysToMove = viewMode === "biweek" ? 14 : 7;
    const nextSelectedDate = new Date(selectedDate);
    nextSelectedDate.setDate(selectedDate.getDate() - daysToMove);
    setSelectedDate(nextSelectedDate);
    setCurrentMonth(
      new Date(nextSelectedDate.getFullYear(), nextSelectedDate.getMonth(), 1),
    );
  };

  const nextMonth = () => {
    if (viewMode === "month") {
      setCurrentMonth(
        new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1),
      );
      return;
    }
    const daysToMove = viewMode === "biweek" ? 14 : 7;
    const nextSelectedDate = new Date(selectedDate);
    nextSelectedDate.setDate(selectedDate.getDate() + daysToMove);
    setSelectedDate(nextSelectedDate);
    setCurrentMonth(
      new Date(nextSelectedDate.getFullYear(), nextSelectedDate.getMonth(), 1),
    );
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(toNearestWorkday(today));
  };

  const isDateInCurrentMonth = (date: Date): boolean =>
    date.getFullYear() === currentMonth.getFullYear() &&
    date.getMonth() === currentMonth.getMonth();

  const isDateWithinRange = (date: Date, start: Date, end: Date): boolean => {
    const key = toDateKey(date);
    return key >= toDateKey(start) && key <= toDateKey(end);
  };

  const todayAnchor = new Date();
  todayAnchor.setHours(12, 0, 0, 0);

  const isViewingToday = (() => {
    if (viewMode === "month") {
      return isDateInCurrentMonth(todayAnchor);
    }
    if (viewMode === "week") {
      return toDateKey(getStartOfWeek(selectedDate)) === toDateKey(getStartOfWeek(todayAnchor));
    }
    return isDateWithinRange(todayAnchor, biWeekStart, biWeekEnd);
  })();

  const handleViewModeChange = (mode: CalendarViewMode) => {
    if ((mode === "week" || mode === "biweek") && viewMode === "month") {
      const anchorDate = isDateInCurrentMonth(selectedDate)
        ? selectedDate
        : new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1, 12, 0, 0);
      setSelectedDate(toNearestWorkday(anchorDate));
    }
    setViewMode(mode);
  };

  const sortJobsAlphabetically = (jobs: CalendarJob[]): CalendarJob[] => {
    const compareOptions: Intl.CollatorOptions = {
      numeric: true,
      sensitivity: "base",
    };

    return [...jobs].sort((a, b) => {
      const nameCompare = (a.jobName || "").trim().localeCompare(
        (b.jobName || "").trim(),
        undefined,
        compareOptions,
      );
      if (nameCompare !== 0) return nameCompare;

      const jobNumberCompare = (a.jobNumber || "").localeCompare(
        b.jobNumber || "",
        undefined,
        compareOptions,
      );
      if (jobNumberCompare !== 0) return jobNumberCompare;

      return (a.listNumber || "").localeCompare(
        b.listNumber || "",
        undefined,
        compareOptions,
      );
    });
  };

  // Get jobs for a specific date (service scope first, then status filter)
  const getJobsForDate = (date: Date): CalendarJob[] => {
    const dateStr = toDateKey(date);
    const jobs = calendarData[dateStr] || [];
    const deliveryOnlyForDate: CalendarJob[] = deliveryOnlyEvents
      .filter((evt) => toDateKey(new Date(evt.date)) === dateStr)
      .map((evt) => ({
        calendarEventId: evt.id,
        jobNumber: "DELIVERY-ONLY",
        jobName: evt.title,
        listNumber: null,
        area: evt.notes || "Delivery-only",
        date: dateStr,
        lineCount: 0,
        pulledCount: 0,
        dateType: "delivery",
        status: "delivery-only",
        allDelivered: false,
        isServiceJob: false,
        isDeliveryOnly: true,
      }));
    const combined = [...jobs, ...deliveryOnlyForDate];

    const serviceScopedJobs = combined.filter((job) => {
      if (jobTypeFilter === "all") return true;
      if (jobTypeFilter === "service") return job.isServiceJob === true;
      return job.isServiceJob !== true;
    });

    const filteredJobs =
      statusFilter === "all"
        ? serviceScopedJobs
        : serviceScopedJobs.filter((job) => {
            if (statusFilter === "delivered") {
              return job.status === "delivered" || job.allDelivered;
            }
            // For specific status filters, exclude delivered jobs (allDelivered)
            if (job.allDelivered) return false;
            return job.status === statusFilter;
          });

    return sortJobsAlphabetically(filteredJobs);
  };

  // Get color class based on status
  const getStatusColor = (
    status:
      | "white"
      | "green"
      | "yellow"
      | "orange"
      | "pink"
      | "lime"
      | "blue"
      | "not-processed"
      | "delivery-only"
      | "purple"
      | "darker-blue"
      | "delivered",
    allDelivered?: boolean,
    isServiceJob?: boolean,
    isDeliveryOnly?: boolean,
  ): string => {
    if (isDeliveryOnly) {
      return "bg-cyan-600 text-white border-cyan-700";
    }

    // Service jobs: gradient from purple (left) to status color (right)
    if (isServiceJob) {
      if (status === "delivered" || allDelivered) {
        return "bg-gradient-to-r from-purple-500/80 from-[15%] to-slate-700/85 text-slate-100 border-purple-500/30 opacity-65";
      }
      switch (status) {
        case "not-processed":
          return "bg-gradient-to-r from-purple-600 from-[15%] to-red-600 text-white border-purple-600/50";
        case "green":
          return "bg-gradient-to-r from-purple-600 from-[15%] to-green-600 text-white border-purple-600/50";
        case "orange":
          return "bg-gradient-to-r from-purple-600 from-[15%] to-orange-500 text-white border-purple-600/50";
        case "pink":
          return "bg-gradient-to-r from-purple-600 from-[15%] to-pink-600 text-white border-purple-600/50";
        case "yellow":
          return "bg-gradient-to-r from-purple-600 from-[15%] to-yellow-500 text-white border-purple-600/50";
        case "blue":
          return "bg-gradient-to-r from-purple-600 from-[15%] to-blue-600 text-white border-purple-600/50";
        case "white":
        case "purple":
        case "darker-blue":
        default:
          return "bg-gradient-to-r from-purple-600 from-[15%] to-gray-400 text-white border-purple-600/50";
      }
    }

    // Non-service jobs: solid colors
    if (status === "delivered" || allDelivered) {
      return "bg-slate-700/85 text-slate-100 border-slate-600 opacity-65";
    }

    switch (status) {
      case "not-processed":
        return "bg-red-600 text-white border-red-700";
      case "white":
        return "bg-gray-400 text-gray-50 border-gray-500";
      case "green":
        return "bg-green-600 text-white border-green-700";
      case "yellow":
        return "bg-yellow-500 text-white border-yellow-600";
      case "orange":
        return "bg-orange-500 text-white border-orange-600";
      case "pink":
        return "bg-pink-600 text-white border-pink-700";
      case "lime":
        return "bg-fuchsia-600 text-white border-fuchsia-700";
      case "blue":
        return "bg-blue-600 text-white border-blue-700";
      case "delivery-only":
        return "bg-cyan-600 text-white border-cyan-700";
      case "purple":
        return "bg-purple-600 text-white border-purple-700";
      case "darker-blue": // Legacy support - map to purple
        return "bg-purple-600 text-white border-purple-700";
      default:
        return "bg-gray-400 text-gray-50 border-gray-500";
    }
  };

  const handleJobClick = (jobNumber: string, listNumber?: string | null) => {
    const normalizedListNumber = listNumber?.trim() || '1';
    router.push(`/job/${jobNumber}?list=${encodeURIComponent(normalizedListNumber)}`);
  };

  const statusLabel = (job: CalendarJob): string => {
    if (job.status === "delivered" || job.allDelivered) return "Delivered";
    if (job.isDeliveryOnly || job.status === "delivery-only") return "Delivery-only";
    switch (job.status) {
      case "not-processed":
        return "Not Processed";
      case "green":
        return "Needs Pull";
      case "yellow":
        return "Backorder";
      case "orange":
        return "Supplier Pickup";
      case "pink":
        return "Jobsite Delivery";
      case "lime":
        return "Preordered";
      case "blue":
        return "Ready";
      case "purple":
      case "darker-blue":
        return "Service";
      default:
        return "Open";
    }
  };

  const handlePrintCalendar = () => {
    window.print();
  };

  const printViewLabel =
    viewMode === "month" ? "Month View" : viewMode === "biweek" ? "2-Week View" : "Week View";
  const printRangeLabel =
    viewMode === "month"
      ? `${formatDateInAppTimeZone(firstDayOfMonth, { month: "long", day: "numeric", year: "numeric" })} - ${formatDateInAppTimeZone(lastDayOfMonth, { month: "long", day: "numeric", year: "numeric" })}`
      : viewMode === "biweek"
        ? biWeekRangeLabel
        : weekRangeLabel;
  const printDates =
    viewMode === "week"
      ? weekDates
      : viewMode === "biweek"
        ? [...biWeekDates[0], ...biWeekDates[1]]
        : monthWorkdayDates;

  if (isLoading && !isAccessDenied) {
    return (
      <div className="h-screen bg-gray-50 dark:bg-gradient-to-br dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-slate-900 dark:text-slate-300 font-medium">Loading calendar...</p>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="calendar-screen-root h-dvh bg-gray-50 dark:bg-gradient-to-br dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 flex overflow-hidden">
      {/* Left Sidebar */}
      <DashboardSidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex-shrink-0 bg-white/80 dark:bg-slate-800/80 border-b border-gray-200 dark:border-slate-700/50 backdrop-blur-xl">
          <div className="px-6" style={{ paddingTop: 'clamp(0.75rem, 1.5vh, 1.25rem)', paddingBottom: 'clamp(0.75rem, 1.5vh, 1.25rem)' }}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="font-bold text-slate-900 dark:text-white" style={{ fontSize: 'clamp(1.125rem, 2.5vh, 1.875rem)' }}>
                  Calendar
                </h1>
                <p className="text-slate-700 dark:text-slate-400 mt-1 font-normal" style={{ fontSize: 'clamp(0.75rem, 1.4vh, 0.875rem)' }}>
                  Material shop operations
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="inline-flex bg-gray-100 dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 rounded-lg p-0.5 flex-shrink-0">
                <button
                  onClick={() => handleViewModeChange("month")}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                    viewMode === "month"
                      ? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm"
                      : "text-slate-700 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-600/50"
                  }`}
                >
                  Month
                </button>
                <button
                  onClick={() => handleViewModeChange("week")}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                    viewMode === "week"
                      ? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm"
                      : "text-slate-700 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-600/50"
                  }`}
                >
                  Week
                </button>
                <button
                  onClick={() => handleViewModeChange("biweek")}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                    viewMode === "biweek"
                      ? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm"
                      : "text-slate-700 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-600/50"
                  }`}
                >
                  2 Weeks
                </button>
                </div>
                <button
                  type="button"
                  onClick={handlePrintCalendar}
                  title="Print calendar PDF"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all hover:border-gray-400 hover:bg-gray-200 dark:border-slate-600/50 dark:bg-slate-700/50 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-700"
                >
                  <Printer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Print
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Error Banner */}
        {error && (
          <div className="px-6 pt-4">
            <div className="bg-red-600/80 text-white p-4 rounded-xl shadow-lg border border-red-500/50">
              <p className="font-semibold">Error: {error}</p>
            </div>
          </div>
        )}

        {/* Calendar Content */}
        <main className="flex-1 overflow-hidden px-6 py-3 flex flex-col bg-gray-50 dark:bg-transparent min-h-0">
          {/* Status filters */}
          <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-2 mb-2 backdrop-blur-sm shadow-sm dark:shadow-none flex-shrink-0">
            <div className="flex items-center justify-center gap-2 text-xs flex-wrap">
              {!contractJobsOnly && !serviceJobsOnly ? (
                <div className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-100 p-1 dark:border-slate-600 dark:bg-slate-700/50">
                  {(
                    [
                      { id: "all" as const, label: "All" },
                      { id: "contract" as const, label: "Contract" },
                      { id: "service" as const, label: "Service" },
                    ] as const
                  ).map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setJobTypeFilter(id)}
                      className={`rounded-md px-3 py-1.5 font-semibold transition-all ${
                        jobTypeFilter === id
                          ? id === "service"
                            ? "bg-purple-600 text-white shadow-sm"
                            : "bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white"
                          : "text-slate-700 hover:bg-white/80 dark:text-slate-300 dark:hover:bg-slate-600/50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : contractJobsOnly ? (
                <div className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-300">
                  Contract jobs only
                </div>
              ) : (
                <div className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-300">
                  Service jobs only
                </div>
              )}
              {!contractJobsOnly && !serviceJobsOnly ? (
                <div className="hidden h-6 w-px bg-slate-300 dark:bg-slate-600 sm:block" aria-hidden="true" />
              ) : null}
              {(
                [
                  { id: "delivered" as const, label: "Delivered", color: "bg-slate-500/80 ring-1 ring-inset ring-slate-400/70 dark:bg-slate-500/60 dark:ring-slate-300/20", glow: "hover:ring-2 hover:ring-slate-400/40" },
                  { id: "green" as const, label: "Needs Pulling", color: "bg-green-600", glow: "hover:ring-2 hover:ring-green-500/60" },
                  { id: "yellow" as const, label: "Backorders", color: "bg-yellow-500", glow: "hover:ring-2 hover:ring-yellow-400/60" },
                  { id: "orange" as const, label: "Supplier Pickup", color: "bg-orange-500", glow: "hover:ring-2 hover:ring-orange-500/60" },
                  { id: "pink" as const, label: "Jobsite Delivery", color: "bg-pink-600", glow: "hover:ring-2 hover:ring-pink-500/60" },
                  { id: "lime" as const, label: "Preordered", color: "bg-fuchsia-600", glow: "hover:ring-2 hover:ring-fuchsia-500/60" },
                  { id: "blue" as const, label: "Ready for Delivery", color: "bg-blue-600", glow: "hover:ring-2 hover:ring-blue-500/60" },
                  { id: "delivery-only" as const, label: "Delivery-only", color: "bg-cyan-600", glow: "hover:ring-2 hover:ring-cyan-500/60" },
                  { id: "not-processed" as const, label: "Not Processed", color: "bg-red-600", glow: "hover:ring-2 hover:ring-red-500/60" },
                ] as const
              ).map(({ id, label, color, glow }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStatusFilter((prev) => (prev === id ? "all" : id))}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium transition-all duration-200 bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-600/50 hover:shadow-lg text-slate-900 dark:text-slate-200 ${glow} ${
                    statusFilter === id ? "ring-2 ring-slate-400 dark:ring-slate-500 ring-offset-2 dark:ring-offset-slate-800" : ""
                  }`}
                >
                  {color && <div className={`w-3 h-3 rounded flex-shrink-0 ${color}`} />}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Calendar and Jobs Side by Side */}
          <div className="flex-1 flex gap-5 min-h-0">
            {/* Calendar - Larger */}
            <div className="flex-1 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl backdrop-blur-sm flex flex-col min-w-0 shadow-xl overflow-hidden h-full" style={{ padding: 'clamp(0.5rem, 1.5vh, 1.25rem)' }}>
              {/* Calendar Header */}
              <div className="flex items-center justify-between mb-1 flex-shrink-0">
                <button
                  onClick={previousMonth}
                  className="bg-gray-100 dark:bg-slate-700/50 hover:bg-gray-200 dark:hover:bg-slate-700 border border-gray-300 dark:border-slate-600/50 rounded-lg font-medium text-slate-700 dark:text-slate-200 transition-all hover:border-gray-400 dark:hover:border-slate-500"
                  style={{ padding: 'clamp(0.375rem, 1vh, 0.5rem) clamp(0.75rem, 1.5vh, 1rem)', fontSize: 'clamp(0.75rem, 1.5vh, 0.875rem)' }}
                >
                  Previous
                </button>

                <div className="text-center">
                  <h2 className="font-semibold text-slate-900 dark:text-white" style={{ fontSize: 'clamp(0.875rem, 2vh, 1.25rem)' }}>
                    {viewMode === "month"
                      ? formatDateInAppTimeZone(currentMonth, {
                          month: "long",
                          year: "numeric",
                        })
                      : viewMode === "biweek"
                        ? biWeekRangeLabel
                        : weekRangeLabel}
                  </h2>
                  <button
                    type="button"
                    onClick={goToToday}
                    title={isViewingToday ? "You are viewing the current period" : "Jump to today"}
                    className={`mt-1.5 inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 font-semibold transition-all ${
                      isViewingToday
                        ? "cursor-default border-slate-200/70 bg-slate-100/50 text-slate-400 dark:border-slate-600/30 dark:bg-slate-800/40 dark:text-slate-500"
                        : "border-blue-400/80 bg-blue-50 text-blue-700 shadow-[0_0_10px_rgba(59,130,246,0.22)] ring-1 ring-blue-400/25 hover:border-blue-500 hover:bg-blue-100 hover:shadow-[0_0_14px_rgba(59,130,246,0.35)] dark:border-blue-500/55 dark:bg-slate-700/80 dark:text-blue-100 dark:shadow-[0_0_14px_rgba(59,130,246,0.28)] dark:ring-blue-400/35 dark:hover:border-blue-400/70 dark:hover:bg-slate-700 dark:hover:text-white dark:hover:shadow-[0_0_18px_rgba(59,130,246,0.4)]"
                    }`}
                    style={{ fontSize: 'clamp(0.625rem, 1.2vh, 0.75rem)' }}
                  >
                    Today
                    <ChevronRight className="h-3 w-3 shrink-0 opacity-80" aria-hidden="true" />
                  </button>
                </div>

                <button
                  onClick={nextMonth}
                  className="bg-gray-100 dark:bg-slate-700/50 hover:bg-gray-200 dark:hover:bg-slate-700 border border-gray-300 dark:border-slate-600/50 rounded-lg font-medium text-slate-700 dark:text-slate-200 transition-all hover:border-gray-400 dark:hover:border-slate-500"
                  style={{ padding: 'clamp(0.375rem, 1vh, 0.5rem) clamp(0.75rem, 1.5vh, 1rem)', fontSize: 'clamp(0.75rem, 1.5vh, 0.875rem)' }}
                >
                  Next
                </button>
              </div>

              {viewMode === "month" ? (
                <>
                  {/* Day Headers - Separate row above calendar */}
                  <div className="grid grid-cols-5 mb-1 flex-shrink-0" style={{ gap: 'var(--calendar-gap)' }}>
                    {WORKWEEK_DAY_LABELS.map(
                      (day) => (
                        <div
                          key={day}
                          className="text-center font-bold text-slate-700 dark:text-slate-400 tracking-tight"
                          style={{ fontSize: "var(--calendar-weekday-font)" }}
                        >
                          {day}
                        </div>
                      ),
                    )}
                  </div>

                  {/* Calendar Grid */}
                  <div className="grid grid-cols-5 flex-1 min-h-0" style={{ gap: 'var(--calendar-gap)', gridAutoRows: 'minmax(0, 1fr)' }}>
                    {/* Empty cells for days before month starts */}
                    {Array.from({ length: monthStartOffset }).map((_, i) => (
                      <div key={`empty-${i}`} className="min-h-0"></div>
                    ))}

                    {/* Calendar Days */}
                    {monthWorkdayDates.map((date) => {
                      const day = date.getDate();
                      const today = new Date();
                      const isToday = isSameDate(date, today);
                      const isSelected = isSameDate(date, selectedDate);
                      const dayJobs = getJobsForDate(date);

                      return (
                        <div
                          key={day}
                          onClick={() => setSelectedDate(date)}
                          className={`border rounded-xl cursor-pointer transition-all flex flex-col min-h-0 h-full overflow-hidden ${
                            isToday
                              ? "bg-amber-50 dark:bg-blue-600/30 border-amber-300 dark:border-blue-500/60 shadow-lg shadow-amber-200/50 dark:shadow-blue-500/20"
                              : isSelected
                                ? "bg-gray-200 dark:bg-slate-700/70 border-gray-300 dark:border-slate-500/70"
                                : "bg-gray-100 dark:bg-slate-700/40 border-gray-200 dark:border-slate-600/40 hover:border-gray-300 dark:hover:border-slate-500/60 hover:bg-gray-200 dark:hover:bg-slate-700/60"
                          }`}
                          style={{ padding: 'var(--calendar-cell-padding)' }}
                        >
                          <div className="flex items-start justify-between gap-1 mb-1.5 flex-shrink-0">
                            <span
                              className={`font-bold leading-none ${isToday ? "text-amber-700 dark:text-blue-200" : isSelected ? "text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-200"}`}
                              style={{ fontSize: 'var(--calendar-date-font)' }}
                            >
                              {day}
                            </span>
                            {dayJobs.length > 0 && (
                              <span
                                className={`flex-shrink-0 min-w-[1.625rem] px-2 py-0.5 rounded-full text-center font-bold ${
                                  isToday
                                    ? "bg-amber-600 text-white dark:bg-blue-500 dark:text-white"
                                    : isSelected
                                      ? "bg-slate-600 text-white dark:bg-slate-500"
                                      : "bg-blue-600 text-white dark:bg-blue-500"
                                }`}
                                style={{ fontSize: "var(--calendar-job-detail-font)" }}
                                title={`${dayJobs.length} job${dayJobs.length === 1 ? "" : "s"}`}
                              >
                                {dayJobs.length}
                              </span>
                            )}
                          </div>
                          {dayJobs.length > 0 && (
                            <DayJobsList
                              jobs={dayJobs}
                              isToday={isToday}
                              onDeleteDeliveryOnly={handleDeleteDeliveryOnly}
                            />
                          )}
                        </div>
                      );
                    })}

                    {/* Days from next month to fill the grid */}
                    {Array.from({ length: monthTrailingCells }).map((_, i) => {
                      const day = i + 1;
                      return (
                        <div
                          key={`next-${day}`}
                          className="border border-gray-200 dark:border-slate-700/20 rounded-xl opacity-30 min-h-0 h-full overflow-hidden"
                          style={{ padding: 'var(--calendar-cell-padding)' }}
                        >
                          <div className="font-bold text-slate-500 dark:text-slate-600" style={{ fontSize: 'var(--calendar-date-font)' }}>
                            {day}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : viewMode === "biweek" ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden gap-4">
                  <WeekGrid
                    weekDates={biWeekDates[0]}
                    selectedDate={selectedDate}
                    onSelectDate={setSelectedDate}
                    getJobsForDate={getJobsForDate}
                    onJobClick={handleJobClick}
                    onDeleteDeliveryOnly={handleDeleteDeliveryOnly}
                    getStatusColor={getStatusColor}
                    toDateKey={toDateKey}
                    weekLabel={formatWeekLabel(biWeekDates[0][0], biWeekDates[0][4])}
                  />
                  <WeekGrid
                    weekDates={biWeekDates[1]}
                    selectedDate={selectedDate}
                    onSelectDate={setSelectedDate}
                    getJobsForDate={getJobsForDate}
                    onJobClick={handleJobClick}
                    onDeleteDeliveryOnly={handleDeleteDeliveryOnly}
                    getStatusColor={getStatusColor}
                    toDateKey={toDateKey}
                    weekLabel={formatWeekLabel(biWeekDates[1][0], biWeekDates[1][4])}
                  />
                </div>
              ) : (
                <WeekGrid
                  weekDates={weekDates}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                  getJobsForDate={getJobsForDate}
                  onJobClick={handleJobClick}
                  onDeleteDeliveryOnly={handleDeleteDeliveryOnly}
                  getStatusColor={getStatusColor}
                  toDateKey={toDateKey}
                />
              )}
            </div>

            {/* Selected Date Jobs - Right Side (Month view only) */}
            {viewMode === "month" && (
              <div className="w-80 flex-shrink-0 bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-5 backdrop-blur-sm overflow-hidden flex flex-col shadow-xl">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">
                  Jobs for{" "}
                  {formatDateInAppTimeZone(selectedDate, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </h3>
                {getJobsForDate(selectedDate).length === 0 ? (
                  <p className="text-slate-700 dark:text-slate-400 text-sm">
                    No jobs scheduled for this date.
                  </p>
                ) : (
                  <div className="calendar-scroll flex-1 overflow-y-auto space-y-3 pr-1">
                    {getJobsForDate(selectedDate).map((job) => (
                      <div
                        key={`${job.jobNumber}-${job.listNumber || "1"}-${job.dateType}`}
                        onClick={() => {
                          if (job.isDeliveryOnly) return;
                          handleJobClick(job.jobNumber, job.listNumber);
                        }}
                        className={`p-4 border rounded-lg transition-all hover:shadow-lg cursor-pointer ${getStatusColor(job.status, job.allDelivered, job.isServiceJob, job.isDeliveryOnly)}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="font-semibold text-sm mb-1.5 flex-1 min-w-0 flex items-center gap-1 min-w-0">
                                {job.purchaseOrderAccountedFor ? (
                                  <span
                                    className="flex-shrink-0 text-amber-200 drop-shadow-sm"
                                    title="Purchase order accounted for"
                                    aria-label="Purchase order accounted for"
                                  >
                                    ★
                                  </span>
                                ) : null}
                                <span className="truncate">{job.jobName}</span>
                              </h4>
                              {job.isDeliveryOnly && job.calendarEventId && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteDeliveryOnly(job.calendarEventId!);
                                  }}
                                  className="inline-flex items-center justify-center w-6 h-6 rounded bg-black/20 hover:bg-black/35 text-white/95 flex-shrink-0"
                                  title="Delete delivery-only event"
                                  aria-label="Delete delivery-only event"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 7h12M9 7V5h6v2m-7 0 1 12h6l1-12" />
                                  </svg>
                                </button>
                              )}
                            </div>
                            <p className="text-xs opacity-90 mb-2">
                              {job.area || "No Area"}
                            </p>
                            {job.isDeliveryOnly ? (
                              <div className="text-[11px] opacity-85 mb-1">
                                Delivery-only event
                              </div>
                            ) : (
                              <div className="text-[11px] opacity-85 mb-1">
                                List #{job.listNumber || "-"} | Job #{job.jobNumber}
                              </div>
                            )}
                            <div className="text-[10px] mt-1 opacity-75">
                              {job.pulledCount} / {job.lineCount} pulled -{" "}
                              {job.dateType}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      
    </div>
    <div className="calendar-print-only">
      <div className="calendar-print-header">
        <div className="calendar-print-header-top">
          <img src="/icon.png" alt="Total Fire Protection" className="calendar-print-logo" />
          <h1>Total Fire Protection Calendar Printout</h1>
        </div>
        <div className="calendar-print-meta">
          <span><strong>View:</strong> {printViewLabel}</span>
          <span><strong>Range:</strong> {printRangeLabel}</span>
          <span>
            <strong>Generated:</strong>{" "}
            {formatDateInAppTimeZone(new Date(), {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZoneName: "short",
            })}
          </span>
          <span><strong>Status Filter:</strong> {statusFilter === "all" ? "All" : statusFilter}</span>
          <span>
            <strong>Job Type:</strong>{" "}
            {jobTypeFilter === "all"
              ? "All jobs"
              : jobTypeFilter === "contract"
                ? "Contract jobs"
                : "Service jobs"}
          </span>
        </div>
      </div>

      <div className="calendar-print-table-wrap">
        <table className="calendar-print-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Job #</th>
              <th>List</th>
              <th>Job Name</th>
              <th>Status</th>
              <th>Pulled</th>
            </tr>
          </thead>
          <tbody>
            {printDates.map((date) => {
              const jobs = getJobsForDate(date);
              if (jobs.length === 0) {
                return (
                  <tr key={`print-row-empty-${toDateKey(date)}`} className="calendar-print-row-empty">
                    <td>{formatDateInAppTimeZone(date, { weekday: "short", month: "short", day: "numeric" })}</td>
                    <td colSpan={5}>No jobs</td>
                  </tr>
                );
              }

              return jobs.map((job, idx) => (
                <tr key={`print-row-${toDateKey(date)}-${job.jobNumber}-${idx}`} className={`status-${job.status}`}>
                  <td>
                    {idx === 0
                      ? formatDateInAppTimeZone(date, { weekday: "short", month: "short", day: "numeric" })
                      : ""}
                  </td>
                  <td>{job.jobNumber}</td>
                  <td>{job.listNumber || "1"}</td>
                  <td>{job.jobName}</td>
                  <td>
                    {job.purchaseOrderAccountedFor ? "★ " : ""}
                    {statusLabel(job)}
                  </td>
                  <td>{job.pulledCount}/{job.lineCount}</td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </div>
    </>
  );
}
