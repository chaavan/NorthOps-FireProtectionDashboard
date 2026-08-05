"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CRM_LOGGABLE_ACTIVITY_TYPES,
  crmActivityTypeLabel,
  type CrmActivityRecord,
  type CrmEntityType,
} from "@/lib/crm/crmTypes";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const typeColor: Record<string, string> = {
  NOTE: "bg-slate-400",
  CALL: "bg-emerald-500",
  EMAIL: "bg-blue-500",
  MEETING: "bg-violet-500",
  STAGE_CHANGE: "bg-amber-500",
  SYSTEM: "bg-slate-300",
};

export default function CrmActivityTimeline({
  entityType,
  entityId,
  accountId,
  canEdit,
}: {
  entityType: CrmEntityType;
  entityId: string;
  accountId?: string | null;
  canEdit: boolean;
}) {
  const [activities, setActivities] = useState<CrmActivityRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activityType, setActivityType] = useState<string>("NOTE");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ entityType, entityId });
      const res = await fetch(`/api/crm/activities?${params.toString()}`, { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to load activity");
      setActivities(payload.activities || []);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const logActivity = async () => {
    if (!body.trim() && !subject.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, entityId, accountId, activityType, subject, body }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to log activity");
      setSubject("");
      setBody("");
      setActivityType("NOTE");
      await load();
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteActivity = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/crm/activities/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error || "Failed to delete activity");
      }
      await load();
    } catch (deleteError) {
      setError((deleteError as Error).message);
    }
  };

  return (
    <div>
      {error ? <p className="mb-2 text-sm text-rose-600">{error}</p> : null}

      {canEdit ? (
        <div className="mb-4 space-y-2">
          <div className="flex gap-2">
            <select value={activityType} onChange={(e) => setActivityType(e.target.value)} className={`${inputClass} w-32`}>
              {CRM_LOGGABLE_ACTIVITY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {crmActivityTypeLabel(type)}
                </option>
              ))}
            </select>
            <input
              className={inputClass}
              placeholder="Subject (optional)"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <textarea
            className={inputClass}
            rows={2}
            placeholder="Log a note, call, email, or meeting…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <button
            type="button"
            disabled={saving || (!body.trim() && !subject.trim())}
            onClick={() => void logActivity()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Logging…" : "Log activity"}
          </button>
        </div>
      ) : null}

      {activities.length === 0 ? (
        <p className="text-sm text-slate-500">No activity yet.</p>
      ) : (
        <ol className="space-y-3">
          {activities.map((activity) => (
            <li key={activity.id} className="flex gap-3">
              <span
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${typeColor[activity.activityType] ?? "bg-slate-400"}`}
                aria-hidden
              />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    {crmActivityTypeLabel(activity.activityType)}
                    {activity.subject ? <span className="ml-2 normal-case text-slate-700 dark:text-slate-300">{activity.subject}</span> : null}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-slate-400">
                    {formatDateTime(activity.occurredAt)}
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => void deleteActivity(activity.id)}
                        className="text-rose-500 hover:underline"
                      >
                        Delete
                      </button>
                    ) : null}
                  </span>
                </div>
                {activity.body ? (
                  <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{activity.body}</p>
                ) : null}
                {activity.createdBy ? (
                  <p className="text-xs text-slate-400">— {activity.createdBy}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
