import { beforeEach, describe, expect, it, vi } from "vitest";

interface RouteEventSource {
  eventTypes: string[];
}

function flattenRouteValues(routes: RouteEventSource[]): string[] {
  return routes.flatMap((route) => route.eventTypes);
}

beforeEach(() => {
  vi.resetModules();
});

describe("NOTIFICATION_ROUTES", () => {
  it("covers every admin and invoice audit event type", async () => {
    const { INVOICE_EVENTS } = await import("@/modules/accounting/modules/invoices/events");
    const { PLATFORM_ADMIN_EVENTS } = await import("@/modules/platform-admin/events");
    const { NOTIFICATION_ROUTES } = await import("@/modules/shared/lib/notificationRoutes");

    expect(new Set(flattenRouteValues(NOTIFICATION_ROUTES))).toEqual(
      new Set([
        ...Object.keys(INVOICE_EVENTS),
        ...Object.keys(PLATFORM_ADMIN_EVENTS),
      ]),
    );
  });

  it("references registered event types after registration imports load", async () => {
    await import("@/modules/accounting/register");
    await import("@/modules/platform-admin/register");
    const { getAllEventTypes } = await import("@/modules/shared/lib/eventRegistry");
    const { NOTIFICATION_ROUTES } = await import("@/modules/shared/lib/notificationRoutes");

    const registeredEventTypes = new Set(getAllEventTypes());

    expect(
      flattenRouteValues(NOTIFICATION_ROUTES).every((eventType) => registeredEventTypes.has(eventType)),
    ).toBe(true);
  });

  it("references registered permission audiences after registration imports load", async () => {
    await import("@/modules/accounting/register");
    await import("@/modules/platform-admin/register");
    const { getAllPermissions } = await import("@/modules/shared/lib/permissionRegistry");
    const { NOTIFICATION_ROUTES } = await import("@/modules/shared/lib/notificationRoutes");

    const registeredPermissions = new Set(getAllPermissions());
    const routePermissions = NOTIFICATION_ROUTES.flatMap((route) => route.audience.permissions ?? []);

    expect(routePermissions.every((permission) => registeredPermissions.has(permission))).toBe(true);
  });

  it("uses the in-app channel for every route", async () => {
    const { NOTIFICATION_ROUTES } = await import("@/modules/shared/lib/notificationRoutes");

    expect(NOTIFICATION_ROUTES.every((route) => route.channel === "in-app")).toBe(true);
  });
});
