'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { isAdmin } from '@/lib/authPermissions';
import JobAccessOverridesModal from '@/components/JobAccessOverridesModal';

interface AccessTabProps {
  jobNumber: string;
  jobName: string;
  listNumberContext?: string | null;
  /** Can the current user manage this job's access list and per-job permission overrides (job.access.manage). */
  canManageOverride?: boolean;
  /** When set, the "Add User" picker only shows users who can view this job type. */
  isServiceJob?: boolean;
}

interface AccessRecord {
  userEmail: string;
  userName: string | null;
  userRole: string | null;
  source?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

function sourceLabel(source?: string | null) {
  if (source === 'AUTO_ALL_JOBS') return 'Auto';
  if (source === 'CREATOR') return 'Creator';
  if (source === 'INITIAL_GRANT') return 'Initial';
  return 'Manual';
}

export default function AccessTab({
  jobNumber,
  jobName,
  listNumberContext,
  canManageOverride,
  isServiceJob,
}: AccessTabProps) {
  const { data: session } = useSession();
  const [accessList, setAccessList] = useState<AccessRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [allUsers, setAllUsers] = useState<Array<{ email: string; name: string | null; role: string | null }>>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [managingUser, setManagingUser] = useState<{ email: string; name: string | null } | null>(null);

  const userRole = (session?.user as any)?.role;
  const userEmail = (session?.user as any)?.email;
  const isUserAdmin = isAdmin(userRole);
  const canManage = isUserAdmin || canManageOverride === true;
  const normalizedListContext =
    typeof listNumberContext === 'string' &&
    listNumberContext.trim().length > 0 &&
    listNumberContext.trim() !== '__ALL__'
      ? listNumberContext.trim()
      : null;
  const effectiveListNumber = normalizedListContext || '1';
  const withListContext = (path: string) => {
    if (!normalizedListContext) return path;
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}listNumber=${encodeURIComponent(normalizedListContext)}`;
  };

  // Load access list
  useEffect(() => {
    loadAccessList();
  }, [jobNumber, normalizedListContext]);

  // Load all users when add form opens
  useEffect(() => {
    if (showAddForm && canManage) {
      loadAllUsers();
    } else if (!showAddForm) {
      // Reset form when closed
      setNewUserEmail('');
      setSearchQuery('');
    }
  }, [showAddForm, canManage, isServiceJob]);

  const loadAccessList = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(withListContext(`/api/jobs/${jobNumber}/access`));
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load access list');
      }

      const data = await response.json();
      setAccessList(data.access || []);
    } catch (err) {
      console.error('Error loading access list:', err);
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadAllUsers = async () => {
    try {
      setIsLoadingUsers(true);
      const url =
        typeof isServiceJob === 'boolean'
          ? `/api/users/for-access?isServiceJob=${isServiceJob}`
          : '/api/users/for-access';
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to load users');
      }

      const data = await response.json();
      // Store all users - we'll filter them in the render based on current accessList
      setAllUsers(data.users || []);
    } catch (err) {
      console.error('Error loading users:', err);
      setAllUsers([]);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  // Add user access (their capability defaults to their normal role permissions;
  // use "Manage permissions" afterwards to override per job)
  const handleAddAccess = async () => {
    if (!newUserEmail.trim()) {
      setError('Please enter a user email');
      return;
    }

    try {
      setIsAdding(true);
      setError(null);

      const response = await fetch(`/api/jobs/${jobNumber}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userEmail: newUserEmail.trim().toLowerCase(),
          listNumberContext: normalizedListContext,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add access');
      }

