/** Human-readable label for a system role enum (optional context in emails). */
export function formatSystemRole(role: string | null | undefined): string | null {
  if (!role?.trim()) return null;
  const key = role.trim().toUpperCase();
  const labels: Record<string, string> = {
    ADMIN: 'Admin',
    PROJECT_MANAGER: 'Project Manager',
    SALES: 'Sales',
    DESIGNER: 'Designer',
    VIEWER: 'Viewer',
  };
  return labels[key] ?? role.replace(/_/g, ' ');
}
