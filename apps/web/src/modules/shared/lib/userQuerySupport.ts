import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@/modules/shared/types/user";

export const USER_WITH_ROLE_SELECT = `
  id,
  azure_id,
  email,
  name,
  role_id,
  is_active,
  job_title,
  avatar_url,
  role_version,
  last_login_at,
  created_at,
  updated_at,
  role:roles!toolbox_users_role_id_fkey (
    id,
    name,
    description,
    is_system,
    created_at,
    updated_at
  )
`;

export const TITLE_RULE_SELECT = `
  id,
  pattern,
  match_type,
  role_id,
  priority,
  is_active,
  created_at
`;

export interface RoleRecord extends UserRole {
  description?: string | null;
}

export interface ToolboxUserRecord {
  id: string;
  azure_id: string | null;
  email: string;
  name: string;
  role_id: string;
  is_active: boolean;
  job_title: string | null;
  avatar_url: string | null;
  role_version: number;
  last_login_at: string | null;
  created_at: string;
  role: RoleRecord;
}

export interface TitleRoleRule {
  id: string;
  pattern: string;
  match_type: "equals" | "contains" | "starts_with";
  role_id: string;
  priority: number;
  is_active: boolean;
  created_at: string;
}

export interface UserPermissionOverride {
  permission_key: string;
  granted: boolean;
}

let supabaseClient: SupabaseClient | null | undefined;

export function logRoleDbError(operation: string, error: unknown, context?: Record<string, unknown>): void {
  console.error(JSON.stringify({
    level: "error",
    msg: `role db helper failed: ${operation}`,
    context: context ?? {},
    error: error instanceof Error ? error.message : String(error),
  }));
}

export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient !== undefined) {
    return supabaseClient;
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    logRoleDbError("init", new Error("Missing Supabase admin environment variables"), {
      hasUrl: Boolean(url),
      hasServiceRoleKey: Boolean(serviceRoleKey),
    });
    supabaseClient = null;
    return supabaseClient;
  }

  supabaseClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseClient;
}

export function normalizeEmail(email: string | null | undefined): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

export function normalizeJobTitle(jobTitle: string | null | undefined): string {
  return typeof jobTitle === "string" ? jobTitle.trim() : "";
}

function getRoleRecord(userRow: { role?: RoleRecord | RoleRecord[] | null } | null): RoleRecord | null {
  if (!userRow?.role) {
    return null;
  }

  return Array.isArray(userRow.role) ? userRow.role[0] ?? null : userRow.role;
}

export function normalizeUserRow(userRow: ToolboxUserRecord | null): ToolboxUserRecord | null {
  const roleRecord = getRoleRecord(userRow);

  if (!userRow || !roleRecord) {
    return null;
  }

  return {
    ...userRow,
    azure_id: userRow.azure_id ?? null,
    avatar_url: userRow.avatar_url ?? null,
    job_title: userRow.job_title ?? null,
    role_version: Number(userRow.role_version ?? 0),
    role: {
      id: roleRecord.id,
      name: roleRecord.name,
      isSystem: Boolean((roleRecord as RoleRecord & { is_system?: boolean }).is_system ?? roleRecord.isSystem),
      description: roleRecord.description ?? null,
    },
  };
}

export function matchesTitleRule(jobTitle: string, rule: TitleRoleRule): boolean {
  const normalizedTitle = normalizeJobTitle(jobTitle).toLowerCase();
  const normalizedPattern = normalizeJobTitle(rule.pattern).toLowerCase();

  if (!normalizedTitle || !normalizedPattern) {
    return false;
  }

  switch (rule.match_type) {
    case "equals":
      return normalizedTitle === normalizedPattern;
    case "starts_with":
      return normalizedTitle.startsWith(normalizedPattern);
    case "contains":
      return normalizedTitle.includes(normalizedPattern);
    default:
      return false;
  }
}