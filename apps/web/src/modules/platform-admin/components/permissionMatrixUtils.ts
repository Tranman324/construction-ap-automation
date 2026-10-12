export type PermissionModuleAction = "all" | "clear" | "reset";

export function normalizePermissionList(permissions: Iterable<string>): string[] {
  return Array.from(new Set(permissions)).sort((left, right) => left.localeCompare(right));
}

export function haveSamePermissions(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

export function formatModuleLabel(moduleId: string): string {
  return moduleId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}