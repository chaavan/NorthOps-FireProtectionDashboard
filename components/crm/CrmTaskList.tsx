"use client";

import { useCallback, useEffect, useState } from "react";
import type { CrmEntityType, CrmTaskRecord } from "@/lib/crm/crmTypes";

const inputClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800";

function dueLabel(dueDate: string | null): { text: string; overdue: boolean } {
  if (!dueDate) return { text: "No due date", overdue: false };
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = due.getTime() < today.getTime();
  return {
    text: due.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    overdue,
  };
}

export default function CrmTaskList({
  entityType,
  entityId,
  accountId,
  mine,
  canEdit,
  showCreate = true,
}: {
  entityType?: CrmEntityType;
  entityId?: string;
  accountId?: string | null;
  mine?: boolean;
  canEdit: boolean;
  showCreate?: boolean;
}) {
  const [tasks, setTasks] = useState<CrmTaskRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (entityType && entityId) {
        params.set("entityType", entityType);
        params.set("entityId", entityId);
      }
      if (mine) params.set("mine", "1");
      const res = await fetch(`/api/crm/tasks?${params.toString()}`, { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to load tasks");
      setTasks(payload.tasks || []);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, [entityType, entityId, mine]);

  useEffect(() => {
    void load();
  }, [load]);

  const createTask = async () => {
    if (!title.trim()) return;
    setError(null);
    try {
      const res = await fetch("/api/crm/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          dueDate: dueDate || null,
          entityType,
          entityId,
          accountId,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to create task");
      setTitle("");
      setDueDate("");
      await load();
    } catch (submitError) {
      setError((submitError as Error).message);
    }
  };

  const toggleTask = async (task: CrmTaskRecord) => {
    setError(null);
    try {
      const res = await fetch(`/api/crm/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: task.status === "DONE" ? "OPEN" : "DONE" }),
      });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error || "Failed to update task");
      }
      await load();
    } catch (updateError) {
      setError((updateError as Error).message);
    }
  };

  const deleteTask = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/crm/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error || "Failed to delete task");
      }
      await load();
    } catch (deleteError) {
      setError((deleteError as Error).message);
    }
  };

  return (
    <div>
      {error ? <p className="mb-2 text-sm text-rose-600">{error}</p> : null}

      {canEdit && showCreate ? (
        <div className="mb-3 flex flex-wrap gap-2">
          <input
            className={`${inputClass} flex-1`}
            placeholder="New task…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createTask();
            }}
          />
          <input type="date" className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <button
            type="button"
            disabled={!title.trim()}
            onClick={() => void createTask()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <p className="text-sm text-slate-500">No tasks.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {tasks.map((task) => {
            const due = dueLabel(task.dueDate);
            const done = task.status === "DONE";
            return (
              <li key={task.id} className="flex items-center gap-3 py-2">
                <input
                  type="checkbox"
                  checked={done}
                  disabled={!canEdit}
                  onChange={() => void toggleTask(task)}
                  className="h-4 w-4"
                />
                <div className="flex-1">
                  <div className={`text-sm ${done ? "text-slate-400 line-through" : "text-slate-800 dark:text-slate-200"}`}>
                    {task.title}
                  </div>
                  <div className="text-xs">
                    <span className={due.overdue && !done ? "font-semibold text-rose-600" : "text-slate-400"}>
                      {due.text}
                    </span>
                    {task.assigneeEmail ? <span className="ml-2 text-slate-400">· {task.assigneeEmail}</span> : null}
                  </div>
                </div>
                {canEdit ? (
                  <button type="button" onClick={() => void deleteTask(task.id)} className="text-xs text-rose-500 hover:underline">
                    Delete
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
