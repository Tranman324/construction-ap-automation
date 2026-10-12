import type { LucideIcon } from "lucide-react";
import type { AuditEventCatalog } from "@/modules/shared/types/auditEvent";
import type { PermissionKey, PermissionManifest } from "@/modules/shared/types/permissions";

export type ModuleAvailability = "live" | "future";
export type ModuleVisibility = "live" | "disabled-future" | "hidden-by-permission";

export interface ModuleRegistryAuth {
  isAdmin: boolean;
  permissions: PermissionKey[];
}

export interface ModuleRegistrySubitem {
  id: string;
  label: string;
  icon: LucideIcon;
  availability: ModuleAvailability;
  routePrefixes: readonly string[];
  href?: string;
  permission?: PermissionKey;
  attention: boolean;
}

export interface ModuleRegistryModule {
  id: string;
  label: string;
  icon: LucideIcon;
  availability: ModuleAvailability;
  defaultSubmodule: string;
  permission?: PermissionKey;
  children: readonly ModuleRegistrySubitem[];
}

export interface ResolvedModuleRegistrySubitem extends ModuleRegistrySubitem {
  visibility: ModuleVisibility;
}

export interface ResolvedModuleRegistryModule extends Omit<ModuleRegistryModule, "children"> {
  visibility: ModuleVisibility;
  children: readonly ResolvedModuleRegistrySubitem[];
}

export interface ModuleRegistrationConfig {
  permissions?: PermissionManifest;
  events?: AuditEventCatalog;
}
