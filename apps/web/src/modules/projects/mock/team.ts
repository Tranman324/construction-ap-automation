import { mockProjects } from './projects';
import { mockUsers } from './users';
import type { ProjectTeamMember } from '@/modules/projects/types/project';

// Team assignments keep PM ownership intact while distributing superintendent coverage
// across the current project roster for UI/demo purposes.

const baseTeamMembers: ProjectTeamMember[] = [
  { id: 'team-001', project_id: '31-107', user_id: '3751c68d-8660-4bce-b24f-d400f8a5798d', role: 'pm', is_primary: true },
  { id: 'team-024', project_id: '31-107', user_id: '363bccfb-c51a-4e2a-9b6b-f3b3d5181e36', role: 'pm', is_primary: false },
  { id: 'team-002', project_id: '31-107', user_id: 'a4cc9a97-123c-4f2b-9297-a05b5293d1f4', role: 'superintendent', is_primary: true },
  { id: 'team-025', project_id: '31-107', user_id: '9f9f8fc2-58f6-45a8-8728-56de76dc8d1f', role: 'superintendent', is_primary: false },
  { id: 'team-023', project_id: '31-112', user_id: '3751c68d-8660-4bce-b24f-d400f8a5798d', role: 'pm', is_primary: true },
  { id: 'team-026', project_id: '31-112', user_id: '07ccb78a-f5b3-4fff-bd06-55af8cdcbfc2', role: 'pm', is_primary: false },
  { id: 'team-003', project_id: '31-112', user_id: '8221d07a-f1f7-45aa-b71d-3b2707c620ed', role: 'superintendent', is_primary: true },
  { id: 'team-004', project_id: '31-118', user_id: '3116a10f-449d-46bc-bbaf-20efd809daf9', role: 'pm', is_primary: true },
  { id: 'team-027', project_id: '31-118', user_id: '07ccb78a-f5b3-4fff-bd06-55af8cdcbfc2', role: 'pm', is_primary: false },
  { id: 'team-005', project_id: '31-118', user_id: 'eb63a131-a08f-4801-b1a0-5882784d6a5a', role: 'superintendent', is_primary: true },
  { id: 'team-006', project_id: '31-118', user_id: '7e238e1b-d629-4edb-a94b-f1b5a067b57f', role: 'superintendent', is_primary: false },
  { id: 'team-007', project_id: '31-121', user_id: '363bccfb-c51a-4e2a-9b6b-f3b3d5181e36', role: 'pm', is_primary: true },
  { id: 'team-028', project_id: '31-121', user_id: '5d5f1e7f-e189-4f51-88fe-f19688babd5c', role: 'pm', is_primary: false },
  { id: 'team-008', project_id: '31-121', user_id: '7e238e1b-d629-4edb-a94b-f1b5a067b57f', role: 'superintendent', is_primary: true },
  { id: 'team-029', project_id: '31-121', user_id: '8221d07a-f1f7-45aa-b71d-3b2707c620ed', role: 'superintendent', is_primary: false },
  { id: 'team-009', project_id: '31-126', user_id: '3116a10f-449d-46bc-bbaf-20efd809daf9', role: 'pm', is_primary: true },
  { id: 'team-010', project_id: '31-126', user_id: '8221d07a-f1f7-45aa-b71d-3b2707c620ed', role: 'superintendent', is_primary: true },
  { id: 'team-011', project_id: '31-130', user_id: '5d5f1e7f-e189-4f51-88fe-f19688babd5c', role: 'pm', is_primary: true },
  { id: 'team-030', project_id: '31-130', user_id: '3116a10f-449d-46bc-bbaf-20efd809daf9', role: 'pm', is_primary: false },
  { id: 'team-012', project_id: '31-130', user_id: 'a6f39872-28a8-4685-a9bd-c785e26da0bd', role: 'superintendent', is_primary: true },
  { id: 'team-031', project_id: '31-130', user_id: '7e238e1b-d629-4edb-a94b-f1b5a067b57f', role: 'superintendent', is_primary: false },
  { id: 'team-014', project_id: '31-133', user_id: '5d5f1e7f-e189-4f51-88fe-f19688babd5c', role: 'pm', is_primary: true },
  { id: 'team-015', project_id: '31-133', user_id: '9f9f8fc2-58f6-45a8-8728-56de76dc8d1f', role: 'superintendent', is_primary: true },
  { id: 'team-016', project_id: '31-137', user_id: '363bccfb-c51a-4e2a-9b6b-f3b3d5181e36', role: 'pm', is_primary: true },
  { id: 'team-032', project_id: '31-137', user_id: '3116a10f-449d-46bc-bbaf-20efd809daf9', role: 'pm', is_primary: false },
  { id: 'team-017', project_id: '31-137', user_id: 'c3accbb5-7732-47b0-b6cc-1163f1deb807', role: 'superintendent', is_primary: true },
  { id: 'team-033', project_id: '31-137', user_id: 'a6f39872-28a8-4685-a9bd-c785e26da0bd', role: 'superintendent', is_primary: false },
  { id: 'team-018', project_id: '31-140', user_id: '3751c68d-8660-4bce-b24f-d400f8a5798d', role: 'pm', is_primary: true },
  { id: 'team-034', project_id: '31-140', user_id: '5d5f1e7f-e189-4f51-88fe-f19688babd5c', role: 'pm', is_primary: false },
  { id: 'team-019', project_id: '31-140', user_id: 'a4cc9a97-123c-4f2b-9297-a05b5293d1f4', role: 'superintendent', is_primary: true },
  { id: 'team-035', project_id: '31-140', user_id: '7e238e1b-d629-4edb-a94b-f1b5a067b57f', role: 'superintendent', is_primary: false },
  { id: 'team-021', project_id: '31-144', user_id: '3751c68d-8660-4bce-b24f-d400f8a5798d', role: 'pm', is_primary: true },
  { id: 'team-036', project_id: '31-144', user_id: '07ccb78a-f5b3-4fff-bd06-55af8cdcbfc2', role: 'pm', is_primary: false },
  { id: 'team-022', project_id: '31-144', user_id: 'eb63a131-a08f-4801-b1a0-5882784d6a5a', role: 'superintendent', is_primary: true },
  { id: 'team-037', project_id: '31-144', user_id: 'c3accbb5-7732-47b0-b6cc-1163f1deb807', role: 'superintendent', is_primary: false },

  // ─── Pending project teams ─────────────────────────────────────────────────
  // pending-001: Lakeside Bakery Buildout — PM: Paige Lindqvist, Super: Tess Holloway
  { id: 'team-p01-pm', project_id: 'pending-001', user_id: '07ccb78a-f5b3-4fff-bd06-55af8cdcbfc2', role: 'pm', is_primary: true },
  { id: 'team-p01-super', project_id: 'pending-001', user_id: '93732327-3ba1-416d-8e16-928cc38b40c7', role: 'superintendent', is_primary: true },

  // pending-002: Brookfield Office Renovation — PM: Sam Kessler, Super: Hal Pruitt
  { id: 'team-p02-pm', project_id: 'pending-002', user_id: '363bccfb-c51a-4e2a-9b6b-f3b3d5181e36', role: 'pm', is_primary: true },
  { id: 'team-p02-super', project_id: 'pending-002', user_id: 'a4cc9a97-123c-4f2b-9297-a05b5293d1f4', role: 'superintendent', is_primary: true },

  // pending-003: Fairhaven Retail TI — PM: RJ Montoya, Super: Miles Garrity
  { id: 'team-p03-pm', project_id: 'pending-003', user_id: '5d5f1e7f-e189-4f51-88fe-f19688babd5c', role: 'pm', is_primary: true },
  { id: 'team-p03-super', project_id: 'pending-003', user_id: '9f9f8fc2-58f6-45a8-8728-56de76dc8d1f', role: 'superintendent', is_primary: true },
];

