import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ProjectStatus,
  GATE_STEPS,
  type Project,
} from '@/modules/projects/types/project';
import type { DocStatus, DocField, GeneralChecklistKey, CloseoutProjectStatus } from '@/modules/projects/types/closeout';
import type { ProjectTeamMember } from '@/modules/projects/types/project';
import type { ChecklistInstance } from '@/modules/projects/types/checklist';
import type { QualityCheck } from '@/modules/projects/types/qualityCheck';

type ProjectMockModule = typeof import('@/modules/projects/mock/index');

let projectMockPromise: Promise<ProjectMockModule> | null = null;

function loadProjectMock(): Promise<ProjectMockModule> {
  projectMockPromise ??= import('@/modules/projects/mock/index');
  return projectMockPromise;
}

// ─── Zapier Stub ──────────────────────────────────────────────────────────────

function logZapierWebhook(project: Project): void {
  console.log('[ZAPIER STUB] Project approved — webhook payload:', {
    projectId: project.id,
    jobNumber: project.job_number,
    jobName: project.job_name,
    customer: project.customer_name,
    approvedBy: project.approved_by,
    approvedAt: project.approved_at,
  });
}

// ─── useCreateProject ─────────────────────────────────────────────────────────

export interface CreateProjectInput extends Partial<Project> {
  pmIds?: string[];
  superIds?: string[];
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation<Project, Error, CreateProjectInput>({
    mutationFn: async (input: CreateProjectInput): Promise<Project> => {
      const {
        FINAL_INSPECTION_SECTIONS,
        IN_PROCESS_SECTIONS,
        PREFLIGHT_SECTIONS,
        mockChecklists,
        mockProjects,
        mockTeamMembers,
        secTodo,
      } = await loadProjectMock();
      const { pmIds, superIds, ...projectFields } = input;
      const now = new Date().toISOString();
      const newProject: Project = {
        id: 'proj-' + Date.now(),
        job_number: '',
        job_name: '',
        customer_name: '',
        status: ProjectStatus.pending_approval,
        phase: 1,
        closeout_type: 'short',
        photos_required: false,
        contract_value: 0,
        estimated_cost: null,
        cost_jtd: null,
        profit_percent: 0,
        permit_status: 'not_required',
        contract_status: 'not_indicated',
        start_date: '',
        end_date: '',
        projected_end_date: '',
        address: '',
        lat: 33.749,   // Default to metro Atlanta (not 0,0 / Null Island)
        lng: -84.388,
        cost_center: '',
        times_priced: 0,
        estimate_number: '',
        job_type: '',
        who_sold: '',
        notes: '',
        phase_codes: [],
        billing_items: [],
        created_at: now,
        approved_at: null,
        approved_by: null,
        ...projectFields,
      };
      mockProjects.push(newProject);

      // Auto-create checklists using the real NCG templates (with photo/input requirements)
      const clBase: Omit<ChecklistInstance, 'id' | 'type' | 'sections'> = {
        project_id: newProject.id,
        started_at: null,
        completed_at: null,
      };

      mockChecklists.push(
        {
          ...clBase,
          id: `cl-${newProject.id}-pf`,
          type: 'preflight',
          sections: PREFLIGHT_SECTIONS.map(([title, defs]) => secTodo(title, [...defs])),
        },
        {
          ...clBase,
          id: `cl-${newProject.id}-ip`,
          type: 'in_process',
          sections: IN_PROCESS_SECTIONS.map(([title, defs]) => secTodo(title, [...defs])),
        },
        {
          ...clBase,
          id: `cl-${newProject.id}-fi`,
          type: 'final_inspections',
          sections: FINAL_INSPECTION_SECTIONS.map(([title, defs]) => secTodo(title, [...defs])),
        },
      );

      // Persist team member assignments
      if (pmIds && pmIds.length > 0) {
        pmIds.forEach((userId, idx) => {
          mockTeamMembers.push({
            id: `tm-${newProject.id}-pm-${idx}`,
            project_id: newProject.id,
            user_id: userId,
            role: 'pm' as ProjectTeamMember['role'],
            is_primary: idx === 0,
          });
        });
      }
      if (superIds && superIds.length > 0) {
        superIds.forEach((userId, idx) => {
          mockTeamMembers.push({
            id: `tm-${newProject.id}-super-${idx}`,
            project_id: newProject.id,
            user_id: userId,
            role: 'superintendent' as ProjectTeamMember['role'],
            is_primary: idx === 0,
          });
        });
      }

      return newProject;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['projects-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['project-team'] });
    },
  });
}

// ─── useUpdateProject ─────────────────────────────────────────────────────────

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation<Project, Error, { id: string; updates: Partial<Project> }>({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Project> }): Promise<Project> => {
      const { mockProjects } = await loadProjectMock();
      const project = mockProjects.find((p) => p.id === id);
      if (!project) {
        throw new Error('Project not found');
      }
      Object.assign(project, updates);
      return project;
    },
    onSuccess: (_data: Project, variables: { id: string; updates: Partial<Project> }) => {
      void queryClient.invalidateQueries({ queryKey: ['project', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

// ─── useApproveProject ────────────────────────────────────────────────────────

export function useApproveProject() {
  const queryClient = useQueryClient();
  return useMutation<Project, Error, { id: string; approvedBy: string }>({
    mutationFn: async ({ id, approvedBy }: { id: string; approvedBy: string }): Promise<Project> => {
      const { getNextJobNumber, mockProjects } = await loadProjectMock();
      const project = mockProjects.find((p) => p.id === id);
      if (!project) {
        throw new Error('Project not found');
      }
      // Assign sequential job number on approval
      const jobNumber = getNextJobNumber();
      project.job_number = jobNumber;
      project.status = ProjectStatus.onboarding;
      project.approved_at = new Date().toISOString();
      project.approved_by = approvedBy;
      project.onboarding_steps = {
        paycom: false,
        viewpoint: false,
        viewpoint_tasks: {
          spectrum: false,
          contacts: false,
          file_structure: false,
          drawings: false,
          daily_logs: false,
          submittals: false,
          rfis: false,
        },
        aia_a105: false,
        permits: false,
        notice_of_commencement: false,
      };
      project.onboarding_completions = {};
      logZapierWebhook(project);
      return project;
    },
    onSuccess: (_data: Project, variables: { id: string; approvedBy: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['project', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['projects-stats'] });
    },
  });
}

// ─── useRejectProject ─────────────────────────────────────────────────────────

export function useRejectProject() {
  const queryClient = useQueryClient();
  return useMutation<Project, Error, { id: string; reason: string }>({
    mutationFn: async ({ id, reason }: { id: string; reason: string }): Promise<Project> => {
      const { mockProjects } = await loadProjectMock();
      const project = mockProjects.find((p) => p.id === id);
      if (!project) {
        throw new Error('Project not found');
      }
      project.status = ProjectStatus.rejected;
      project.notes = reason;
      return project;
    },
    onSuccess: (_data: Project, variables: { id: string; reason: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['project', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['projects-stats'] });
    },
  });
}

// ─── useRequestChanges ────────────────────────────────────────────────────────

export function useRequestChanges() {
  const queryClient = useQueryClient();
  return useMutation<Project, Error, { id: string; notes: string }>({
    mutationFn: async ({ id, notes }: { id: string; notes: string }): Promise<Project> => {
      const { mockProjects } = await loadProjectMock();
      const project = mockProjects.find((p) => p.id === id);
      if (!project) {
        throw new Error('Project not found');
      }
      project.status = ProjectStatus.changes_requested;
      project.notes = project.notes ? `${project.notes}\n${notes}` : notes;
      return project;
    },
    onSuccess: (_data: Project, variables: { id: string; notes: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['project', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

// ─── useToggleGeneralItem ─────────────────────────────────────────────────────

type ToggleGeneralInput = { closeoutId: string; key: GeneralChecklistKey };

export function useToggleGeneralItem() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ToggleGeneralInput>({
    mutationFn: async ({ closeoutId, key }: ToggleGeneralInput) => {
      const { getCloseoutProjectById } = await loadProjectMock();
      const project = getCloseoutProjectById(closeoutId);
      if (!project) throw new Error('Closeout project not found');
      const item = project.generalChecklist[key];
      item.complete = !item.complete;
    },
    onSuccess: (_d: void, v: ToggleGeneralInput) => {
      void queryClient.invalidateQueries({ queryKey: ['closeout-project', v.closeoutId] });
      void queryClient.invalidateQueries({ queryKey: ['closeout-projects'] });
    },
  });
}

// ─── useUpdateTradeDocStatus ──────────────────────────────────────────────────

type UpdateTradeDocInput = { closeoutId: string; tradeCloseoutId: string; field: DocField; status: DocStatus };

export function useUpdateTradeDocStatus() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, UpdateTradeDocInput>({
    mutationFn: async ({ closeoutId, tradeCloseoutId, field, status }: UpdateTradeDocInput) => {
      const { getCloseoutProjectById } = await loadProjectMock();
      const project = getCloseoutProjectById(closeoutId);
      if (!project) throw new Error('Closeout project not found');
      const tc = project.trades.find((t) => t.id === tradeCloseoutId);
      if (!tc) throw new Error('Trade closeout not found');
      if (tc[field] === null) throw new Error('Doc field not applicable for this trade');
      // Safe assign via index signature
      Object.assign(tc, { [field]: status });
    },
    onSuccess: (_d: void, v: UpdateTradeDocInput) => {
      void queryClient.invalidateQueries({ queryKey: ['closeout-project', v.closeoutId] });
      void queryClient.invalidateQueries({ queryKey: ['closeout-projects'] });
    },
  });
}

// ─── useToggleLienWaiver ──────────────────────────────────────────────────────

type ToggleLWInput = { closeoutId: string; lienWaiverId: string };

export function useToggleLienWaiver() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ToggleLWInput>({
    mutationFn: async ({ closeoutId, lienWaiverId }: ToggleLWInput) => {
      const { getCloseoutProjectById } = await loadProjectMock();
      const project = getCloseoutProjectById(closeoutId);
      if (!project) throw new Error('Closeout project not found');
      const waiver = project.lienWaivers.find((w) => w.id === lienWaiverId);
      if (!waiver) throw new Error('Lien waiver not found');
      waiver.received = !waiver.received;
    },
    onSuccess: (_d: void, v: ToggleLWInput) => {
      void queryClient.invalidateQueries({ queryKey: ['closeout-project', v.closeoutId] });
      void queryClient.invalidateQueries({ queryKey: ['closeout-projects'] });
    },
  });
}

// ─── useAddLienWaiver ─────────────────────────────────────────────────────────

type AddLWInput = { closeoutId: string; subcontractorName: string };

export function useAddLienWaiver() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, AddLWInput>({
    mutationFn: async ({ closeoutId, subcontractorName }: AddLWInput) => {
      const { getCloseoutProjectById } = await loadProjectMock();
      const project = getCloseoutProjectById(closeoutId);
      if (!project) throw new Error('Closeout project not found');
      project.lienWaivers.push({
        id: `lw-${Date.now()}`,
        projectId: closeoutId,
        subcontractorName,
        received: false,
      });
    },
    onSuccess: (_d: void, v: AddLWInput) => {
      void queryClient.invalidateQueries({ queryKey: ['closeout-project', v.closeoutId] });
      void queryClient.invalidateQueries({ queryKey: ['closeout-projects'] });
    },
  });
}

// ─── useRemoveLienWaiver ──────────────────────────────────────────────────────

type RemoveLWInput = { closeoutId: string; lienWaiverId: string };

export function useRemoveLienWaiver() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, RemoveLWInput>({
    mutationFn: async ({ closeoutId, lienWaiverId }: RemoveLWInput) => {
      const { getCloseoutProjectById } = await loadProjectMock();
      const project = getCloseoutProjectById(closeoutId);
      if (!project) throw new Error('Closeout project not found');
      const idx = project.lienWaivers.findIndex((w) => w.id === lienWaiverId);
      if (idx === -1) throw new Error('Lien waiver not found');
      project.lienWaivers.splice(idx, 1);
    },
    onSuccess: (_d: void, v: RemoveLWInput) => {
      void queryClient.invalidateQueries({ queryKey: ['closeout-project', v.closeoutId] });
      void queryClient.invalidateQueries({ queryKey: ['closeout-projects'] });
    },
  });
}

// ─── useCreateCloseoutProject ─────────────────────────────────────────────────

type CreateCloseoutInput = { projectId: string | null; jobNumber: string; jobName: string; pmId: string; tradeIds: string[] };

export function useCreateCloseoutProject() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, CreateCloseoutInput>({
    mutationFn: async ({ projectId, jobNumber, jobName, pmId, tradeIds }: CreateCloseoutInput) => {
      const { MASTER_TRADES, mockCloseoutProjects } = await loadProjectMock();
      const id = `co-${Date.now()}`;
      mockCloseoutProjects.push({
        id,
        projectId,
        jobNumber,
        jobName,
        pmId,
        status: 'active',
        generalChecklist: {
          changeOrder: { complete: false },
          permit: { complete: false },
          subList: { complete: false },
          viewpointArchive: { complete: false },
          atticStockReport: { complete: false },
          ncgWarranty: { complete: false },
          tenantAcceptance: { complete: false },
        },
        trades: tradeIds.map((tradeId: string) => {
          const trade = MASTER_TRADES.find((t) => t.id === tradeId)!;
          return {
            id: `tc-${Date.now()}-${tradeId}`,
            projectId: id,
            tradeId,
            trade,
            asBuilts: trade.docs.includes('asBuilts') ? 'pending' as const : null,
            om: trade.docs.includes('om') ? 'pending' as const : null,
            tab: trade.docs.includes('tab') ? 'pending' as const : null,
            warranty: 'pending' as const,
            finalLienWaiver: 'pending' as const,
            note: null,
          };
        }),
        lienWaivers: [],
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['closeout-projects'] });
    },
  });
}

// ─── useUpdateCloseoutStatus ──────────────────────────────────────────────────

type UpdateCloseoutStatusInput = { closeoutId: string; status: CloseoutProjectStatus };

export function useUpdateCloseoutStatus() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, UpdateCloseoutStatusInput>({
    mutationFn: async ({ closeoutId, status }: UpdateCloseoutStatusInput) => {
      const { getCloseoutProjectById } = await loadProjectMock();
      const project = getCloseoutProjectById(closeoutId);
      if (!project) throw new Error('Closeout project not found');
      project.status = status;
    },
    onSuccess: (_d: void, v: UpdateCloseoutStatusInput) => {
      void queryClient.invalidateQueries({ queryKey: ['closeout-project', v.closeoutId] });
      void queryClient.invalidateQueries({ queryKey: ['closeout-projects'] });
    },
  });
}

/** @deprecated Legacy hook — use the new closeout mutations instead. */
export function useUpgradeCloseout() {
  const queryClient = useQueryClient();
  return useMutation<Project, Error, { id: string; projectId: string }>({
    mutationFn: async ({ id }: { id: string; projectId: string }): Promise<Project> => {
      const { mockProjects } = await loadProjectMock();
      const project = mockProjects.find((p) => p.id === id);
      if (!project) throw new Error('Project not found');
      return project;
    },
    onSuccess: (_data: Project, variables: { id: string; projectId: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['project', variables.id] });
    },
  });
}

// ─── useUpdateProjectTeam ─────────────────────────────────────────────────────

export function useUpdateProjectTeam() {
  const queryClient = useQueryClient();
  return useMutation<
    ProjectTeamMember[],
    Error,
    { projectId: string; members: ProjectTeamMember[] }
  >({
    mutationFn: async ({
      projectId,
      members,
    }: {
      projectId: string;
      members: ProjectTeamMember[];
    }): Promise<ProjectTeamMember[]> => {
      const { mockTeamMembers } = await loadProjectMock();
      // Remove existing entries for this project
      const toRemove = mockTeamMembers
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => m.project_id === projectId)
        .map(({ i }) => i)
        .reverse();
      toRemove.forEach((i) => mockTeamMembers.splice(i, 1));
      // Push new members
      members.forEach((m) => mockTeamMembers.push(m));
      return members;
    },
    onSuccess: (
      _data: ProjectTeamMember[],
      variables: { projectId: string; members: ProjectTeamMember[] },
    ) => {
      void queryClient.invalidateQueries({
        queryKey: ['project-team', variables.projectId],
      });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

// ─── useToggleChecklistItem ───────────────────────────────────────────────────

export function useToggleChecklistItem() {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { itemId: string; userId: string }
  >({
    mutationFn: async ({ itemId, userId }: { itemId: string; userId: string }) => {
      const { mockChecklists } = await loadProjectMock();
      for (const cl of mockChecklists) {
        for (const section of cl.sections) {
          const item = section.items.find((it) => it.id === itemId);
          if (item) {
            item.is_completed = !item.is_completed;
            if (item.is_completed) {
              item.completed_by = userId;
              item.completed_at = new Date().toISOString();
            } else {
              item.completed_by = null;
              item.completed_at = null;
            }
            return;
          }
        }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['project-checklists'] });
    },
  });
}

// ─── useAssignSuperintendent ──────────────────────────────────────────────────

export function useAssignSuperintendent() {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { projectId: string; userId: string }
  >({
    mutationFn: async ({ projectId, userId }: { projectId: string; userId: string }) => {
      const { mockTeamMembers } = await loadProjectMock();
      // Remove any existing primary superintendent for this project
      const existing = mockTeamMembers.find(
        (m) => m.project_id === projectId && m.role === 'superintendent' && m.is_primary,
      );
      if (existing) {
        existing.is_primary = false;
      }
      // Check if user is already on the team as super
      const alreadyOnTeam = mockTeamMembers.find(
        (m) => m.project_id === projectId && m.role === 'superintendent' && m.user_id === userId,
      );
      if (alreadyOnTeam) {
        alreadyOnTeam.is_primary = true;
      } else {
        mockTeamMembers.push({
          id: `team-super-${projectId}-${Date.now()}`,
          project_id: projectId,
          user_id: userId,
          role: 'superintendent',
          is_primary: true,
        });
      }
    },
    onSuccess: (_data: void, variables: { projectId: string; userId: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['project-team', variables.projectId] });
      // Force project list to re-render with updated team data
      queryClient.setQueriesData<{ data: Project[]; total: number }>(
        { queryKey: ['projects'] },
        (old) => old ? { ...old, data: [...old.data] } : old,
      );
    },
  });
}

// ─── useRemoveSuperintendent ──────────────────────────────────────────────────

export function useRemoveSuperintendent() {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { projectId: string; userId: string }
  >({
    mutationFn: async ({ projectId, userId }: { projectId: string; userId: string }) => {
      const { mockTeamMembers } = await loadProjectMock();
      // Only remove the specific (non-primary) superintendent
      const idx = mockTeamMembers.findIndex(
        (m) =>
          m.project_id === projectId &&
          m.role === 'superintendent' &&
          m.user_id === userId &&
          !m.is_primary,
      );
      if (idx !== -1) {
        mockTeamMembers.splice(idx, 1);
      }
    },
    onSuccess: (_data: void, variables: { projectId: string; userId: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['project-team', variables.projectId] });
      // Force project list to re-render with updated team data
      queryClient.setQueriesData<{ data: Project[]; total: number }>(
        { queryKey: ['projects'] },
        (old) => old ? { ...old, data: [...old.data] } : old,
      );
    },
  });
}

// ─── useResolveFlag ───────────────────────────────────────────────────────────────────

interface ResolveFlagInput {
  projectId: string;
  flag_type: string;
  resolvedBy: string;
}

export function useResolveFlag() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ResolveFlagInput>({
    mutationFn: async ({ projectId, flag_type, resolvedBy }: ResolveFlagInput): Promise<void> => {
      const { resolveFlag } = await loadProjectMock();
      resolveFlag(projectId, flag_type, resolvedBy);
    },
    onSuccess: (_data: void, { projectId }: ResolveFlagInput) => {
      void queryClient.invalidateQueries({ queryKey: ['project-flags', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['project-flags-resolved', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['projects-stats'] });
    },
  });
}

// ─── useSoftDeleteProject ─────────────────────────────────────────────────────

export function useSoftDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation<Project, Error, { id: string; reason: string }>({
    mutationFn: async ({ id, reason }: { id: string; reason: string }): Promise<Project> => {
      const { mockProjects } = await loadProjectMock();
      const project = mockProjects.find((p) => p.id === id);
      if (!project) {
        throw new Error('Project not found');
      }
      project.status = ProjectStatus.deleted;
      project.deleted_at = new Date().toISOString();
      project.notes = reason;
      return project;
    },
    onSuccess: (_data: Project, variables: { id: string; reason: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['project', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['projects-stats'] });
    },
  });
}

// ─── useUpdateOnboardingStep ──────────────────────────────────────────────────

export function useUpdateOnboardingStep() {
  const queryClient = useQueryClient();
  return useMutation<
    Project,
    Error,
    { id: string; step: keyof NonNullable<Project['onboarding_steps']>; complete: boolean; completedBy?: string }
  >({
    mutationFn: async ({
      id,
      step,
      complete,
      completedBy,
    }: {
      id: string;
      step: keyof NonNullable<Project['onboarding_steps']>;
      complete: boolean;
      completedBy?: string;
    }): Promise<Project> => {
      const { mockProjects } = await loadProjectMock();
      const project = mockProjects.find((p) => p.id === id);
      if (!project) throw new Error('Project not found');
      if (!project.onboarding_steps) {
        project.onboarding_steps = {
          paycom: false,
          viewpoint: false,
          viewpoint_tasks: { spectrum: false, contacts: false, file_structure: false, drawings: false, daily_logs: false, submittals: false, rfis: false },
          aia_a105: false,
          permits: false,
          notice_of_commencement: false,
        };
      }
      project.onboarding_steps[step] = complete as never;
      // Track completion metadata
      if (!project.onboarding_completions) project.onboarding_completions = {};
      if (complete) {
        project.onboarding_completions[step] = {
          completed_at: new Date().toISOString(),
          completed_by: completedBy ?? 'Unknown',
        };
      } else {
        delete project.onboarding_completions[step];
      }
      // Auto-promote to active when all gate steps are complete
      if (project.status === ProjectStatus.onboarding) {
        const allGateDone = GATE_STEPS.every((k) => {
          const v = project.onboarding_steps![k];
          return typeof v === 'boolean' ? v : false;
        });
        if (allGateDone) project.status = ProjectStatus.active;
      }
      return project;
    },
    onSuccess: (_data: Project, variables: { id: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['project', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['projects-stats'] });
    },
  });
}

// ─── useUpdateViewpointTask ───────────────────────────────────────────────────

export function useUpdateViewpointTask() {
  const queryClient = useQueryClient();
  return useMutation<
    Project,
    Error,
    { id: string; task: keyof NonNullable<NonNullable<Project['onboarding_steps']>['viewpoint_tasks']>; complete: boolean; completedBy?: string }
  >({
    mutationFn: async ({
      id,
      task,
      complete,
      completedBy,
    }: {
      id: string;
      task: keyof NonNullable<NonNullable<Project['onboarding_steps']>['viewpoint_tasks']>;
      complete: boolean;
      completedBy?: string;
    }): Promise<Project> => {
      const { mockProjects } = await loadProjectMock();
      const project = mockProjects.find((p) => p.id === id);
      if (!project) throw new Error('Project not found');
      if (!project.onboarding_steps) throw new Error('Onboarding not initialized');
      if (!project.onboarding_steps.viewpoint_tasks) {
        project.onboarding_steps.viewpoint_tasks = {
          spectrum: false, contacts: false, file_structure: false,
          drawings: false, daily_logs: false, submittals: false, rfis: false,
        };
      }
      project.onboarding_steps.viewpoint_tasks[task] = complete;
      // Auto-derive viewpoint boolean from all sub-tasks
      const allDone = Object.values(project.onboarding_steps.viewpoint_tasks).every(Boolean);
      project.onboarding_steps.viewpoint = allDone;
      // Track completion metadata
      if (!project.onboarding_completions) project.onboarding_completions = {};
      if (allDone) {
        project.onboarding_completions.viewpoint = {
          completed_at: new Date().toISOString(),
          completed_by: completedBy ?? 'Unknown',
        };
      } else {
        delete project.onboarding_completions.viewpoint;
      }
      // Auto-promote to active when all gate steps are complete
      if (project.status === ProjectStatus.onboarding) {
        const gateComplete = GATE_STEPS.every((k) => {
          const v = project.onboarding_steps![k];
          return typeof v === 'boolean' ? v : false;
        });
        if (gateComplete) project.status = ProjectStatus.active;
      }
      return project;
    },
    onSuccess: (_data: Project, variables: { id: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['project', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['projects-stats'] });
    },
  });
}

// ─── useResetOnboarding ─────────────────────────────────────────────────────

export function useResetOnboarding() {
  const queryClient = useQueryClient();
  return useMutation<Project, Error, { id: string }>({
    mutationFn: async ({ id }: { id: string }): Promise<Project> => {
      const { mockProjects } = await loadProjectMock();
      const project = mockProjects.find((p) => p.id === id);
      if (!project) throw new Error('Project not found');
      if (project.onboarding_steps) {
        project.onboarding_steps = {
          paycom: false,
          viewpoint: false,
          viewpoint_tasks: {
            spectrum: false,
            contacts: false,
            file_structure: false,
            drawings: false,
            daily_logs: false,
            submittals: false,
            rfis: false,
          },
          aia_a105: false,
          permits: false,
          notice_of_commencement: false,
        };
        project.onboarding_completions = {};
      }
      return project;
    },
    onSuccess: (_data: Project, variables: { id: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['project', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

// ─── useCreateQualityCheck ────────────────────────────────────────────────────

export function useCreateQualityCheck() {
  const queryClient = useQueryClient();
  return useMutation<QualityCheck, Error, QualityCheck>({
    mutationFn: async (check: QualityCheck): Promise<QualityCheck> => {
      const { mockQualityChecks } = await loadProjectMock();
      mockQualityChecks.push(check);
      return check;
    },
    onSuccess: (_data: QualityCheck) => {
      void queryClient.invalidateQueries({ queryKey: ['project-quality-checks', _data.project_id] });
      void queryClient.invalidateQueries({ queryKey: ['projects-stats'] });
    },
  });
}
