import {
  Activity, Archive, BarChart3, Bell, BookOpenText, Calculator, ClipboardCheck, FileText, FolderKanban,
  FolderOpen, LayoutDashboard, Link, Map, MessageSquarePlus, Palette, ScrollText, Settings, Shield, Target, Users,
} from "lucide-react";
import { registerModuleEvents } from "@/modules/shared/lib/eventRegistry";
import { registerModulePermissions } from "@/modules/shared/lib/permissionRegistry";
import type { ModuleRegistrationConfig, ModuleRegistryAuth, ModuleRegistryModule, ModuleRegistrySubitem, ResolvedModuleRegistryModule } from "@/modules/shared/lib/moduleRegistry.types";
import {
  adminQueryItem, deriveSidebarLiveRouteAccess, findModuleById as findRegistryModuleById,
  findModuleByPath as findRegistryModuleByPath, findSubmoduleById as findRegistrySubmoduleById,
  findSubmoduleByPath as findRegistrySubmoduleByPath, futureItem, getSubmoduleRoute as getRegistrySubmoduleRoute,
  getVisibleModules as getRegistryVisibleModules, isValidDefaultSubmodule as isValidRegistryDefaultSubmodule, liveItem,
  moduleHasAttention, placeholderItem, resolveDefaultSubmodule as resolveRegistryDefaultSubmodule,
} from "@/modules/shared/lib/moduleRegistry.utils";

export type {
  ModuleAvailability,
  ModuleRegistrationConfig,
  ModuleRegistryAuth,
  ModuleRegistryModule,
  ModuleRegistrySubitem,
  ModuleVisibility,
  ResolvedModuleRegistryModule,
  ResolvedModuleRegistrySubitem,
} from "@/modules/shared/lib/moduleRegistry.types";

export const MODULE_REGISTRY: readonly ModuleRegistryModule[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    availability: "live",
    defaultSubmodule: "feedback",
    permission: "feature_requests.view",
    children: [
      liveItem("feedback", "Feedback", MessageSquarePlus, "/feature-requests"),
      placeholderItem("dashboard", "overview", "Overview", LayoutDashboard),
      placeholderItem("dashboard", "favorites", "Favorites", FolderOpen),
      placeholderItem("dashboard", "my-work", "My Work", ClipboardCheck),
      placeholderItem("dashboard", "activity", "Activity Feed", Bell),
      placeholderItem("dashboard", "kpis", "KPIs & Metrics", BarChart3),
    ],
  },
  {
    id: "projects",
    label: "Projects",
    icon: FolderKanban,
    availability: "live",
    defaultSubmodule: "active",
    permission: "projects.view",
    children: [
      liveItem("active", "Active", FolderKanban, "/projects"),
      liveItem("pending", "Pending Intake", ClipboardCheck, "/projects/pending", true),
      placeholderItem("projects", "archived", "Archived", Archive),
      placeholderItem("projects", "schedule", "Schedule", Calculator),
      placeholderItem("projects", "map", "Project Map", Map),
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    icon: BookOpenText,
    availability: "live",
    defaultSubmodule: "ap-billing",
    permission: "accounting.invoices.view",
    children: [
      liveItem("ap-billing", "AP Billing", FileText, "/accounting/invoices", true, [
        "/accounting/invoices",
        "/accounting/documents",
      ]),
      placeholderItem("accounting", "ar", "AR Invoicing", FileText),
      placeholderItem("accounting", "gl", "General Ledger", BookOpenText),
      placeholderItem("accounting", "reports", "Financials", BarChart3),
      placeholderItem("accounting", "budgets", "Budgets", Calculator),
    ],
  },
  {
    id: "leads",
    label: "Leads",
    icon: Target,
    availability: "future",
    defaultSubmodule: "inbox",
    children: [
      futureItem("inbox", "Lead Inbox", Target),
      futureItem("qualified", "Qualified", ClipboardCheck),
      futureItem("pipeline", "Pipeline", BarChart3),
      futureItem("lost", "Lost / Disqualified", Archive),
    ],
  },
  {
    id: "estimates",
    label: "Estimates",
    icon: Calculator,
    availability: "future",
    defaultSubmodule: "drafts",
    children: [
      futureItem("drafts", "Drafts", FileText),
      futureItem("sent", "Sent", FileText),
      futureItem("awarded", "Awarded", ClipboardCheck),
      futureItem("templates", "Templates", BookOpenText),
      futureItem("rate-card", "Rate Card", Calculator),
    ],
  },
  {
    id: "closeouts",
    label: "Closeouts",
    icon: ClipboardCheck,
    availability: "future",
    defaultSubmodule: "in-progress",
    children: [
      futureItem("in-progress", "In Progress", ClipboardCheck),
      futureItem("overdue", "Overdue", Bell, true),
      futureItem("punch", "Punch Lists", ScrollText),
      futureItem("warranty", "Warranty Items", Shield),
      futureItem("completed", "Completed", ClipboardCheck),
    ],
  },
  {
    id: "admin",
    label: "Admin",
    icon: Shield,
    availability: "live",
    defaultSubmodule: "overview",
    permission: "platform.admin",
    children: [
      adminQueryItem("overview", "Overview", LayoutDashboard),
      adminQueryItem("users", "Users", Users),
      adminQueryItem("roles", "Roles", Shield),
      adminQueryItem("role-perms", "Role Permissions", ClipboardCheck),
      adminQueryItem("overrides", "User Overrides", Users),
      adminQueryItem("rules", "Title Rules", BookOpenText),
      futureItem("brand-theme", "Brand Theme", Palette),
      futureItem("platform-settings", "Platform Settings", Settings),
      futureItem("audit-log", "Audit Log", Activity),
      futureItem("notifications", "Notifications", Bell),
      futureItem("integrations", "Integrations", Link),
      futureItem("usage", "Usage Analytics", BarChart3),
    ],
  },
];

