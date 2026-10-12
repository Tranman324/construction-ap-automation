/**
 * Shared admin-route contract consumed by the application shell and the
 * platform-admin module. Keep these values stable because they are public URL
 * state for /admin.
 */
export const ADMIN_SECTION_QUERY_PARAM = "section";
export const ADMIN_USER_ID_QUERY_PARAM = "userId";

export const ADMIN_SECTION_IDS = [
  "overview",
  "users",
  "roles",
  "role-perms",
  "overrides",
  "rules",
] as const;

export type AdminSectionId = (typeof ADMIN_SECTION_IDS)[number];

export const FUTURE_ADMIN_SECTION_IDS = [
  "brand-theme",
  "platform-settings",
  "audit-log",
  "notifications",
  "integrations",
  "usage",
] as const;

export type FutureAdminSectionId = (typeof FUTURE_ADMIN_SECTION_IDS)[number];

export interface AdminSectionDefinition {
  id: AdminSectionId;
  label: string;
  queryValue: AdminSectionId;
}

export const DEFAULT_ADMIN_SECTION_ID: AdminSectionId = "overview";

export const ADMIN_SECTION_LABELS: Readonly<Record<AdminSectionId, string>> = {
  overview: "Overview",
  users: "Users",
  roles: "Roles",
  "role-perms": "Role Permissions",
  overrides: "User Overrides",
  rules: "Title Rules",
};

export const ADMIN_SECTION_QUERY_VALUES: Readonly<Record<AdminSectionId, AdminSectionId>> = {
  overview: "overview",
  users: "users",
  roles: "roles",
  "role-perms": "role-perms",
  overrides: "overrides",
  rules: "rules",
};

export const ADMIN_SECTION_OPTIONS: readonly AdminSectionDefinition[] = ADMIN_SECTION_IDS.map((id) => ({
  id,
  label: ADMIN_SECTION_LABELS[id],
  queryValue: ADMIN_SECTION_QUERY_VALUES[id],
}));

const ADMIN_SECTION_SET = new Set<AdminSectionId>(ADMIN_SECTION_IDS);

export function isAdminSectionId(value: string | null | undefined): value is AdminSectionId {
  return typeof value === "string" && ADMIN_SECTION_SET.has(value as AdminSectionId);
}

export function normalizeAdminSection(value: string | null | undefined): AdminSectionId {
  return isAdminSectionId(value) ? value : DEFAULT_ADMIN_SECTION_ID;
}

export function getAdminSectionLabel(sectionId: AdminSectionId): string {
  return ADMIN_SECTION_LABELS[sectionId];
}

export function getAdminSectionQueryValue(sectionId: AdminSectionId): string {
  return ADMIN_SECTION_QUERY_VALUES[sectionId];
}
