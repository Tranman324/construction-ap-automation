import type { User } from '@/modules/shared/types/user';

export { mockUsers } from './users';
export { mockProjects, getProjectById } from './projects';
export { mockTeamMembers, getTeamForProject } from './team';
export { mockSubcontractors, getSubsForProject } from './subcontractors';
export { mockChecklists, getChecklistsForProject, secTodo, PREFLIGHT_SECTIONS, IN_PROCESS_SECTIONS, FINAL_INSPECTION_SECTIONS } from './checklists';
export { mockQualityChecks, getQualityChecksForProject, getLatestQualityCheck, getAllOpenActionItems, getOverdueQualityChecks } from './qualityChecks';
export { mockCloseoutItems, getCloseoutForProject, mockCloseoutProjects, getCloseoutProjects, getCloseoutProjectById, getCloseoutByProjectId } from './closeout';
export { MASTER_TRADES, getTradeById, ALL_DOC_FIELDS } from './trades';
export { mockDocuments, getDocsForProject } from './documents';
export { getSiteCheckins } from './siteCheckins';
export type { SiteCheckinSummary, DailyCheckin } from './siteCheckins';
export { getProjectContacts } from './projectContacts';
export type { ProjectContact } from './projectContacts';
export { getTeamScraperData } from './teamScraperData';
export type { TeamScraperData } from './teamScraperData';
export { ORG_NAME, DEFAULT_RETAINAGE_PERCENT, CUSTOMER_OPTIONS, SOV_ITEMS } from './referenceData';
export type { SovItem } from './referenceData';

// ─── User Lookup Helper ──────────────────────────────────────────────────────

import { mockUsers as _users } from './users';

export function getUserById(id: string): User | null {
  return _users.find((u) => u.id === id || u.azure_id === id) ?? null;
}

// ─── Mock Current User ────────────────────────────────────────────────────────
// Change this id to test different roles:
//   '34b72754-7b7e-41d9-b032-5cac62ac9b7c' → admin (Alex Morgan)
//   '363bccfb-c51a-4e2a-9b6b-f3b3d5181e36' → pm (Sam Kessler)
//   'a4cc9a97-123c-4f2b-9297-a05b5293d1f4' → superintendent (Hal Pruitt)
export const MOCK_CURRENT_USER_ID = '34b72754-7b7e-41d9-b032-5cac62ac9b7c';

// ─── Mock Health Derivation ──────────────────────────────────────────────────
// Phase 4 replaces this with the real health flag engine.

import { ProjectStatus, type Project, type HealthStatus } from '@/modules/projects/types/project';
import { mockProjects as _projects } from './projects';

// ─── Job Number Generation ───────────────────────────────────────────────────

export function getNextJobNumber(): string {
  const year = new Date().getFullYear().toString().slice(-2); // "26"
  const existing = _projects
    .map((p) => p.job_number)
    .filter((jn) => jn.startsWith(`${year}-`))
    .map((jn) => parseInt(jn.split('-')[1], 10))
    .filter((n) => !isNaN(n));
  const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  return `${year}-${String(next).padStart(3, '0')}`;
}

export function getProjectHealth(project: Project): { health: HealthStatus; flagCount: number } {
  // Deleted → skip
  if (project.status === ProjectStatus.deleted) {
    return { health: 'green', flagCount: 0 };
  }

  // Pending / changes-requested / rejected → yellow (needs action)
  if (
    project.status === ProjectStatus.pending_approval ||
    project.status === ProjectStatus.changes_requested ||
    project.status === ProjectStatus.rejected
  ) {
    return { health: 'yellow', flagCount: 1 };
  }

  // Phase 3-4 (close out / complete) and still active → red (overdue risk)
  if (
    (project.status === ProjectStatus.active || project.status === ProjectStatus.onboarding) &&
    (project.phase === 3 || project.phase === 4)
  ) {
    return { health: 'red', flagCount: 2 };
  }

  // Past projected end date and still active → yellow
  if (
    (project.status === ProjectStatus.active || project.status === ProjectStatus.onboarding) &&
    project.projected_end_date &&
    new Date(project.projected_end_date) < new Date()
  ) {
    return { health: 'yellow', flagCount: 1 };
  }

  return { health: 'green', flagCount: 0 };
}

// ─── Mock Flag Resolution Store ───────────────────────────────────────────────
// Keyed by projectId → array of resolved flag_type strings with metadata

interface ResolvedFlagEntry {
  flag_type: string;
  resolved_at: string;
  resolved_by: string;
}

const _resolvedFlags = new Map<string, ResolvedFlagEntry[]>();

export function getResolvedFlagEntries(projectId: string): ResolvedFlagEntry[] {
  return _resolvedFlags.get(projectId) ?? [];
}

export function resolveFlag(projectId: string, flag_type: string, resolved_by: string): void {
  const existing = _resolvedFlags.get(projectId) ?? [];
  if (!existing.some((e) => e.flag_type === flag_type)) {
    existing.push({ flag_type, resolved_at: new Date().toISOString(), resolved_by });
    _resolvedFlags.set(projectId, existing);
  }
}
