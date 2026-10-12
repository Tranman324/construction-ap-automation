import { useQuery } from '@tanstack/react-query';
import {
  ProjectStatus,
  type Project,
  type ProjectFilters,
  type ProjectTeamMember,
} from '@/modules/projects/types/project';
import type { ChecklistInstance, ChecklistType } from '@/modules/projects/types/checklist';
import type { CloseoutItem, CloseoutProject, CloseoutFilters } from '@/modules/projects/types/closeout';
import type { Subcontractor } from '@/modules/projects/types/subcontractor';
import type { ProjectDocument } from '@/modules/projects/types/document';
import type { QualityCheck } from '@/modules/projects/types/qualityCheck';
import type { User } from '@/modules/shared/types/user';
import { evaluateHealthFlags, type HealthResult, type HealthStatus } from '@/modules/projects/lib/healthFlags';
import { normalizePlatformUser } from '@/modules/shared/lib/userProfile';
import { api } from '@/modules/shared/lib/api';

function loadProjectMock() {
  return import('@/modules/projects/mock/index');
}

// ─── Result types ─────────────────────────────────────────────────────────────

interface ProjectListResult {
  data: Project[];
  total: number;
}

function normalizeUser(user: User): User {
  return normalizePlatformUser(user, { fallbackToGeneratedAvatar: true });
}

function getUserMatchKeys(user: User): string[] {
  return [user.id, user.azure_id, user.email.toLowerCase(), user.name.toLowerCase()]
    .filter((value): value is string => Boolean(value));
}

function preferDisplayName(existingName: string, fallbackName: string): string {
  const existingLooksAbbreviated = /\b[A-Z]\./.test(existingName);

  if (existingLooksAbbreviated && fallbackName.length > existingName.length) {
    return fallbackName;
  }

  return existingName || fallbackName;
}

function mergeUsers(apiUsers: User[], fallbackUsers: User[]): User[] {
  const merged: User[] = [];
  const keyToIndex = new Map<string, number>();

  function registerUser(user: User, index: number) {
    for (const key of getUserMatchKeys(user)) {
      keyToIndex.set(key, index);
    }
  }

  for (const user of apiUsers.map(normalizeUser)) {
    const index = merged.push(user) - 1;
    registerUser(user, index);
  }

  for (const fallback of fallbackUsers.map(normalizeUser)) {
    const existingIndex = getUserMatchKeys(fallback)
      .map((key) => keyToIndex.get(key))
      .find((index): index is number => index !== undefined);

    if (existingIndex === undefined) {
      const index = merged.push(fallback) - 1;
      registerUser(fallback, index);
      continue;
    }

    const existing = merged[existingIndex];
    const mergedUser: User = {
      ...fallback,
      ...existing,
      name: preferDisplayName(existing.name, fallback.name),
      role: fallback.role,
      avatar_url: existing.avatar_url || fallback.avatar_url,
      email: existing.email || fallback.email,
      job_title: existing.job_title || fallback.job_title,
      department: existing.department || fallback.department,
      phone: existing.phone ?? fallback.phone,
    };

    merged[existingIndex] = mergedUser;
    registerUser(mergedUser, existingIndex);
  }

  return merged;
}

// ─── useUsers ──────────────────────────────────────────────────────────────────

export function useUsers() {
  return useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const [{ mockUsers }, users] = await Promise.all([
        loadProjectMock(),
        // Demo mode has no API; fall back to the bundled sample users.
        api.get<User[]>('/api/users').catch(() => [] as User[]),
      ]);
      return mergeUsers(users, mockUsers);
    },
    staleTime: 5 * 60_000,
  });
}

// ─── useCurrentUser ────────────────────────────────────────────────────────

export function useCurrentUser() {
  const { data: users } = useUsers();
  return useQuery<User>({
    queryKey: ['current-user', users],
    queryFn: async () => {
      const { mockUsers, MOCK_CURRENT_USER_ID } = await loadProjectMock();
      const list: User[] = users ?? mockUsers;
      return list.find((u) => u.id === MOCK_CURRENT_USER_ID || u.azure_id === MOCK_CURRENT_USER_ID) ?? list[0];
    },
    staleTime: Infinity,
  });
}

interface ProjectStats {
  activeProjects: number;
  needsAttention: number;
  closeoutsInProgress: number;
  checklistsPending: number;
  checklistsTotal: number;
  pendingApproval: number;
  qualityChecksOverdue: number;
  qualityOpenActions: number;
}

// ─── useProjects ──────────────────────────────────────────────────────────────

