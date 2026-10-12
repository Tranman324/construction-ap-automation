export type PermissionKey = string;

export interface PermissionManifest {
  [key: PermissionKey]: string;
}

export interface UserPermissions {
  role: string;
  roleId: string;
  isAdmin: boolean;
  permissions: PermissionKey[];
}

export interface RoutePermission {
  path: string;
  permission: PermissionKey;
}