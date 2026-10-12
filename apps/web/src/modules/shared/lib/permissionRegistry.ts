import type {
  PermissionKey,
  PermissionManifest,
} from '@/modules/shared/types/permissions';

const permissionRegistry: Record<string, PermissionManifest> = {};

export function registerModulePermissions(
  moduleName: string,
  manifest: PermissionManifest,
): void {
  permissionRegistry[moduleName] = { ...manifest };
}

export function getAllPermissions(): PermissionKey[] {
  return Object.values(permissionRegistry).flatMap((manifest) => Object.keys(manifest));
}

export function getModulePermissions(moduleName: string): PermissionKey[] | undefined {
  const manifest = permissionRegistry[moduleName];

  if (!manifest) {
    return undefined;
  }

  return Object.keys(manifest);
}