const activeSuperintendentIds = mockUsers
  .filter((user) => user.role.name === 'superintendent' && user.is_active)
  .map((user) => user.id);

function ensureSuperintendentCoverage(teamMembers: ProjectTeamMember[]): ProjectTeamMember[] {
  const normalized = teamMembers.map((member) => ({ ...member }));

  for (const [projectIndex, project] of mockProjects.entries()) {
    const projectMembers = normalized.filter((member) => member.project_id === project.id);
    const superMembers = projectMembers.filter((member) => member.role === 'superintendent');

    if (superMembers.length === 0) {
      const fallbackUserId = activeSuperintendentIds[projectIndex % activeSuperintendentIds.length];
      if (!fallbackUserId) {
        continue;
      }

      normalized.push({
        id: `team-auto-super-${project.id}`,
        project_id: project.id,
        user_id: fallbackUserId,
        role: 'superintendent',
        is_primary: true,
      });
      continue;
    }

    if (!superMembers.some((member) => member.is_primary)) {
      const firstSuper = normalized.find(
        (member) => member.project_id === project.id && member.role === 'superintendent',
      );
      if (firstSuper) {
        firstSuper.is_primary = true;
      }
    }
  }

  return normalized;
}

export const mockTeamMembers: ProjectTeamMember[] = ensureSuperintendentCoverage(baseTeamMembers);

export function getTeamForProject(projectId: string): ProjectTeamMember[] {
  return mockTeamMembers.filter((t) => t.project_id === projectId);
}