import {
  getSupabaseClient,
  logRoleDbError,
  matchesTitleRule,
  normalizeEmail,
  normalizeJobTitle,
  normalizeUserRow,
  TITLE_RULE_SELECT,
  USER_WITH_ROLE_SELECT,
  type RoleRecord,
  type TitleRoleRule,
  type ToolboxUserRecord,
  type UserPermissionOverride,
} from "@/modules/shared/lib/userQuerySupport";

export type {
  RoleRecord,
  TitleRoleRule,
  ToolboxUserRecord,
  UserPermissionOverride,
} from "@/modules/shared/lib/userQuerySupport";

interface UpsertUserInput {
  email: string;
  name: string;
  azureId: string | null;
  jobTitle: string | null;
  roleId: string;
}

async function getUserByField(field: "email" | "id", value: string): Promise<ToolboxUserRecord | null> {
  const supabase = getSupabaseClient();

  if (!supabase || !value) {
    return null;
  }

  const { data, error } = await supabase
    .from("toolbox_users")
    .select(USER_WITH_ROLE_SELECT)
    .eq(field, value)
    .maybeSingle();

  if (error) {
    logRoleDbError(`getUserBy${field === "id" ? "Id" : "Email"}`, error, { [field]: value });
    return null;
  }

  return normalizeUserRow((data as ToolboxUserRecord | null) ?? null);
}

export async function getUserByEmail(email: string): Promise<ToolboxUserRecord | null> {
  const normalizedEmail = normalizeEmail(email);
  return normalizedEmail ? getUserByField("email", normalizedEmail) : null;
}

export async function getUserById(userId: string): Promise<ToolboxUserRecord | null> {
  return userId ? getUserByField("id", userId) : null;
}

export async function getRoleByName(name: string): Promise<RoleRecord | null> {
  const supabase = getSupabaseClient();
  if (!supabase || !name) {
    return null;
  }

  const { data, error } = await supabase
    .from("roles")
    .select("id, name, description, is_system")
    .ilike("name", name)
    .maybeSingle();

  if (error) {
    logRoleDbError("getRoleByName", error, { name });
    return null;
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    name: data.name,
    description: data.description ?? null,
    isSystem: Boolean(data.is_system),
  };
}

export async function getRolePermissions(roleId: string): Promise<string[]> {
  const supabase = getSupabaseClient();
  if (!supabase || !roleId) {
    return [];
  }

  const { data, error } = await supabase
    .from("role_permissions")
    .select("permission_key")
    .eq("role_id", roleId)
    .eq("granted", true);

  if (error) {
    logRoleDbError("getRolePermissions", error, { roleId });
    return [];
  }

  return (data ?? []).map((row) => row.permission_key).filter(Boolean).sort();
}

export async function getUserOverrides(userId: string): Promise<UserPermissionOverride[]> {
  const supabase = getSupabaseClient();
  if (!supabase || !userId) {
    return [];
  }

  const { data, error } = await supabase
    .from("user_permission_overrides")
    .select("permission_key, granted")
    .eq("user_id", userId);

  if (error) {
    logRoleDbError("getUserOverrides", error, { userId });
    return [];
  }

  return (data ?? []).map((row) => ({
    permission_key: row.permission_key,
    granted: Boolean(row.granted),
  }));
}

export async function getUserPermissions(userId: string): Promise<string[]> {
  const supabase = getSupabaseClient();
  const user = await getUserById(userId);

  if (!supabase || !user || !user.role_id) {
    return [];
  }

  if (user.role.name === "admin" && user.role.isSystem) {
    const { data, error } = await supabase.from("permissions").select("key").order("key", { ascending: true });

    if (error) {
      logRoleDbError("getUserPermissions.adminPermissions", error, { userId });
      return [];
    }

    return (data ?? []).map((row) => row.key).filter(Boolean);
  }

  const [rolePermissions, overrides] = await Promise.all([
    getRolePermissions(user.role_id),
    getUserOverrides(userId),
  ]);
  const effectivePermissions = new Set(rolePermissions);

  overrides.forEach((override) => {
    if (!override.permission_key) {
      return;
    }

    if (override.granted) {
      effectivePermissions.add(override.permission_key);
      return;
    }

    effectivePermissions.delete(override.permission_key);
  });

  return Array.from(effectivePermissions).sort();
}

export async function matchTitleRule(jobTitle: string | null): Promise<TitleRoleRule | null> {
  const supabase = getSupabaseClient();
  const normalizedJobTitle = normalizeJobTitle(jobTitle);

  if (!supabase || !normalizedJobTitle) {
    return null;
  }

  const { data, error } = await supabase
    .from("title_role_rules")
    .select(TITLE_RULE_SELECT)
    .eq("is_active", true)
    .order("priority", { ascending: false });

  if (error) {
    logRoleDbError("matchTitleRule", error, { jobTitle: normalizedJobTitle });
    return null;
  }

  return ((data as TitleRoleRule[] | null) ?? []).find((rule) => matchesTitleRule(normalizedJobTitle, rule)) ?? null;
}

export async function upsertUser(input: UpsertUserInput): Promise<ToolboxUserRecord | null> {
  const supabase = getSupabaseClient();
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedJobTitle = normalizeJobTitle(input.jobTitle);

  if (!supabase || !normalizedEmail || !input.name || !input.roleId) {
    return null;
  }

  const payload = {
    email: normalizedEmail,
    name: input.name,
    azure_id: input.azureId || null,
    job_title: normalizedJobTitle || null,
    role_id: input.roleId,
    last_login_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("toolbox_users").upsert(payload, { onConflict: "email" });

  if (error) {
    logRoleDbError("upsertUser", error, { email: normalizedEmail, roleId: input.roleId });
    return null;
  }

  return getUserByEmail(normalizedEmail);
}

export async function bumpRoleVersion(userId: string): Promise<{ id: string; role_version: number } | null> {
  const supabase = getSupabaseClient();
  if (!supabase || !userId) {
    return null;
  }

  // Atomic increment via DB function — no read-then-update race condition
  const { data, error } = await supabase.rpc("bump_role_version", { p_user_id: userId });

  if (error) {
    logRoleDbError("bumpRoleVersion", error, { userId });
    return null;
  }

  const rows = data as Array<{ id: string; role_version: number }> | null;

  if (!rows || rows.length === 0) {
    return null;
  }

  return { id: rows[0].id, role_version: Number(rows[0].role_version ?? 0) };
}