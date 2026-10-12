export const HIGH_RISK_KEYS = new Set([
  "platform.admin",
  "platform.manage_users",
  "platform.manage_roles",
  "platform.manage_permissions",
  "platform.manage_title_rules",
  "accounting.invoices.submit_spectrum",
]);

export const ADMIN_DISABLED_PERMISSION_COPY = {
  title: "Restricted permission",
  description:
    "You need elevated access before you can change role permissions, user overrides, or title rules.",
} as const;

export const ADMIN_OVERRIDE_COPY = {
  description:
    "User overrides replace role defaults for one person at a time and should stay rare.",
  emptyState:
    "Select a user to review explicit permission grants or denials beyond their assigned role.",
} as const;

export const ADMIN_PROTECTED_ROLE_COPY = {
  description:
    "System roles stay locked in v1 so the baseline platform access model remains intact.",
} as const;

export const ADMIN_HIGH_RISK_CONFIRMATION_COPY = {
  description:
    "High-risk permission changes require typed confirmation before the update is submitted.",
} as const;

export function getDisabledPermissionReason(permissionKey: string): string {
  return `You cannot change ${permissionKey} until your account has the required admin access.`;
}

export function getOverrideSummary(userName: string): string {
  return `Overrides for ${userName} replace role defaults for that user only.`;
}

export function getProtectedRoleReason(roleName: string): string {
  return `${roleName} is a protected system role and cannot be edited in v1.`;
}

export function getHighRiskConfirmationMessage(permissionKey: string): string {
  return HIGH_RISK_KEYS.has(permissionKey)
    ? `Changing ${permissionKey} affects sensitive platform access and requires explicit confirmation.`
    : `Changing ${permissionKey} still requires confirmation before saving.`;
}