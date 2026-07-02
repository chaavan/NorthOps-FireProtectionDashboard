'use client';

import { useState } from 'react';
import JobImportUploadCard from '@/components/JobImportUploadCard';
import JobImportDraftsList from '@/components/JobImportDraftsList';
import DashboardSidebar from '@/components/DashboardSidebar';
import HydraTecWatchersModal from '@/components/HydraTecWatchersModal';
import AccessDeniedOverlay from '@/components/AccessDeniedOverlay';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissions } from '@/lib/hooks/usePermissions';

function BlurredJobImportBackdrop() {
  return (
    <div className="pointer-events-none select-none blur-sm" aria-hidden="true">
      <div className="flex w-full flex-col gap-4 sm:gap-5 opacity-70">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700/50 dark:bg-slate-800/60 sm:p-5 lg:p-6">
          <div className="h-6 w-40 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="mt-5 flex min-h-[240px] items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-900/20">
            <div className="space-y-3 text-center">
              <div className="mx-auto h-14 w-14 rounded-full bg-slate-200 dark:bg-slate-700" />
              <div className="mx-auto h-4 w-56 rounded bg-slate-200 dark:bg-slate-700" />
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700/50 dark:bg-slate-800/60 sm:p-5 lg:p-6">
          <div className="h-6 w-32 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-40 rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/30"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function JobsManagementPage() {
  const { user } = useAuth();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const [draftRefreshKey, setDraftRefreshKey] = useState(0);
  const [showWatchersModal, setShowWatchersModal] = useState(false);
  const canViewJobImport = hasPermission('job_import.view');
  const canUploadJobImport = hasPermission('job_import.upload');
  const canViewOwnDrafts = hasPermission('job_import.drafts.view_own');
  const canViewAllDrafts = hasPermission('job_import.drafts.view_all');
  const canEditOthersDrafts = hasPermission('job_import.drafts.edit_others');
  const canCreateManualJob = hasPermission('jobs.create');
  const canViewWatchers =
    hasPermission('job_import.hydratec_watchers.view_own') ||
    hasPermission('job_import.hydratec_watchers.view_all');
  const canViewAllWatchers = hasPermission('job_import.hydratec_watchers.view_all');
  const canAddWatchers = hasPermission('job_import.hydratec_watchers.add');
  const canRevokeWatchers = hasPermission('job_import.hydratec_watchers.revoke');
  const canRegenerateOwnWatchers = hasPermission('job_import.hydratec_watchers.regenerate_own');
  const currentUserEmail = String(user?.email || '').trim().toLowerCase();
  const isAccessDenied = !permissionsLoading && !canViewJobImport;

  return (
    <div className="h-screen bg-slate-100 dark:bg-slate-900 flex overflow-hidden">
      {/* Left Sidebar */}
      <DashboardSidebar />

      {/* Main Content Area */}
      <div className="relative flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header
          className={`bg-white dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700/50 ${
            isAccessDenied ? 'pointer-events-none select-none blur-sm opacity-60' : ''
          }`}
        >
          <div className="px-4 sm:px-5 lg:px-6 py-3 sm:py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-xl sm:text-2xl md:text-[2rem] font-bold text-slate-900 dark:text-white leading-tight">
                  Job Import
                </h1>
                <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium max-w-3xl">
                  Upload picksheet PDFs and resume saved import drafts before creating jobs.
                </p>
              </div>
              {canViewWatchers && (
                <button
                  onClick={() => setShowWatchersModal(true)}
                  className="flex-shrink-0 px-4 py-2 bg-slate-700 hover:bg-slate-800 dark:bg-slate-700/70 dark:hover:bg-slate-700 text-white rounded-xl font-semibold text-sm transition-all shadow-md"
                >
                  HydraTec Watchers
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main
          className={`relative flex-1 overflow-y-auto px-4 sm:px-5 lg:px-6 py-4 sm:py-5 bg-slate-100 dark:bg-slate-900 min-h-0 ${
            isAccessDenied ? 'pointer-events-none select-none' : ''
          }`}
        >
          {permissionsLoading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-700/50 dark:bg-slate-800/60">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Loading permissions...</p>
            </div>
          ) : canViewJobImport ? (
            <div className="flex w-full flex-col gap-4 sm:gap-5">
              <JobImportUploadCard
                canUpload={canUploadJobImport}
                canCreateManualJob={canCreateManualJob}
                onDraftCreated={() => setDraftRefreshKey((current) => current + 1)}
              />

              <JobImportDraftsList
                canViewDrafts={
                  canViewJobImport && (canViewOwnDrafts || canViewAllDrafts || canUploadJobImport)
                }
                canViewAllDrafts={canViewAllDrafts}
                canEditOthersDrafts={canEditOthersDrafts}
                currentUserEmail={currentUserEmail}
                refreshKey={draftRefreshKey}
              />
            </div>
          ) : (
            <div className="min-h-full">
              <BlurredJobImportBackdrop />
            </div>
          )}
        </main>

        {isAccessDenied && (
          <AccessDeniedOverlay message="You do not have permission to view Job Import." />
        )}
      </div>

      {canViewWatchers && showWatchersModal && (
        <HydraTecWatchersModal
          canAdd={canAddWatchers}
          canRevoke={canRevokeWatchers}
          canRegenerateOwn={canRegenerateOwnWatchers}
          canViewAll={canViewAllWatchers}
          currentUserEmail={currentUserEmail}
          onClose={() => setShowWatchersModal(false)}
        />
      )}
    </div>
  );
}
