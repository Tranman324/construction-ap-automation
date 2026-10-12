import type { UserPermissionOverride } from "@/modules/platform-admin/types/admin";

export type UserOverrideMode = "inherited" | "grant" | "revoke";

export interface EffectiveUserOverrideState {
  mode: UserOverrideMode;
  inheritedGranted: boolean;
  effectiveGranted: boolean;
}

export interface UserOverrideSummaryCounts {
  inheritedCount: number;
  grantCount: number;
  revokeCount: number;
}

export type UserOverrideModeMap = Record<string, UserOverrideMode>;

export function normalizeUserOverrides(overrides: UserPermissionOverride[]): UserPermissionOverride[] {
  const overrideMap = new Map<string, boolean>();

  overrides.forEach((override) => {
    overrideMap.set(override.key, override.granted);
  });

  return [...overrideMap.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, granted]) => ({ key, granted }));
}

export function createUserOverrideModeMap(overrides: UserPermissionOverride[]): UserOverrideModeMap {
  return normalizeUserOverrides(overrides).reduce<UserOverrideModeMap>((modeMap, override) => {
    modeMap[override.key] = override.granted ? "grant" : "revoke";
    return modeMap;
  }, {});
}

export function getEffectiveUserOverrideState(
  permissionKey: string,
  inheritedPermissions: ReadonlySet<string>,
  overrideModeMap: UserOverrideModeMap,
): EffectiveUserOverrideState {
  const mode = overrideModeMap[permissionKey] ?? "inherited";
  const inheritedGranted = inheritedPermissions.has(permissionKey);
  const effectiveGranted =
    mode === "grant" ? true : mode === "revoke" ? false : inheritedGranted;

  return {
    mode,
    inheritedGranted,
    effectiveGranted,
  };
}

export function buildUserOverridesPayload(overrideModeMap: UserOverrideModeMap): UserPermissionOverride[] {
  return Object.entries(overrideModeMap)
    .filter(([, mode]) => mode !== "inherited")
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, mode]) => ({ key, granted: mode === "grant" }));
}

export function countUserOverrideModes(
  permissionKeys: string[],
  overrideModeMap: UserOverrideModeMap,
): UserOverrideSummaryCounts {
  return permissionKeys.reduce<UserOverrideSummaryCounts>(
    (counts, permissionKey) => {
      const mode = overrideModeMap[permissionKey] ?? "inherited";

      if (mode === "grant") {
        counts.grantCount += 1;
      } else if (mode === "revoke") {
        counts.revokeCount += 1;
      } else {
        counts.inheritedCount += 1;
      }

      return counts;
    },
    {
      inheritedCount: 0,
      grantCount: 0,
      revokeCount: 0,
    },
  );
}