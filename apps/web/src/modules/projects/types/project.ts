export type ProjectTeamRole = 'pm' | 'superintendent';

// ─── Status & Phase ──────────────────────────────────────────────────────────

export enum ProjectStatus {
  draft = 'draft',
  pending_approval = 'pending_approval',
  changes_requested = 'changes_requested',
  rejected = 'rejected',
  onboarding = 'onboarding',
  active = 'active',
  completed = 'completed',
  archived = 'archived',
  deleted = 'deleted',
}

// ─── Onboarding Steps (post-approval) ────────────────────────────────────────

export interface ViewpointTasks {
  spectrum: boolean;
  contacts: boolean;
  file_structure: boolean;
  drawings: boolean;
  daily_logs: boolean;
  submittals: boolean;
  rfis: boolean;
}

export interface OnboardingSteps {
  paycom: boolean;
  viewpoint: boolean;
  viewpoint_tasks: ViewpointTasks;
  aia_a105: boolean;
  permits: boolean;
  notice_of_commencement: boolean;
}

export interface OnboardingCompletion {
  completed_at: string;
  completed_by: string;
}

/** Keys that gate the project (1-4). NOC (5) is tracked separately. */
export const GATE_STEPS: (keyof OnboardingSteps)[] = ['paycom', 'viewpoint', 'aia_a105', 'permits'];

export type Phase = 1 | 2 | 3 | 4;

/** Derived from health flag evaluation; used by HealthBadge and dashboard filtering. */
export type HealthStatus = 'green' | 'yellow' | 'red';

// ─── Team ────────────────────────────────────────────────────────────────────

export interface ProjectTeamMember {
  id: string;
  project_id: string;
  user_id: string;
  role: ProjectTeamRole;
  is_primary: boolean;
}

/**
 * Denormalized join type used by all UI team display components.
 * Extends ProjectTeamMember with user fields so no separate user lookup is needed.
 */
export interface ProjectTeamMemberWithUser extends ProjectTeamMember {
  name: string;
  email: string;
  avatar_url: string;
}

// ─── Health Flags ────────────────────────────────────────────────────────────

/** Used by the health flag engine (Phase 4) and dashboard indicators. */
export interface ProjectFlag {
  id: string;
  project_id: string;
  severity: 'red' | 'yellow';
  flag_text: string;
  flag_type: string;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

// ─── Phase Codes & Billing ───────────────────────────────────────────────────

export interface ProjectPhaseCode {
  phase_code: string;
  description: string;
  /** S=Sub, M=Material, L=Labor, O=Other, E=Equipment, B=Bond, X=Excluded/Non-billable (Spectrum legacy) */
  cost_type: 'S' | 'M' | 'L' | 'O' | 'E' | 'B' | 'X';
  amount: number;
}

export interface ProjectBillingItem {
  item_number: number;
  code?: string;
  description: string;
  amount: number;
}

// ─── Project ─────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  job_number: string;
  job_name: string;
  customer_name: string;
  status: ProjectStatus;
  phase: Phase;
  closeout_type: 'short' | 'full';
  photos_required: boolean;
  contract_value: number;
  estimated_cost?: number | null;
  cost_jtd?: number | null;
  profit_percent: number;
  permit_status: 'not_required' | 'in_process' | 'obtained';
  contract_status: 'not_indicated' | 'in_progress' | 'in_hand';
  start_date: string;
  end_date: string;
  projected_end_date: string;
  address: string;
  lat: number;
  lng: number;
  cost_center: string;
  times_priced: number;
  estimate_number: string;
  job_type: string;
  who_sold: string;
  notes: string;
  phase_codes: ProjectPhaseCode[];
  billing_items: ProjectBillingItem[];
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  deleted_at?: string | null;
  onboarding_steps?: OnboardingSteps | null;
  onboarding_completions?: Record<string, OnboardingCompletion> | null;
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export interface ProjectFilters {
  search?: string;
  /** user_id of the PM to filter by */
  pm?: string;
  /** user_id of the superintendent to filter by */
  superintendent?: string;
  phase?: Phase[];
  /** Health filter — evaluated in Phase 4; pass-through only for now */
  health?: HealthStatus;
  status?: ProjectStatus;
  /** When false or undefined, completed and archived projects are excluded */
  showCompleted?: boolean;
  sort?: 'name' | 'job_number' | 'phase' | 'date';
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}
