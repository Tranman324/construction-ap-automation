import type { AuditEventCatalog } from "@/modules/shared/types/auditEvent";

export const PLATFORM_ADMIN_EVENTS = {
  "admin.user.role_changed": {
    label: "User role changed",
    severity: "warning",
    targetType: "user",
  },
  "admin.user.permissions_overridden": {
    label: "User permissions overridden",
    severity: "warning",
    targetType: "user",
  },
  "admin.role.created": {
    label: "Role created",
    severity: "info",
    targetType: "role",
  },
  "admin.role.updated": {
    label: "Role updated",
    severity: "warning",
    targetType: "role",
  },
  "admin.role.deleted": {
    label: "Role deleted",
    severity: "critical",
    targetType: "role",
  },
  "admin.title_rule.created": {
    label: "Title rule created",
    severity: "info",
    targetType: "title_rule",
  },
  "admin.title_rule.updated": {
    label: "Title rule updated",
    severity: "info",
    targetType: "title_rule",
  },
  "admin.title_rule.deleted": {
    label: "Title rule deleted",
    severity: "warning",
    targetType: "title_rule",
  },
} as const satisfies AuditEventCatalog;