      // Reset form and reload
      setNewUserEmail('');
      setSearchQuery('');
      setShowAddForm(false);
      await loadAccessList();
      // Reload users list to update available users
      await loadAllUsers();
    } catch (err) {
      console.error('Error adding access:', err);
      setError((err as Error).message);
    } finally {
      setIsAdding(false);
    }
  };

  // Remove access
  const handleRemoveAccess = async (userEmail: string) => {
    if (!confirm(`Are you sure you want to remove access for ${userEmail}?`)) {
      return;
    }

    try {
      setError(null);

      const response = await fetch(withListContext(`/api/jobs/${jobNumber}/access?userEmail=${encodeURIComponent(userEmail)}`), {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to remove access');
      }

      await loadAccessList();
    } catch (err) {
      console.error('Error removing access:', err);
      setError((err as Error).message);
    }
  };

  // Select user from list
  const handleSelectUser = (email: string, name: string | null) => {
    setNewUserEmail(email);
    setSearchQuery(name ? `${name} (${email})` : email);
  };

  // Filter users: exclude only those already in access list.
  // Non-auto-included admins can still be added manually from this list.
  const existingEmails = new Set(accessList.map(a => a.userEmail.toLowerCase()));
  const availableUsers = allUsers.filter(user =>
    !existingEmails.has(user.email.toLowerCase())
  );

  // Filter users based on search query (by name or email)
  const filteredUsers = availableUsers.filter(user => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const emailMatch = user.email.toLowerCase().includes(query);
    const nameMatch = user.name?.toLowerCase().includes(query);
    return emailMatch || nameMatch;
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-slate-400">Loading access list...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Error Message */}
      {error && (
        <div className="bg-red-500 border border-red-600 rounded-xl p-4 flex items-start space-x-3 shadow-lg shadow-red-500/20 backdrop-blur-sm mb-4">
          <svg className="w-6 h-6 text-white flex-shrink-0 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-white">Error</h3>
            <p className="text-sm text-white/90 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-5 shadow-xl backdrop-blur-sm mb-4 flex-shrink-0">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Job Access Management</h2>
          {canManage && (
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold text-sm transition-all shadow-lg"
            >
              {showAddForm ? 'Cancel' : '+ Add User'}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-slate-600 dark:text-slate-400 text-xs font-semibold mb-1">Job Number</p>
            <p className="text-slate-900 dark:text-white font-bold">{jobNumber}</p>
          </div>
          <div>
            <p className="text-slate-600 dark:text-slate-400 text-xs font-semibold mb-1">Job Name</p>
            <p className="text-slate-900 dark:text-white font-bold truncate">{jobName}</p>
          </div>
        </div>
      </div>

      {/* Add User Modal/Popup */}
      {showAddForm && canManage && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800/95 border border-gray-200 dark:border-slate-700/50 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700/50">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">Add User Access</h3>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setNewUserEmail('');
                  setSearchQuery('');
                }}
                className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Content - Scrollable */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Adding a user gives them access to open this job. Their capability once
                  inside follows their normal role permissions — use "Manage permissions"
                  afterwards if you need to grant or remove specific permissions just for
                  this job.
                </p>

                {/* User Search */}
                <div>
                  <label className="block text-sm font-semibold text-slate-900 dark:text-slate-300 mb-2">
                    Search User by Name or Email
                  </label>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Type to search by name or email..."
                    className="w-full px-4 py-2 bg-white dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Users List - Scrollable */}
                <div>
                  <label className="block text-sm font-semibold text-slate-900 dark:text-slate-300 mb-2">
                    Select User {isLoadingUsers && <span className="text-slate-500 dark:text-slate-500 text-xs">(Loading...)</span>}
                  </label>
                  <div className="bg-gray-50 dark:bg-slate-900/80 border border-gray-300 dark:border-slate-600/50 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
                    {isLoadingUsers ? (
                      <div className="p-4 text-center text-slate-600 dark:text-slate-400">Loading users...</div>
                    ) : filteredUsers.length === 0 ? (
                      <div className="p-4 text-center text-slate-600 dark:text-slate-400">
                        {searchQuery ? 'No users found matching your search.' : 'No users available to add.'}
                      </div>
                    ) : (
                      filteredUsers.map((user) => (
                        <button
                          key={user.email}
                          onClick={() => handleSelectUser(user.email, user.name)}
                          className={`w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-slate-700/50 transition-colors border-b border-gray-200 dark:border-slate-600/30 last:border-b-0 ${
                            newUserEmail === user.email ? 'bg-blue-100 dark:bg-blue-600/20 border-blue-300 dark:border-blue-500/30' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="text-slate-900 dark:text-white font-medium">{user.name || 'No name'}</div>
                              <div className="text-slate-600 dark:text-slate-400 text-sm mt-0.5">{user.email}</div>
                            </div>
                            {user.role && (
                              <span className="px-2 py-1 bg-gray-200 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-lg border border-gray-300 dark:border-slate-600/50">
                                {user.role}
                              </span>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                  {!isLoadingUsers && (
                    <p className="text-slate-600 dark:text-slate-500 text-xs mt-2">
                      {searchQuery
                        ? `Showing ${filteredUsers.length} of ${availableUsers.length} available users`
                        : `${availableUsers.length} available user${availableUsers.length !== 1 ? 's' : ''}`
                      }
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-slate-700/50">
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setNewUserEmail('');
                  setSearchQuery('');
                }}
                className="px-4 py-2 bg-gray-100 dark:bg-slate-700/50 border border-gray-300 dark:border-slate-600/50 text-slate-700 dark:text-slate-300 rounded-xl font-semibold hover:bg-gray-200 dark:hover:bg-slate-700/70 hover:text-slate-900 dark:hover:text-white transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleAddAccess}
                disabled={isAdding || !newUserEmail.trim()}
                className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAdding ? 'Adding...' : 'Add Access'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Access List */}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-3">
          {accessList.length === 0 ? (
            <div className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-8 text-center">
              <p className="text-slate-600 dark:text-slate-400">No users have access to this job yet.</p>
              {canManage && (
                <p className="text-slate-500 dark:text-slate-500 text-sm mt-2">Click "Add User" to grant access.</p>
              )}
            </div>
          ) : (
            accessList.map((access) => (
              <div
                key={access.userEmail}
                className="bg-white dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700/50 rounded-xl p-5 shadow-lg"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        {access.userName || access.userEmail}
                      </h3>
                      {access.userEmail === userEmail && (
                        <span className="px-2 py-1 bg-blue-100 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 text-xs font-semibold rounded-lg border border-blue-300 dark:border-blue-600/30">
                          You
                        </span>
                      )}
                      <span className="px-2 py-1 bg-slate-100 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-600/60">
                        {sourceLabel(access.source)}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 text-sm mb-1">{access.userEmail}</p>
                    {access.userRole && (
                      <p className="text-slate-500 dark:text-slate-500 text-xs">
                        System Role: {access.userRole} — capability follows this role unless overridden below
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {canManage && (
                      <button
                        onClick={() => setManagingUser({ email: access.userEmail, name: access.userName })}
                        className="px-3 py-1.5 bg-blue-100 dark:bg-blue-600/20 hover:bg-blue-200 dark:hover:bg-blue-600/30 text-blue-700 dark:text-blue-400 rounded-lg text-sm font-semibold transition-colors border border-blue-300 dark:border-blue-600/30"
                      >
                        Manage permissions
                      </button>
                    )}
                    {canManage && access.userEmail !== userEmail && (
                      <button
                        onClick={() => handleRemoveAccess(access.userEmail)}
                        className="px-3 py-1.5 bg-red-100 dark:bg-red-600/20 hover:bg-red-200 dark:hover:bg-red-600/30 text-red-600 dark:text-red-400 rounded-lg text-sm font-semibold transition-colors border border-red-300 dark:border-red-600/30"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {managingUser && (
        <JobAccessOverridesModal
          jobNumber={jobNumber}
          listNumber={effectiveListNumber}
          userEmail={managingUser.email}
          userName={managingUser.name}
          onClose={() => setManagingUser(null)}
        />
      )}
    </div>
  );
}
