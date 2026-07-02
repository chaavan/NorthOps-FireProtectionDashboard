'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatDateInAppTimeZone } from '@/lib/timezone';

interface Watcher {
  id: string;
  name: string;
  keyPrefix: string;
  createdBy: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

// A watcher checks in roughly once a minute; treat anything older than 3x that as stale.
const STALE_THRESHOLD_MS = 3 * 60 * 1000;

function getStatus(watcher: Watcher): { label: string; dotClass: string; textClass: string } {
  if (watcher.revokedAt) {
    return { label: 'Revoked', dotClass: 'bg-slate-400', textClass: 'text-slate-500 dark:text-slate-400' };
  }
  if (!watcher.lastSeenAt) {
    return { label: 'Never connected', dotClass: 'bg-slate-400', textClass: 'text-slate-500 dark:text-slate-400' };
  }
  const age = Date.now() - new Date(watcher.lastSeenAt).getTime();
  if (age <= STALE_THRESHOLD_MS) {
    return { label: 'Connected', dotClass: 'bg-green-500', textClass: 'text-green-600 dark:text-green-400' };
  }
  return { label: 'Disconnected', dotClass: 'bg-red-500', textClass: 'text-red-600 dark:text-red-400' };
}

function downloadTextFile(content: string, fileName: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface IssuedSecret {
  name: string;
  secret: string;
  scriptContent: string;
  scriptFileName: string;
  launcherBatContent: string;
}

function downloadWatcherFiles(issued: IssuedSecret) {
  downloadTextFile(issued.scriptContent, issued.scriptFileName);
  const batFileName = issued.scriptFileName.replace(/\.ps1$/i, '.bat');
  downloadTextFile(issued.launcherBatContent, batFileName);
}

function WatcherSetupSteps() {
  const steps = [
    {
      title: 'Download the files',
      body: 'Save the .ps1 and .bat to the HydraLIST PC — same folder, e.g. Documents.',
    },
    {
      title: 'Run the .bat file once',
      body: 'Use the .bat, not the .ps1. Windows blocks .ps1 files opened from a browser.',
    },
    {
      title: 'Check the system tray',
      body: 'A flame icon means it is running. It will start automatically at login.',
    },
  ];

  return (
    <ol className="space-y-3">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            {index + 1}
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{step.title}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

interface HydraTecWatchersModalProps {
  canAdd?: boolean;
  canRevoke?: boolean;
  canRegenerateOwn?: boolean;
  canViewAll?: boolean;
  currentUserEmail?: string;
  onClose: () => void;
}

export default function HydraTecWatchersModal({
  canAdd = false,
  canRevoke = false,
  canRegenerateOwn = false,
  canViewAll = false,
  currentUserEmail = '',
  onClose,
}: HydraTecWatchersModalProps) {
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newWatcherName, setNewWatcherName] = useState('');
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [selectedWatcher, setSelectedWatcher] = useState<Watcher | null>(null);

  const [issuedSecret, setIssuedSecret] = useState<IssuedSecret | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  const loadWatchers = useCallback(async (includeRevoked: boolean) => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`/api/admin/hydratec-watchers${includeRevoked ? '?includeRevoked=true' : ''}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load watchers');
      }
      const data = await response.json();
      setWatchers(data.watchers || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWatchers(showRevoked);
  }, [loadWatchers, showRevoked]);

  useEffect(() => {
    const interval = setInterval(() => loadWatchers(showRevoked), 30_000);
    return () => clearInterval(interval);
  }, [loadWatchers, showRevoked]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/hydratec-watchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newWatcherName }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create watcher');
      }

      setIssuedSecret({ name: data.watcher.name, secret: data.secret, scriptContent: data.scriptContent, scriptFileName: data.scriptFileName, launcherBatContent: data.launcherBatContent });
      setShowAddModal(false);
      setNewWatcherName('');
      await loadWatchers(showRevoked);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegenerate = async (watcher: Watcher) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/hydratec-watchers/${watcher.id}/regenerate`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to regenerate key');
      }

      setIssuedSecret({ name: data.watcher.name, secret: data.secret, scriptContent: data.scriptContent, scriptFileName: data.scriptFileName, launcherBatContent: data.launcherBatContent });
      await loadWatchers(showRevoked);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async () => {
    if (!selectedWatcher) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/hydratec-watchers/${selectedWatcher.id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to revoke watcher');
      }

      setSuccessMessage('Watcher revoked.');
      setShowRevokeModal(false);
      setSelectedWatcher(null);
      await loadWatchers(showRevoked);
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-200 dark:border-slate-700/50 flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">HydraTec Watchers</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Local watcher scripts that auto-upload .hvuf exports from HydraLIST PCs
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {successMessage && (
          <div className="px-6 pt-4 flex-shrink-0">
            <div className="bg-green-600 text-white p-3 rounded-xl shadow-lg text-sm font-bold">{successMessage}</div>
          </div>
        )}
        {error && (
          <div className="px-6 pt-4 flex-shrink-0">
            <div className="bg-red-500 text-white p-3 rounded-xl shadow-lg text-sm font-bold">Error: {error}</div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="text-sm text-slate-500 dark:text-slate-400">
                {isLoading ? 'Loading…' : `${watchers.length} watcher${watchers.length === 1 ? '' : 's'}`}
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showRevoked}
                  onChange={(e) => setShowRevoked(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500/50"
                />
                Show revoked
              </label>
            </div>
            {canAdd && (
              <button
                onClick={() => setShowAddModal(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-xl font-semibold text-sm transition-all shadow-md"
              >
                + Add Watcher
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-slate-200 dark:border-slate-700/50">
                  <th className="text-left py-2 px-3 font-bold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Name</th>
                  <th className="text-left py-2 px-3 font-bold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Status</th>
                  <th className="text-left py-2 px-3 font-bold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Last Seen</th>
                  <th className="text-left py-2 px-3 font-bold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Created</th>
                  {canViewAll && (
                    <th className="text-left py-2 px-3 font-bold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Owner</th>
                  )}
                  <th className="text-center py-2 px-3 font-bold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                {watchers.length === 0 ? (
                  <tr>
                    <td colSpan={canViewAll ? 6 : 5} className="text-center py-8 text-slate-500 dark:text-slate-400">
                      {isLoading ? 'Loading…' : canAdd ? 'No watchers yet. Click "+ Add Watcher" to set one up.' : 'No watchers available.'}
                    </td>
                  </tr>
                ) : (
                  watchers.map((watcher) => {
                    const watcherStatus = getStatus(watcher);
                    const isOwnWatcher =
                      watcher.createdBy?.trim().toLowerCase() === currentUserEmail.trim().toLowerCase();
                    const canRegenerateWatcher = canRegenerateOwn && isOwnWatcher;
                    const hasActions = canRegenerateWatcher || canRevoke;
                    return (
                      <tr key={watcher.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">{watcher.name}</td>
                        <td className="py-2.5 px-3">
                          <span className={`inline-flex items-center gap-2 text-sm font-semibold ${watcherStatus.textClass}`}>
                            <span className={`w-2 h-2 rounded-full ${watcherStatus.dotClass}`} />
                            {watcherStatus.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-sm text-slate-500 dark:text-slate-400">
                          {watcher.lastSeenAt ? formatDateInAppTimeZone(watcher.lastSeenAt) : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-sm text-slate-500 dark:text-slate-400">
                          {formatDateInAppTimeZone(watcher.createdAt)}
                        </td>
                        {canViewAll && (
                          <td className="py-2.5 px-3 text-sm text-slate-500 dark:text-slate-400">
                            {watcher.createdBy || '-'}
                          </td>
                        )}
                        <td className="py-2.5 px-3">
                          <div className="flex items-center justify-center gap-2">
                            {canRegenerateWatcher && (
                              <button
                                onClick={() => handleRegenerate(watcher)}
                                disabled={isSubmitting || Boolean(watcher.revokedAt)}
                                className="px-3 py-1 bg-blue-600 dark:bg-blue-700/50 text-white dark:text-blue-300 rounded-lg text-xs font-semibold hover:bg-blue-700 dark:hover:bg-blue-700/70 transition-all disabled:opacity-50"
                              >
                                Regenerate &amp; Reconnect
                              </button>
                            )}
                            {canRevoke && (
                              <button
                                onClick={() => {
                                  setSelectedWatcher(watcher);
                                  setShowRevokeModal(true);
                                }}
                                disabled={isSubmitting || Boolean(watcher.revokedAt)}
                                className="px-3 py-1 bg-red-600 dark:bg-red-700/50 text-white dark:text-red-300 rounded-lg text-xs font-semibold hover:bg-red-700 dark:hover:bg-red-700/70 transition-all disabled:opacity-50"
                              >
                                Revoke
                              </button>
                            )}
                            {!hasActions && (
                              <span className="text-xs text-slate-400 dark:text-slate-500">No actions</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add Watcher Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">Add Watcher</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              Give it a name so you can tell watchers apart (e.g. the PC or location it runs on).
            </p>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">Name</label>
                <input
                  type="text"
                  value={newWatcherName}
                  onChange={(e) => setNewWatcherName(e.target.value)}
                  required
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500"
                  placeholder="Front Office PC"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setNewWatcherName('');
                  }}
                  className="flex-1 px-4 py-2 bg-slate-200 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 rounded-xl font-semibold hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-semibold transition-all"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* One-time secret + script download */}
      {issuedSecret && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-700/50">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                Setup
              </p>
              <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">
                {issuedSecret.name}
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Install the watcher on the PC that runs HydraLIST.
              </p>
            </div>

            <div className="space-y-5 px-6 py-5">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-950/20">
                <p className="text-sm text-amber-950 dark:text-amber-100">
                  <span className="font-semibold">Download now.</span> The credential is only shown once.
                  If you lose it, use <span className="font-medium">Regenerate &amp; Reconnect</span> on this watcher.
                </p>
              </div>

              <button
                type="button"
                onClick={() => downloadWatcherFiles(issuedSecret)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download watcher files
              </button>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Downloads{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                  {issuedSecret.scriptFileName}
                </code>{' '}
                and{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                  {issuedSecret.scriptFileName.replace(/\.ps1$/i, '.bat')}
                </code>
              </p>

              <WatcherSetupSteps />

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700/50 dark:bg-slate-900/40">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Good to know
                </p>
                <ul className="mt-2 space-y-2 text-sm text-slate-600 dark:text-slate-400">
                  <li>
                    If SmartScreen warns you, choose <span className="font-medium text-slate-700 dark:text-slate-300">More info</span>, then{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-300">Run anyway</span>.
                  </li>
                  <li>
                    Right-click the tray icon for status, pause, log, or uninstall.
                  </li>
                  <li>
                    Default folder:{' '}
                    <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      Documents\HydraTec Exports
                    </code>
                    . Change <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">$WatchFolder</code> in the .ps1 if needed.
                  </li>
                </ul>
              </div>
            </div>

            <div className="border-t border-slate-200 px-6 py-4 dark:border-slate-700/50">
              <button
                type="button"
                onClick={() => setIssuedSecret(null)}
                className="w-full rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-700/50 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke Confirmation Modal */}
      {showRevokeModal && selectedWatcher && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-red-500 dark:text-red-400 mb-4">Revoke Watcher</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-2">Are you sure you want to revoke this watcher?</p>
            <p className="text-slate-900 dark:text-white font-semibold mb-4">{selectedWatcher.name}</p>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">
              The script running on that PC will stop being able to upload files immediately.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowRevokeModal(false);
                  setSelectedWatcher(null);
                }}
                className="flex-1 px-4 py-2 bg-slate-200 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 rounded-xl font-semibold hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                onClick={handleRevoke}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl font-semibold transition-all"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Revoking...' : 'Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