export function useProjects(filters?: ProjectFilters) {
  return useQuery<ProjectListResult>({
    queryKey: ['projects', filters],
    queryFn: async (): Promise<ProjectListResult> => {
      const { mockProjects, getTeamForProject } = await loadProjectMock();
      let results = [...mockProjects];

      // 0. Exclude soft-deleted
      results = results.filter((p) => p.status !== ProjectStatus.deleted);

      // 1. Search
      if (filters?.search) {
        const q = filters.search.toLowerCase();
        results = results.filter(
          (p) =>
            p.job_name.toLowerCase().includes(q) ||
            p.job_number.toLowerCase().includes(q) ||
            p.address.toLowerCase().includes(q),
        );
      }

      // 2. PM filter
      if (filters?.pm) {
        const pmId = filters.pm;
        results = results.filter((p) =>
          getTeamForProject(p.id).some(
            (m) => m.user_id === pmId && m.role === 'pm',
          ),
        );
      }

      // 3. Superintendent filter
      if (filters?.superintendent) {
        const superId = filters.superintendent;
        results = results.filter((p) =>
          getTeamForProject(p.id).some(
            (m) => m.user_id === superId && m.role === 'superintendent',
          ),
        );
      }

      // 4. Phase filter
      if (filters?.phase && filters.phase.length > 0) {
        results = results.filter((p) => filters.phase!.includes(p.phase));
      }

      // 5. Health filter — Phase 4, pass through unfiltered

      // 6. Status filter
      if (filters?.status) {
        results = results.filter((p) => p.status === filters.status);
      } else {
        // When no explicit status filter, exclude pre-active statuses from general queries
        results = results.filter(
          (p) =>
            p.status !== ProjectStatus.pending_approval &&
            p.status !== ProjectStatus.changes_requested &&
            p.status !== ProjectStatus.rejected &&
            p.status !== ProjectStatus.draft,
        );
      }

      // 7. ShowCompleted toggle (false or undefined → exclude completed/archived)
      if (!filters?.showCompleted) {
        results = results.filter(
          (p) =>
            p.status !== ProjectStatus.completed &&
            p.status !== ProjectStatus.archived &&
            p.status !== ProjectStatus.deleted,
        );
      }

      // Record pre-pagination total
      const total = results.length;

      // 8. Sort
      const dir = filters?.sortDir === 'desc' ? -1 : 1;
      if (filters?.sort === 'name') {
        results = [...results].sort((a, b) =>
          dir * a.job_name.localeCompare(b.job_name),
        );
      } else if (filters?.sort === 'job_number') {
        results = [...results].sort((a, b) =>
          dir * a.job_number.localeCompare(b.job_number, undefined, { numeric: true }),
        );
      } else if (filters?.sort === 'phase') {
        results = [...results].sort((a, b) => dir * (a.phase - b.phase));
      } else if (filters?.sort === 'date') {
        results = [...results].sort(
          (a, b) =>
            dir *
            (new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime()),
        );
      }

      // 9. Pagination
      const page = filters?.page ?? 1;
      const limit = filters?.limit ?? 20;
      const start = (page - 1) * limit;
      results = results.slice(start, start + limit);

      return { data: results, total };
    },
    staleTime: 30_000,
  });
}

// ─── useProject ───────────────────────────────────────────────────────────────

