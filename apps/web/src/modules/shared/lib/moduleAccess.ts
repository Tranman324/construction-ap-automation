import { hasPermission } from "@/modules/shared/lib/permissions";
import { SIDEBAR_LIVE_ROUTE_ACCESS } from "@/modules/shared/lib/moduleRegistry";
import type { PermissionKey } from "@/modules/shared/types/permissions";
import type { ModuleRegistryAuth } from "@/modules/shared/lib/moduleRegistry";

export type RouteAccessAuth = ModuleRegistryAuth;

const ACCOUNTING_ROUTE_BASE = "/accounting";
const INVOICES_SEGMENT = "invoices";
const DOCUMENTS_SEGMENT = "documents";
const TRASH_SEGMENT = "trash";

const ACCOUNTING_INVOICES_ROUTE = `${ACCOUNTING_ROUTE_BASE}/${INVOICES_SEGMENT}`;
const ACCOUNTING_DOCUMENTS_ROUTE = `${ACCOUNTING_ROUTE_BASE}/${DOCUMENTS_SEGMENT}`;
const ACCOUNTING_TRASH_ROUTE = `${ACCOUNTING_ROUTE_BASE}/${TRASH_SEGMENT}`;

export const PUBLIC_ROUTES = new Set([
  "/login",
  "/settings",
  "/feature-requests",
]);

export const MODULE_ACCESS: Record<string, PermissionKey> = {
  ...SIDEBAR_LIVE_ROUTE_ACCESS,
  "/admin": "platform.admin",
  [ACCOUNTING_ROUTE_BASE]: "accounting.invoices.view",
  [ACCOUNTING_DOCUMENTS_ROUTE]: "accounting.invoices.view_details",
  [ACCOUNTING_TRASH_ROUTE]: "accounting.invoices.delete",
};

const ROUTE_PRIORITY = [
  ACCOUNTING_INVOICES_ROUTE,
  ACCOUNTING_DOCUMENTS_ROUTE,
  "/projects",
  "/feature-requests",
  ACCOUNTING_TRASH_ROUTE,
  "/admin",
] as const;

function matchesRoutePrefix(pathname: string, route: string): boolean {
  if (route === "/") {
    return pathname === route;
  }

  return pathname === route || pathname.startsWith(`${route}/`);
}

function getMatchingRoute(pathname: string): string | undefined {
  return Object.keys(MODULE_ACCESS)
    .filter((route) => matchesRoutePrefix(pathname, route))
    .sort((left, right) => right.length - left.length)[0];
}

function canAccessProtectedRoute(auth: RouteAccessAuth, pathname: string): boolean {
  const matchingRoute = getMatchingRoute(pathname);
  const permissions = auth.permissions ?? [];

  if (!matchingRoute) {
    return false;
  }

  return Boolean(auth.isAdmin) || hasPermission(permissions, MODULE_ACCESS[matchingRoute]);
}

export function canAccessRoute(auth: RouteAccessAuth, pathname: string): boolean {
  return PUBLIC_ROUTES.has(pathname) || canAccessProtectedRoute(auth, pathname);
}

export function getDefaultRoute(auth: RouteAccessAuth): string {
  for (const route of ROUTE_PRIORITY) {
    if (canAccessProtectedRoute(auth, route)) {
      return route;
    }
  }

  return "/feature-requests";
}
