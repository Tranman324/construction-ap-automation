import {
  findModuleByPath,
  getSubmoduleRoute,
  resolveDefaultSubmodule,
  type ResolvedModuleRegistryModule,
} from "@/modules/shared/lib/moduleRegistry";

export function getActiveRailModuleId(pathname: string): string | undefined {
  return findModuleByPath(pathname)?.id;
}

export function getRailModuleHref(module: ResolvedModuleRegistryModule): string | undefined {
  if (module.visibility !== "live") {
    return undefined;
  }

  const defaultSubmoduleId = resolveDefaultSubmodule(module.id, module.defaultSubmodule);
  const preferredChild = defaultSubmoduleId
    ? module.children.find((child) => child.id === defaultSubmoduleId && child.visibility === "live" && child.href)
    : undefined;
  const fallbackChild = module.children.find((child) => child.visibility === "live" && child.href);

  return preferredChild?.href ?? fallbackChild?.href ?? (defaultSubmoduleId ? getSubmoduleRoute(module.id, defaultSubmoduleId) : undefined);
}

export function getUserInitials(name?: string | null): string {
  if (!name) {
    return "??";
  }

  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}