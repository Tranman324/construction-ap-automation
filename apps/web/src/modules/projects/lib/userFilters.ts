import type { User } from '@/modules/shared/types/user';

/** Names to exclude from all people dropdowns (e.g. office-only staff not assigned to projects). */
export const EXCLUDED_USER_NAMES = new Set(["Stephanie O'Kelly"]);

export function filterUser(u: User): boolean {
  return u.is_active && !EXCLUDED_USER_NAMES.has(u.name);
}

export const PM_TITLES = /project manager|preconstruction manager|president|director of construction services/i;
export const SUPER_TITLES = /superintendent/i;

export function isPmEligible(u: User): boolean {
  return filterUser(u) && PM_TITLES.test(u.job_title ?? '');
}

export function isSuperEligible(u: User): boolean {
  return filterUser(u) && SUPER_TITLES.test(u.job_title ?? '');
}
