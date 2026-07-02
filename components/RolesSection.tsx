"use client";



import { useCallback, useEffect, useState } from "react";

import Link from "next/link";

import { useRouter } from "next/navigation";

import RoleBadge from "@/components/roles/RoleBadge";



export type DashboardRoleOption = {

  key: string;

  name: string;

  description: string | null;

  colorClass: string | null;

  isSystem: boolean;

  isActive: boolean;

  userCount?: number;

};



type RolesSectionProps = {

  canManage: boolean;

  embedded?: boolean;

  fillHeight?: boolean;

  onRolesChanged?: () => void;

};



export default function RolesSection({

  canManage,

  embedded = false,

  fillHeight = false,

}: RolesSectionProps) {

  const router = useRouter();

  const [roles, setRoles] = useState<DashboardRoleOption[]>([]);

  const [isLoading, setIsLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);



  const loadRoles = useCallback(async () => {

    try {

      setIsLoading(true);

      setError(null);

      const params = new URLSearchParams({ includeUserCounts: "true" });

      if (canManage) params.set("includeArchived", "true");

      const response = await fetch(`/api/roles?${params.toString()}`, { cache: "no-store" });

      const body = await response.json();

      if (!response.ok) {

        throw new Error(body.error || "Failed to load roles");

      }

      setRoles(body.roles || []);

    } catch (err) {

      setError((err as Error).message);

    } finally {

      setIsLoading(false);

    }

  }, [canManage]);



  useEffect(() => {

    void loadRoles();

  }, [loadRoles]);



  const handleArchiveRole = async (role: DashboardRoleOption) => {

    if (role.isSystem) return;

    const confirmed = window.confirm(

      `Archive "${role.name}"? It will disappear from filters and assignment dropdowns, but existing users keep this role until changed.`,

    );

    if (!confirmed) return;



    setIsSubmitting(true);

    setError(null);

    try {

      const response = await fetch(`/api/roles/${encodeURIComponent(role.key)}`, {

        method: "PATCH",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ isActive: false }),

      });

      const body = await response.json();

      if (!response.ok) throw new Error(body.error || "Failed to archive role");

      await loadRoles();

    } catch (err) {

      setError((err as Error).message);

    } finally {

      setIsSubmitting(false);

    }

  };



  const handleRestoreRole = async (role: DashboardRoleOption) => {

    setIsSubmitting(true);

    setError(null);

    try {

      const response = await fetch(`/api/roles/${encodeURIComponent(role.key)}`, {

        method: "PATCH",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ isActive: true }),

      });

      const body = await response.json();

      if (!response.ok) throw new Error(body.error || "Failed to restore role");

      await loadRoles();

    } catch (err) {

      setError((err as Error).message);

    } finally {

      setIsSubmitting(false);

    }

  };



  const panelClassName = embedded

    ? fillHeight

      ? "flex min-h-0 flex-1 flex-col overflow-hidden"

      : ""

    : fillHeight

      ? "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700/50 dark:bg-slate-800/60"

      : "mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700/50 dark:bg-slate-800/60";



  return (

    <div className={panelClassName}>

      <div className="mb-4 flex flex-shrink-0 flex-wrap items-center justify-between gap-3">

        <div>

          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Roles</h2>

          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">

            Create roles and set page-by-page default permissions.

          </p>

        </div>

        {canManage ? (

          <button

            type="button"

            onClick={() => router.push("/admin/users/roles/new")}

            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"

          >

            + Create Role

          </button>

        ) : null}

      </div>



      {error ? (

        <div className="mb-4 rounded-xl bg-red-600 p-3 text-sm font-semibold text-white">{error}</div>

      ) : null}



      {isLoading ? (

        <p className="text-sm text-slate-500">Loading roles...</p>

      ) : (

        <div className={`overflow-x-auto ${fillHeight ? "min-h-0 flex-1 overflow-y-auto" : ""}`}>

          <table className="w-full min-w-[48rem]">

            <thead>

              <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:border-slate-700/50">

                <th className="px-3 py-2">Role</th>

                <th className="px-3 py-2">Key</th>

                <th className="px-3 py-2">Users</th>

                <th className="px-3 py-2">Status</th>

                {canManage ? <th className="px-3 py-2 text-right">Actions</th> : null}

              </tr>

            </thead>

            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">

              {roles.map((role) => (

                <tr key={role.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">

                  <td className="px-3 py-3">

                    {canManage ? (

                      <Link

                        href={`/admin/users/roles/${encodeURIComponent(role.key)}`}

                        className="group block"

                      >

                        <RoleBadge name={role.name} colorClass={role.colorClass} className="transition group-hover:ring-2 group-hover:ring-blue-400/40" />

                      </Link>

                    ) : (

                      <RoleBadge name={role.name} colorClass={role.colorClass} />

                    )}

                  </td>

                  <td className="px-3 py-3 font-mono text-xs text-slate-500">{role.key}</td>

                  <td className="px-3 py-3 text-sm text-slate-600 dark:text-slate-300">

                    {role.userCount ?? 0}

                  </td>

                  <td className="px-3 py-3 text-sm">

                    {role.isActive ? (

                      <span className="font-semibold text-green-700 dark:text-green-300">Active</span>

                    ) : (

                      <span className="font-semibold text-slate-500">Archived</span>

                    )}

                    {role.isSystem ? (

                      <span className="ml-2 text-xs text-slate-400">System</span>

                    ) : null}

                  </td>

                  {canManage ? (

                    <td className="px-3 py-3">

                      <div className="flex flex-wrap justify-end gap-2">

                        <Link

                          href={`/admin/users/roles/${encodeURIComponent(role.key)}?tab=permissions`}

                          className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700"

                        >

                          Permissions

                        </Link>

                        <Link

                          href={`/admin/users/roles/${encodeURIComponent(role.key)}`}

                          className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700"

                        >

                          Edit

                        </Link>

                        {!role.isSystem && role.isActive ? (

                          <button

                            type="button"

                            onClick={() => void handleArchiveRole(role)}

                            disabled={isSubmitting}

                            className="rounded-lg bg-slate-600 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"

                          >

                            Archive

                          </button>

                        ) : null}

                        {!role.isActive ? (

                          <button

                            type="button"

                            onClick={() => void handleRestoreRole(role)}

                            disabled={isSubmitting}

                            className="rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"

                          >

                            Restore

                          </button>

                        ) : null}

                      </div>

                    </td>

                  ) : null}

                </tr>

              ))}

            </tbody>

          </table>

        </div>

      )}

    </div>

  );

}


