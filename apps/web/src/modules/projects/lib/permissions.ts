import type { User } from '@/modules/shared/types/user';
import { getTeamForProject } from '@/modules/projects/mock/index';

export type PermissionAction =
  | 'view'
  | 'edit'
  | 'create'
  | 'approve'
  | 'manage_team'
  | 'complete_checklist';

/**
 * Returns true if `user` may perform `action` on the given project (or globally
 * if projectId is null — used for create/approve which are not project-scoped).
 */
export function canAccess(
  user: User,
  projectId: string | null,
  action: PermissionAction,
): boolean {
  const { role } = user;
  const roleName = role.name;

  // Admin has full access
  if (roleName === 'admin') return true;

  // Create and approve are admin only
  if (action === 'create' || action === 'approve') return false;

  // All remaining actions require a project context
  if (!projectId) return false;

  const team = getTeamForProject(projectId);
  const isAssigned = team.some((m) => m.user_id === user.id || m.user_id === user.azure_id);

  if (roleName === 'superintendent') {
    // Supers can view and complete checklists on their assigned projects only
    if (!isAssigned) return false;
    return action === 'view' || action === 'complete_checklist';
  }

  if (roleName === 'pm') {
    if (!isAssigned) return action === 'view'; // PMs can view all projects
    // Assigned PM: edit, manage_team
    return true;
  }

  return false;
}
