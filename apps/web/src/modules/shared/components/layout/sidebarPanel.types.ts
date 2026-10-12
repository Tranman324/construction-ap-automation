import type { ResolvedModuleRegistryModule, ResolvedModuleRegistrySubitem } from "@/modules/shared/lib/moduleRegistry";

export interface SidebarPanelUser {
  name: string;
  email: string;
  image?: string | null;
  position?: string | null;
  role?: string;
}

export function getPanelUserInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function isLiveSidebarSubmodule(
  submodule: ResolvedModuleRegistrySubitem,
): submodule is ResolvedModuleRegistrySubitem & { href: string; visibility: "live" } {
  return submodule.visibility === "live" && typeof submodule.href === "string";
}

export function getDefaultableSubmodules(
  module: ResolvedModuleRegistryModule,
): readonly (ResolvedModuleRegistrySubitem & { href: string; visibility: "live" })[] {
  return module.children.filter(isLiveSidebarSubmodule);
}