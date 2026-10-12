import type { AdminRole, AdminUserRole, TitleRule } from "@/modules/platform-admin/types/admin";

export function formatAdminRoleName(name: string): string {
  const trimmedName = name.trim();

  if (!trimmedName) {
    return trimmedName;
  }

  return `${trimmedName.charAt(0).toLocaleUpperCase()}${trimmedName.slice(1)}`;
}

export function normalizeAdminRoleName(name: string): string {
  return formatAdminRoleName(name);
}

export function normalizeAdminRole<TRole extends { name: string }>(role: TRole): TRole {
  return {
    ...role,
    name: formatAdminRoleName(role.name),
  };
}

export function normalizeAdminRoles<TRole extends { name: string }>(roles: TRole[]): TRole[] {
  return roles.map(normalizeAdminRole);
}

export function normalizeAdminUserRole(role: AdminUserRole | null): AdminUserRole | null {
  return role ? normalizeAdminRole(role) : null;
}

export function normalizeAdminTitleRules(rules: TitleRule[]): TitleRule[] {
  return rules.map((rule) => ({
    ...rule,
    role_name: rule.role_name ? formatAdminRoleName(rule.role_name) : rule.role_name,
  }));
}

export function formatAdminRoleLabel(roleName: string | null | undefined, fallback = "Unassigned"): string {
  return roleName ? formatAdminRoleName(roleName) : fallback;
}

export function normalizeRoleOptionsFromUsers(users: Array<{ role: AdminUserRole | null }>): AdminRole[] {
  const roleMap = new Map<string, AdminRole>();

  users.forEach((user) => {
    if (!user.role || roleMap.has(user.role.id)) {
      return;
    }

    roleMap.set(user.role.id, {
      id: user.role.id,
      name: formatAdminRoleName(user.role.name),
      description: user.role.description,
      is_system: user.role.is_system,
      user_count: 0,
    });
  });

  return [...roleMap.values()];
}
