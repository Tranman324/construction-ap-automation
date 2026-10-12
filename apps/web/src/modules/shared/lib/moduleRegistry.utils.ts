import type { LucideIcon } from "lucide-react";
import {
  ADMIN_SECTION_QUERY_PARAM,
  getAdminSectionQueryValue,
  normalizeAdminSection,
  type AdminSectionId,
} from "@/modules/shared/lib/adminNavigation";
import { hasPermission } from "@/modules/shared/lib/permissions";
import type { PermissionKey } from "@/modules/shared/types/permissions";
import type {
  ModuleAvailability,
  ModuleRegistryAuth,
  ModuleRegistryModule,
  ModuleRegistrySubitem,
  ModuleVisibility,
  ResolvedModuleRegistryModule,
  ResolvedModuleRegistrySubitem,
} from "@/modules/shared/lib/moduleRegistry.types";

interface RouteMatch {
  module: ModuleRegistryModule;
  child: ModuleRegistrySubitem;
}

export function liveItem(
  id: string,
  label: string,
  icon: LucideIcon,
  href: string,
  attention = false,
  routePrefixes?: readonly string[],
): ModuleRegistrySubitem {
  return {
    id,
    label,
    icon,
    availability: "live",
    href,
    routePrefixes: routePrefixes ?? [href],
    attention,
  };
}

export function futureItem(id: string, label: string, icon: LucideIcon, attention = false): ModuleRegistrySubitem {
  return { id, label, icon, availability: "future", routePrefixes: [], attention };
}

export function placeholderItem(
  moduleId: string,
  id: string,
  label: string,
  icon: LucideIcon,
  attention = false,
): ModuleRegistrySubitem {
  return liveItem(id, label, icon, `/workspace/${moduleId}/${id}`, attention);
}

export function adminQueryHref(sectionId: AdminSectionId): string {
  return `/admin?${ADMIN_SECTION_QUERY_PARAM}=${getAdminSectionQueryValue(sectionId)}`;
}

export function adminQueryItem(sectionId: AdminSectionId, label: string, icon: LucideIcon): ModuleRegistrySubitem {
  return liveItem(sectionId, label, icon, adminQueryHref(sectionId), false, ["/admin"]);
}

export function deriveSidebarLiveRouteAccess(registry: readonly ModuleRegistryModule[]): Record<string, PermissionKey> {
  return registry.reduce<Record<string, PermissionKey>>((routes, module) => {
    module.children.forEach((child) => {
      const permission = child.permission ?? module.permission;

      if (child.availability === "live" && child.href && permission) {
        routes[child.href] = permission;
      }
    });

    return routes;
  }, {});
}

export function matchesRoutePrefix(pathname: string, routePrefix: string): boolean {
  return pathname === routePrefix || pathname.startsWith(`${routePrefix}/`);
}

export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function findRouteMatch(registry: readonly ModuleRegistryModule[], pathname: string): RouteMatch | undefined {
  return registry
    .flatMap((module) =>
      module.children
        .filter((child) => child.availability === "live" && child.routePrefixes.some((prefix) => matchesRoutePrefix(pathname, prefix)))
        .map((child) => ({ module, child })),
    )
    .sort((left, right) => (right.child.href?.length ?? 0) - (left.child.href?.length ?? 0))[0];
}

export function resolveVisibility(
  auth: ModuleRegistryAuth,
  availability: ModuleAvailability,
  permission?: PermissionKey,
): ModuleVisibility {
  if (availability === "future") {
    return "disabled-future";
  }

  if (!permission || auth.isAdmin || hasPermission(auth.permissions ?? [], permission)) {
    return "live";
  }

  return "hidden-by-permission";
}

export function findModuleById(registry: readonly ModuleRegistryModule[], moduleId: string): ModuleRegistryModule | undefined {
  return registry.find((module) => module.id === moduleId);
}

export function findSubmoduleById(
  registry: readonly ModuleRegistryModule[],
  moduleId: string,
  submoduleId: string,
): ModuleRegistrySubitem | undefined {
  return findModuleById(registry, moduleId)?.children.find((child) => child.id === submoduleId);
}

export function findSubmoduleByPath(
  registry: readonly ModuleRegistryModule[],
  pathname: string,
  adminSectionValue?: string | null,
): ModuleRegistrySubitem | undefined {
  if (isAdminPath(pathname)) {
    return findSubmoduleById(registry, "admin", normalizeAdminSection(adminSectionValue));
  }

  return findRouteMatch(registry, pathname)?.child;
}

export function findModuleByPath(registry: readonly ModuleRegistryModule[], pathname: string): ModuleRegistryModule | undefined {
  if (isAdminPath(pathname)) {
    return findModuleById(registry, "admin");
  }

  return findRouteMatch(registry, pathname)?.module;
}

export function isValidDefaultSubmodule(
  registry: readonly ModuleRegistryModule[],
  moduleId: string,
  submoduleId: string,
): boolean {
  return findSubmoduleById(registry, moduleId, submoduleId)?.availability === "live";
}

export function resolveDefaultSubmodule(
  registry: readonly ModuleRegistryModule[],
  moduleId: string,
  submoduleId?: string,
): string | undefined {
  if (submoduleId && isValidDefaultSubmodule(registry, moduleId, submoduleId)) {
    return submoduleId;
  }

  return findModuleById(registry, moduleId)?.defaultSubmodule;
}

export function getSubmoduleRoute(
  registry: readonly ModuleRegistryModule[],
  moduleId: string,
  submoduleId: string,
): string | undefined {
  return findSubmoduleById(registry, moduleId, submoduleId)?.href;
}

export function moduleHasAttention(module: ModuleRegistryModule): boolean {
  return module.children.some((child) => child.attention);
}

export function getVisibleModules(auth: ModuleRegistryAuth, registry: readonly ModuleRegistryModule[]): readonly ResolvedModuleRegistryModule[] {
  return registry
    .map((module) => {
      const moduleVisibility = resolveVisibility(auth, module.availability, module.permission);
      const children = module.children.map<ResolvedModuleRegistrySubitem>((child) => ({
        ...child,
        visibility:
          moduleVisibility === "hidden-by-permission"
            ? "hidden-by-permission"
            : resolveVisibility(auth, child.availability, child.permission ?? module.permission),
      }));

      return { ...module, visibility: moduleVisibility, children };
    })
    .filter((module) => module.visibility !== "hidden-by-permission");
}