export const SIDEBAR_LIVE_ROUTE_ACCESS = deriveSidebarLiveRouteAccess(MODULE_REGISTRY);

export function registerModule(moduleName: string, config: ModuleRegistrationConfig): void {
  if (config.permissions) {
    registerModulePermissions(moduleName, config.permissions);
  }

  if (config.events) {
    registerModuleEvents(moduleName, config.events);
  }
}

export function findModuleById(moduleId: string): ModuleRegistryModule | undefined {
  return findRegistryModuleById(MODULE_REGISTRY, moduleId);
}

export function findSubmoduleById(moduleId: string, submoduleId: string): ModuleRegistrySubitem | undefined {
  return findRegistrySubmoduleById(MODULE_REGISTRY, moduleId, submoduleId);
}

export function findSubmoduleByPath(pathname: string, adminSectionValue?: string | null): ModuleRegistrySubitem | undefined {
  return findRegistrySubmoduleByPath(MODULE_REGISTRY, pathname, adminSectionValue);
}

export function findModuleByPath(pathname: string): ModuleRegistryModule | undefined {
  return findRegistryModuleByPath(MODULE_REGISTRY, pathname);
}

export function isValidDefaultSubmodule(moduleId: string, submoduleId: string): boolean {
  return isValidRegistryDefaultSubmodule(MODULE_REGISTRY, moduleId, submoduleId);
}

export function resolveDefaultSubmodule(moduleId: string, submoduleId?: string): string | undefined {
  return resolveRegistryDefaultSubmodule(MODULE_REGISTRY, moduleId, submoduleId);
}

export function getSubmoduleRoute(moduleId: string, submoduleId: string): string | undefined {
  return getRegistrySubmoduleRoute(MODULE_REGISTRY, moduleId, submoduleId);
}

export { moduleHasAttention };

export function getVisibleModules(auth: ModuleRegistryAuth): readonly ResolvedModuleRegistryModule[] {
  return getRegistryVisibleModules(auth, MODULE_REGISTRY);
}
