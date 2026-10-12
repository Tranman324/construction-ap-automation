import type { PermissionMatrixFeedback } from "@/modules/platform-admin/components/PermissionMatrix";

export interface RoleScopedPermissions {
  roleId: string;
  permissions: string[];
}

export interface RoleScopedFeedback extends PermissionMatrixFeedback {
  roleId: string;
}