export function useProject(id: string) {
  return useQuery<Project>({
    queryKey: ['project', id],
    queryFn: async () => {
      const { getProjectById } = await loadProjectMock();
      const p = getProjectById(id);
      if (!p) throw new Error(`Project ${id} not found`);
      return p;
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

// ─── useProjectStats ──────────────────────────────────────────────────────────

export function useProjectStats() {
  return useQuery<ProjectStats>({
    queryKey: ['projects-stats'],
    queryFn: async (): Promise<ProjectStats> => {
      const {
        mockProjects,
        getSubsForProject,
        getChecklistsForProject,
        getCloseoutForProject,
        getOverdueQualityChecks,
        getAllOpenActionItems,
      } = await loadProjectMock();
      const nonDeleted = mockProjects.filter((p) => p.status !== ProjectStatus.deleted);

      const activeProjects = nonDeleted.filter(
        (p) => p.status === ProjectStatus.active || p.status === ProjectStatus.onboarding,
      ).length;

      const pendingApproval = nonDeleted.filter(
        (p) => p.status === ProjectStatus.pending_approval,
      ).length;

      const closeoutsInProgress = nonDeleted.filter(
        (p) => p.phase === 3 || p.phase === 4,
      ).length;

      let checklistsPending = 0;
      let checklistsTotal = 0;
      for (const project of nonDeleted) {
        const checklists = getChecklistsForProject(project.id);
        for (const cl of checklists) {
          for (const section of cl.sections) {
            checklistsTotal += section.items.length;
            for (const item of section.items) {
              if (!item.is_completed) checklistsPending++;
            }
          }
        }
      }

      let needsAttention = 0;
      for (const p of nonDeleted) {
        if (p.status === ProjectStatus.completed || p.status === ProjectStatus.archived) continue;
        const { health } = evaluateHealthFlags(
          p,
          getSubsForProject(p.id),
          getChecklistsForProject(p.id),
          getCloseoutForProject(p.id),
        );
        if (health !== 'green') needsAttention++;
      }

      const activeProjectIds = nonDeleted
        .filter((p) => p.status !== ProjectStatus.completed && p.status !== ProjectStatus.archived)
        .map((p) => p.id);
      const qualityChecksOverdue = getOverdueQualityChecks(activeProjectIds).length;
      const qualityOpenActions = getAllOpenActionItems().length;

      return {
        activeProjects,
        needsAttention,
        closeoutsInProgress,
        checklistsPending,
        checklistsTotal,
        pendingApproval,
        qualityChecksOverdue,
        qualityOpenActions,
      };
    },
    staleTime: 60_000,
  });
}

// ─── useProjectTeam ───────────────────────────────────────────────────────────

export function useProjectTeam(projectId: string) {
  return useQuery<ProjectTeamMember[]>({
    queryKey: ['project-team', projectId],
    queryFn: async () => {
      const { getTeamForProject } = await loadProjectMock();
      return getTeamForProject(projectId);
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

// ─── useSubcontractors ────────────────────────────────────────────────────────

export function useSubcontractors(projectId: string) {
  return useQuery<Subcontractor[]>({
    queryKey: ['project-subs', projectId],
    queryFn: async () => {
      const { getSubsForProject } = await loadProjectMock();
      return getSubsForProject(projectId);
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

// ─── useChecklists ────────────────────────────────────────────────────────────

export function useChecklists(projectId: string, type?: ChecklistType) {
  return useQuery<ChecklistInstance[]>({
    queryKey: ['project-checklists', projectId, type],
    queryFn: async () => {
      const { getChecklistsForProject } = await loadProjectMock();
      return getChecklistsForProject(projectId, type);
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

// ─── useCloseout ──────────────────────────────────────────────────────────────

export function useCloseout(projectId: string) {
  return useQuery<CloseoutItem[]>({
    queryKey: ['project-closeout', projectId],
    queryFn: async () => {
      const { getCloseoutForProject } = await loadProjectMock();
      return getCloseoutForProject(projectId);
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

// ─── useCloseoutProjects ──────────────────────────────────────────────────────

export function useCloseoutProjects(filters?: CloseoutFilters) {
  return useQuery<CloseoutProject[]>({
    queryKey: ['closeout-projects', filters],
    queryFn: async () => {
      const { getCloseoutProjects } = await loadProjectMock();
      return getCloseoutProjects(filters);
    },
    staleTime: 30_000,
  });
}

// ─── useCloseoutProject ───────────────────────────────────────────────────────

export function useCloseoutProject(id: string) {
  return useQuery<CloseoutProject | undefined>({
    queryKey: ['closeout-project', id],
    queryFn: async () => {
      const { getCloseoutProjectById } = await loadProjectMock();
      return getCloseoutProjectById(id);
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

// ─── useCloseoutForLinkedProject ──────────────────────────────────────────────

export function useCloseoutForLinkedProject(projectId: string) {
  return useQuery<CloseoutProject | undefined>({
    queryKey: ['closeout-linked', projectId],
    queryFn: async () => {
      const { getCloseoutByProjectId } = await loadProjectMock();
      return getCloseoutByProjectId(projectId);
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

// ─── useSharePointDocuments ───────────────────────────────────────────────────

export function useSharePointDocuments(projectId: string) {
  return useQuery<ProjectDocument[]>({
    queryKey: ['project-documents', projectId],
    queryFn: async () => {
      const { getDocsForProject } = await loadProjectMock();
      return getDocsForProject(projectId);
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

// ─── useProjectFlags ──────────────────────────────────────────────────────────

export function useProjectFlags(projectId: string) {
  return useQuery<HealthResult>({
    queryKey: ['project-flags', projectId],
    queryFn: async () => {
      const {
        getProjectById,
        getSubsForProject,
        getChecklistsForProject,
        getCloseoutForProject,
        getResolvedFlagEntries,
      } = await loadProjectMock();
      const project = getProjectById(projectId);
      if (!project) return { health: 'green' as const, flags: [] };
      const subs = getSubsForProject(projectId);
      const checklists = getChecklistsForProject(projectId);
      const closeout = getCloseoutForProject(projectId);
      const result = evaluateHealthFlags(project, subs, checklists, closeout);
      const resolved = getResolvedFlagEntries(projectId);
      const resolvedTypes = new Set(resolved.map((r) => r.flag_type));
      const activeFlags = result.flags.filter((f) => !resolvedTypes.has(f.flag_type));
      const health: HealthStatus = activeFlags.some((f) => f.severity === 'red')
        ? 'red'
        : activeFlags.some((f) => f.severity === 'yellow')
        ? 'yellow'
        : 'green';
      return { health, flags: activeFlags };
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

// ─── useResolvedFlags ──────────────────────────────────────────────────────────

export interface ResolvedFlagEntry {
  flag_type: string;
  resolved_at: string;
  resolved_by: string;
}

export function useResolvedFlags(projectId: string) {
  return useQuery<ResolvedFlagEntry[]>({
    queryKey: ['project-flags-resolved', projectId],
    queryFn: async () => {
      const { getResolvedFlagEntries } = await loadProjectMock();
      return getResolvedFlagEntries(projectId);
    },
    enabled: !!projectId,
    staleTime: 0,
  });
}

// ─── useQualityChecks ─────────────────────────────────────────────────────────

export function useQualityChecks(projectId: string) {
  return useQuery<QualityCheck[]>({
    queryKey: ['project-quality-checks', projectId],
    queryFn: async () => {
      const { getQualityChecksForProject } = await loadProjectMock();
      return getQualityChecksForProject(projectId);
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}
