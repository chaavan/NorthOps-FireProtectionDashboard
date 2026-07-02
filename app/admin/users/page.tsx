'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import DashboardSidebar from '@/components/DashboardSidebar';
import AccessDeniedOverlay from '@/components/AccessDeniedOverlay';
import UserPermissionsModal from '@/components/UserPermissionsModal';
import RolesSection, { type DashboardRoleOption } from '@/components/RolesSection';
import RoleBadge from '@/components/roles/RoleBadge';
import { parseRoleBadgeColor } from '@/lib/roleBadgeColor';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { permissionLoadingFallback } from '@/lib/clientPermissionChecks';
import { softwareConfig } from '@/lib/softwareConfig';
import { formatDateInAppTimeZone } from '@/lib/timezone';
import {
  canActorAssignSystemRole,
  canActorChangeUserRole,
  SYSTEM_ROLE_KEYS,
} from '@/lib/systemRoleClient';

interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isSuperAdmin: boolean;
  isDeveloper: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PasswordResetRequest {
  id: string;
  email: string;
  userName: string | null;
  userRole: string | null;
  createdAt: string;
}

type RoleFilter = 'all' | string;
type AdminTab = 'users' | 'roles';

function AdminUsersPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const { hasPermission, isLoading: isPermissionsLoading, isSuperAdmin: actorIsSuperAdmin, isDeveloper: actorIsDeveloper, refresh: refreshPermissions } = usePermissions();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<DashboardRoleOption[]>([]);
  const [passwordResetRequests, setPasswordResetRequests] = useState<PasswordResetRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  
  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  
  // Form states
  const [newUser, setNewUser] = useState({ email: '', password: '', name: '', role: 'DESIGNER' });
  const [newRole, setNewRole] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [activeTab, setActiveTab] = useState<AdminTab>(
    searchParams?.get('tab') === 'roles' ? 'roles' : 'users',
  );

  const setAdminTab = (tab: AdminTab) => {
    setActiveTab(tab);
    const nextUrl = tab === 'roles' ? '/admin/users?tab=roles' : '/admin/users';
    router.replace(nextUrl, { scroll: false });
  };

  const userRole = (session?.user as any)?.role;
  const loadingFallback = permissionLoadingFallback({
    role: userRole,
    isSuperAdmin: actorIsSuperAdmin,
    isDeveloper: actorIsDeveloper,
  });
  const canViewUsers = isPermissionsLoading ? loadingFallback : hasPermission('users.view');
  const canAddUsers = isPermissionsLoading ? loadingFallback : hasPermission('users.add');
  const canChangeRoles = isPermissionsLoading ? loadingFallback : hasPermission('users.change_role');
  const canResetPasswords = isPermissionsLoading ? loadingFallback : hasPermission('users.reset_password');
  const canTerminateUsers = isPermissionsLoading ? loadingFallback : hasPermission('users.terminate');
  const currentUserId = (session?.user as any)?.id;
  const systemRoleActor = { isSuperAdmin: actorIsSuperAdmin, isDeveloper: actorIsDeveloper };
  const canManagePasswordResets = isPermissionsLoading ? loadingFallback : hasPermission('users.password_resets.manage');
  const canEditPermissions = isPermissionsLoading ? loadingFallback : hasPermission('users.permissions.edit');
  const rolePermissionManagementEnabled = softwareConfig.rolePermissionManagementEnabled;
  const canManageRolePermissions = rolePermissionManagementEnabled && canEditPermissions;

  useEffect(() => {
    if (!rolePermissionManagementEnabled) {
      setActiveTab('users');
      setShowPermissionsModal(false);
      setSelectedUser(null);
      return;
    }
    if (searchParams?.get('tab') === 'roles' && canManageRolePermissions) {
      setActiveTab('roles');
    } else {
      setActiveTab('users');
    }
  }, [searchParams, canManageRolePermissions, rolePermissionManagementEnabled]);

  useEffect(() => {
    if (status === 'loading') return;
    
    if (!session) {
      router.push('/login?callbackUrl=/admin/users');
      return;
    }

    if (!canViewUsers) {
      setIsLoading(false);
      return;
    }

    loadUsers();
    void loadRoles();
    if (canManagePasswordResets) {
      loadPasswordResetRequests();
    }
  }, [session, status, canViewUsers, canManagePasswordResets, router]);

  const loadRoles = async () => {
    try {
      const response = await fetch('/api/roles?includeUserCounts=true', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      setRoles(data.roles || []);
    } catch (err) {
      console.error('Error loading roles:', err);
    }
  };

  const loadUsers = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch('/api/users/list');
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load users');
      }

      const data = await response.json();
      setUsers(data.users || []);
    } catch (err) {
      console.error('Error loading users:', err);
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadPasswordResetRequests = async () => {
    try {
      const response = await fetch('/api/users/password-reset-requests');
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Error loading password reset requests:', errorData.error);
        return;
      }

      const data = await response.json();
      setPasswordResetRequests(data.requests || []);
    } catch (err) {
      console.error('Error loading password reset requests:', err);
    }
  };

  const activeRoles = roles.filter((role) => role.isActive);
  const assignableRoles = activeRoles.filter((role) =>
    canActorAssignSystemRole(systemRoleActor, role.key),
  );
  const canEditTargetUserRole = (user: User) =>
    canChangeRoles &&
    user.id !== currentUserId &&
    (user.role !== SYSTEM_ROLE_KEYS.SUPER_ADMIN || actorIsSuperAdmin || actorIsDeveloper) &&
    (user.role !== SYSTEM_ROLE_KEYS.DEVELOPER || actorIsDeveloper);
  const canTerminateTargetUser = (user: User) =>
    canTerminateUsers &&
    user.id !== currentUserId &&
    (actorIsSuperAdmin || !user.isSuperAdmin) &&
    (actorIsDeveloper || !user.isDeveloper);

  const getRoleBadgeColor = (roleKey: string): string => {
    const role = roles.find((entry) => entry.key === roleKey);
    return role?.colorClass || 'bg-slate-600 text-white';
  };

  const getRoleLabel = (roleKey: string): string => {
    const role = roles.find((entry) => entry.key === roleKey);
    if (role) return role.name;
    if (roleKey === 'PROJECT_MANAGER') return 'Project Manager';
    return roleKey.charAt(0) + roleKey.slice(1).toLowerCase();
  };

  const filteredUsers = users.filter(user => {
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    const matchesSearch = searchTerm === '' || 
      user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false);
    return matchesRole && matchesSearch;
  });

  const editableRoleOptionsForSelectedUser = selectedUser
    ? assignableRoles.filter((role) =>
        canActorChangeUserRole(systemRoleActor, selectedUser.role, role.key),
      )
    : assignableRoles;

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create user');
      }

      setSuccessMessage('User created successfully!');
      setShowAddModal(false);
      setNewUser({ email: '', password: '', name: '', role: 'DESIGNER' });
      await loadUsers();
      
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateRole = async () => {
    if (!selectedUser) return;
    
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/users/update-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id, role: newRole }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update role');
      }

      setSuccessMessage(
        data.message ||
          (newRole === 'ADMIN'
            ? 'User promoted to Admin. They will have full edit access after refreshing the page.'
            : 'Role updated successfully!'),
      );
      setShowEditModal(false);
      setSelectedUser(null);
      await loadUsers();
      
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/users/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id, newPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      setSuccessMessage('Password reset successfully!');
      setShowResetModal(false);
      setSelectedUser(null);
      setNewPassword('');
      
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/users/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to terminate user access');
      }

      setSuccessMessage('User access terminated successfully!');
      setShowDeleteModal(false);
      setSelectedUser(null);
      await loadUsers();
      
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprovePasswordReset = async (requestId: string) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/users/approve-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to approve password reset');
      }

      setSuccessMessage('Password reset approved successfully!');
      await loadPasswordResetRequests();
      
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectPasswordReset = async (requestId: string) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/users/reject-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reject password reset');
      }

      setSuccessMessage('Password reset request rejected');
      await loadPasswordResetRequests();
      
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status === 'loading' || isPermissionsLoading || isLoading) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-slate-600 dark:text-slate-400 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  if (!canViewUsers) {
    return (
      <div className="h-screen bg-slate-100 dark:bg-slate-900 flex">
        <DashboardSidebar />
        <div className="pointer-events-none flex min-w-0 flex-1 select-none flex-col gap-4 overflow-hidden p-6 blur-sm opacity-60">
          <div className="h-24 rounded-xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60" />
          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/60 flex-1" />
        </div>
        <AccessDeniedOverlay message="You do not have permission to view Manage Users." />
      </div>
    );
  }

  return (
    <div className="h-screen bg-slate-100 dark:bg-slate-900 flex">
      {/* Left Sidebar */}
      <DashboardSidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-white dark:bg-slate-800/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700/50">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">
                  User Management
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium">
                  {rolePermissionManagementEnabled ? 'Manage system users and permissions' : 'Manage system users'}
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Success Message */}
        {successMessage && (
          <div className="px-6 pt-4">
            <div className="bg-green-600 text-white p-4 rounded-xl shadow-lg">
              <p className="font-bold">{successMessage}</p>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="px-6 pt-4">
            <div className="bg-red-500 text-white p-4 rounded-xl shadow-lg">
              <p className="font-bold">Error: {error}</p>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden px-6 py-6 bg-slate-100 dark:bg-slate-900 min-h-0">
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700/50 dark:bg-slate-800/60 sm:p-8 dark:shadow-none">
            {rolePermissionManagementEnabled ? (
              <div className="mb-6 flex flex-shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAdminTab('users')}
                  className={`rounded-xl px-6 py-3 font-semibold transition-all ${
                    activeTab === 'users'
                      ? 'bg-blue-600 text-white shadow-lg'
                      : 'border border-slate-300 bg-slate-200 text-slate-600 hover:bg-slate-300 dark:border-slate-600/80 dark:bg-slate-700/50 dark:text-slate-300 dark:hover:bg-slate-700/70'
                  }`}
                >
                  Users ({users.length})
                </button>
                {canManageRolePermissions ? (
                  <button
                    type="button"
                    onClick={() => setAdminTab('roles')}
                    className={`rounded-xl px-6 py-3 font-semibold transition-all ${
                      activeTab === 'roles'
                        ? 'bg-blue-600 text-white shadow-lg'
                        : 'border border-slate-300 bg-slate-200 text-slate-600 hover:bg-slate-300 dark:border-slate-600/80 dark:bg-slate-700/50 dark:text-slate-300 dark:hover:bg-slate-700/70'
                    }`}
                  >
                    Roles ({activeRoles.length})
                  </button>
                ) : null}
              </div>
            ) : null}

            {activeTab === 'roles' && canManageRolePermissions ? (
              <RolesSection embedded fillHeight canManage={canManageRolePermissions} />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Password Reset Requests Section */}
        {canManagePasswordResets && passwordResetRequests.length > 0 && (
          <div className="bg-amber-50 dark:bg-yellow-900/10 border border-amber-300 dark:border-yellow-700/50 rounded-xl p-6 sm:p-8 mb-6 flex-shrink-0">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                  Password Reset Requests
                </h2>
                <span className="px-3 py-1 bg-yellow-500 text-white text-sm font-bold rounded-full">
                  {passwordResetRequests.length}
                </span>
              </div>
            </div>
            
            <div className="space-y-3">
              {passwordResetRequests.map((request) => (
                <div
                  key={request.id}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-white dark:bg-slate-700/50 rounded-xl border border-amber-200 dark:border-yellow-700/50"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-slate-900 dark:text-white">
                      {request.email}
                    </p>
                    {request.userName && (
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        User: {request.userName}
                        {request.userRole && ` (${getRoleLabel(request.userRole)})`}
                      </p>
                    )}
                    <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                      Requested: {formatDateInAppTimeZone(request.createdAt, {
                        year: 'numeric',
                        month: 'numeric',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApprovePasswordReset(request.id)}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-all shadow-md"
                      disabled={isSubmitting}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleRejectPasswordReset(request.id)}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition-all shadow-md"
                      disabled={isSubmitting}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

          {/* Filters and Add Button */}
          <div className="mb-6 flex-shrink-0 space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div className="flex-1 w-full sm:max-w-md relative">
                <input
                  type="text"
                  placeholder="Search by email or name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2.5 pl-11 bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-600/80 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500 shadow-sm hover:border-slate-400 dark:hover:border-slate-500/80 transition-all"
                />
                <svg
                  className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-500 dark:text-slate-400 pointer-events-none"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              {canAddUsers && (
                <button
                  onClick={() => setShowAddModal(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-md"
                >
                  + Add User
                </button>
              )}
            </div>
            
            {/* Role Filters */}
            <div className="flex flex-wrap gap-2">
              <button
                key="all"
                onClick={() => setRoleFilter('all')}
                className={`px-4 py-2 rounded-xl font-semibold text-sm transition-all border ${
                  roleFilter === 'all'
                    ? 'bg-blue-600 text-white shadow-md border-blue-700'
                    : 'bg-slate-200 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600/80 hover:bg-slate-300 dark:hover:bg-slate-700/70'
                }`}
              >
                All Users
              </button>
              {activeRoles.map((role) => {
                const isActive = roleFilter === role.key;
                const parsed = parseRoleBadgeColor(role.colorClass);
                const activeHexStyle =
                  isActive && parsed.mode === 'hex'
                    ? { backgroundColor: parsed.backgroundColor, color: parsed.textColor }
                    : undefined;
                return (
                <button
                  key={role.key}
                  onClick={() => setRoleFilter(role.key)}
                  style={activeHexStyle}
                  className={`px-4 py-2 rounded-xl font-semibold text-sm transition-all border ${
                    isActive
                      ? parsed.mode === 'hex'
                        ? 'shadow-md border-transparent'
                        : `${role.colorClass || 'bg-slate-600 text-white'} shadow-md border-transparent`
                      : 'bg-slate-200 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600/80 hover:bg-slate-300 dark:hover:bg-slate-700/70'
                  }`}
                >
                  {role.name}
                </button>
                );
              })}
            </div>
            
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Showing {filteredUsers.length} of {users.length} users
            </div>
          </div>

          {/* Users Table */}
          <div className="flex-1 overflow-y-auto overflow-x-auto min-h-0">
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="border-b-2 border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/95 backdrop-blur-sm">
                  <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Email</th>
                  <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Name</th>
                  <th className="text-center py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Role</th>
                  <th className="text-center py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Created</th>
                  <th className="text-center py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-sm uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-slate-500 dark:text-slate-400">
                      No users found
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => (
                    <tr
                      key={user.id}
                      className="border-b border-slate-200 dark:border-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-700/30 transition-colors"
                    >
                      <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">{user.email}</td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{user.name || '-'}</td>
                      <td className="py-3 px-4 text-center">
                        <RoleBadge name={getRoleLabel(user.role)} colorClass={roles.find((entry) => entry.key === user.role)?.colorClass ?? getRoleBadgeColor(user.role)} />
                      </td>
                      <td className="py-3 px-4 text-center text-sm text-slate-500 dark:text-slate-400">
                        {formatDateInAppTimeZone(user.createdAt)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          {canManageRolePermissions && (
                            <button
                              onClick={() => {
                                setSelectedUser(user);
                                setShowPermissionsModal(true);
                              }}
                              className="px-3 py-1 bg-indigo-600 dark:bg-indigo-700/50 text-white dark:text-indigo-200 rounded-lg text-xs font-semibold hover:bg-indigo-700 dark:hover:bg-indigo-700/70 transition-all shadow-sm dark:shadow-none border border-indigo-700/20 dark:border-transparent"
                            >
                              Permissions
                            </button>
                          )}
                          {canEditTargetUserRole(user) ? (
                            <button
                              onClick={() => {
                                setSelectedUser(user);
                                setNewRole(user.role);
                                setShowEditModal(true);
                              }}
                              className="px-3 py-1 bg-blue-600 dark:bg-blue-700/50 text-white dark:text-blue-300 rounded-lg text-xs font-semibold hover:bg-blue-700 dark:hover:bg-blue-700/70 transition-all shadow-sm dark:shadow-none border border-blue-700/20 dark:border-transparent"
                              disabled={user.id === currentUserId}
                            >
                              Edit Role
                            </button>
                          ) : null}
                          {canResetPasswords && (
                            <button
                              onClick={() => {
                                setSelectedUser(user);
                                setNewPassword('');
                                setShowResetModal(true);
                              }}
                              className="px-3 py-1 bg-yellow-500 dark:bg-yellow-700/50 text-white dark:text-yellow-300 rounded-lg text-xs font-semibold hover:bg-yellow-600 dark:hover:bg-yellow-700/70 transition-all shadow-sm dark:shadow-none border border-yellow-600/20 dark:border-transparent"
                            >
                              Reset Password
                            </button>
                          )}
                          {canTerminateTargetUser(user) && (
                            <button
                              onClick={() => {
                                setSelectedUser(user);
                                setShowDeleteModal(true);
                              }}
                              className="px-3 py-1 bg-red-600 dark:bg-red-700/50 text-white dark:text-red-300 rounded-lg text-xs font-semibold hover:bg-red-700 dark:hover:bg-red-700/70 transition-all shadow-sm dark:shadow-none border border-red-700/20 dark:border-transparent"
                              disabled={user.id === currentUserId}
                            >
                              Terminate Access
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
              </div>
            )}
          </div>
        </main>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">Add New User</h2>
            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  required
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500"
                  placeholder="user@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  required
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500"
                  placeholder="User Name"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">
                  Password (min 8 characters)
                </label>
                <input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  required
                  minLength={8}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500"
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">
                  Role
                </label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white appearance-none"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                    backgroundPosition: 'right 0.5rem center',
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '1.5em 1.5em',
                    paddingRight: '2.5rem'
                  }}
                >
                  {assignableRoles.map((role) => (
                    <option
                      key={role.key}
                      value={role.key}
                      className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    >
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setNewUser({ email: '', password: '', name: '', role: activeRoles[0]?.key || 'DESIGNER' });
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
                  {isSubmitting ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Role Modal */}
      {showEditModal && selectedUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">Edit User Role</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-4">
              Changing role for: <strong className="text-slate-900 dark:text-white">{selectedUser.email}</strong>
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">
                  Select New Role
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white appearance-none"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                    backgroundPosition: 'right 0.5rem center',
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '1.5em 1.5em',
                    paddingRight: '2.5rem'
                  }}
                >
                  {editableRoleOptionsForSelectedUser.map((role) => (
                    <option
                      key={role.key}
                      value={role.key}
                      className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    >
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowEditModal(false);
                    setSelectedUser(null);
                  }}
                  className="flex-1 px-4 py-2 bg-slate-200 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 rounded-xl font-semibold hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateRole}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-semibold transition-all"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Updating...' : 'Update Role'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showResetModal && selectedUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-red-500 dark:text-red-400 mb-4">Reset Password</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-4">
              Resetting password for: <strong className="text-slate-900 dark:text-white">{selectedUser.email}</strong>
            </p>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">
                  New Password (min 8 characters)
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 text-slate-900 dark:text-white placeholder:text-slate-500"
                  placeholder="••••••••"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowResetModal(false);
                    setSelectedUser(null);
                    setNewPassword('');
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
                  {isSubmitting ? 'Resetting...' : 'Reset Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && selectedUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-red-500 dark:text-red-400 mb-4">Terminate Access</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-2">
              Are you sure you want to terminate access for this user?
            </p>
            <p className="text-slate-900 dark:text-white font-semibold mb-4">
              {selectedUser.email}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">
              They will be signed out immediately and cannot log in again. Their name will remain on past stock returns, inventory logs, and other history.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setSelectedUser(null);
                }}
                className="flex-1 px-4 py-2 bg-slate-200 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 rounded-xl font-semibold hover:bg-slate-300 dark:hover:bg-slate-700/70 transition-all"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteUser}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl font-semibold transition-all"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Terminating...' : 'Terminate Access'}
              </button>
            </div>
          </div>
        </div>
      )}

      {canManageRolePermissions && showPermissionsModal && selectedUser && (
        <UserPermissionsModal
          userId={selectedUser.id}
          onClose={() => {
            setShowPermissionsModal(false);
            setSelectedUser(null);
          }}
          onSaved={() => {
            void loadUsers();
            void refreshPermissions();
          }}
        />
      )}
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-slate-100 dark:bg-slate-900">
          <p className="text-slate-500">Loading...</p>
        </div>
      }
    >
      <AdminUsersPageContent />
    </Suspense>
  );
}
