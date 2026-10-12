import { describe, expect, it, vi } from "vitest";
import {
  MODULE_REGISTRY,
  SIDEBAR_LIVE_ROUTE_ACCESS,
  findModuleByPath,
  findSubmoduleByPath,
  getVisibleModules,
  isValidDefaultSubmodule,
  moduleHasAttention,
  resolveDefaultSubmodule,
} from "@/modules/shared/lib/moduleRegistry";

describe("moduleRegistry", () => {
  it("defines the approved live route map exactly", () => {
    expect(SIDEBAR_LIVE_ROUTE_ACCESS).toEqual({
      "/feature-requests": "feature_requests.view",
      "/workspace/dashboard/overview": "feature_requests.view",
      "/workspace/dashboard/favorites": "feature_requests.view",
      "/workspace/dashboard/my-work": "feature_requests.view",
      "/workspace/dashboard/activity": "feature_requests.view",
      "/workspace/dashboard/kpis": "feature_requests.view",
      "/projects": "projects.view",
      "/projects/pending": "projects.view",
      "/workspace/projects/archived": "projects.view",
      "/workspace/projects/schedule": "projects.view",
      "/workspace/projects/map": "projects.view",
      "/accounting/invoices": "accounting.invoices.view",
      "/workspace/accounting/ar": "accounting.invoices.view",
      "/workspace/accounting/gl": "accounting.invoices.view",
      "/workspace/accounting/reports": "accounting.invoices.view",
      "/workspace/accounting/budgets": "accounting.invoices.view",
      "/admin?section=overview": "platform.admin",
      "/admin?section=users": "platform.admin",
      "/admin?section=roles": "platform.admin",
      "/admin?section=role-perms": "platform.admin",
      "/admin?section=overrides": "platform.admin",
      "/admin?section=rules": "platform.admin",
    });
  });

  it("places Feedback under Dashboard", () => {
    const dashboard = MODULE_REGISTRY.find((module) => module.id === "dashboard");

    expect(dashboard?.defaultSubmodule).toBe("feedback");
    expect(dashboard?.children.find((child) => child.id === "feedback")).toMatchObject({
      label: "Feedback",
      href: "/feature-requests",
      availability: "live",
    });
  });

  it("owns document compatibility and detail paths under Accounting AP Billing", () => {
    const accounting = MODULE_REGISTRY.find((module) => module.id === "accounting");

    expect(accounting?.children.find((child) => child.id === "ap-billing")).toMatchObject({
      href: "/accounting/invoices",
      routePrefixes: ["/accounting/invoices", "/accounting/documents"],
    });
    expect(MODULE_REGISTRY.map((module) => module.id)).not.toContain("documents");
  });

  it("keeps future modules disabled while exposing placeholder submodules under live modules", () => {
    const visibleModules = getVisibleModules({ isAdmin: false, permissions: ["accounting.invoices.view"] });
    const accounting = visibleModules.find((module) => module.id === "accounting");
    const leads = visibleModules.find((module) => module.id === "leads");

    expect(accounting?.children.find((child) => child.id === "ar")).toMatchObject({
      href: "/workspace/accounting/ar",
      visibility: "live",
    });
    expect(leads?.visibility).toBe("disabled-future");
    expect(visibleModules.map((module) => module.id)).not.toContain("projects");
  });

  it("exposes admin permission metadata", () => {
    const admin = MODULE_REGISTRY.find((module) => module.id === "admin");

    expect(admin?.permission).toBe("platform.admin");
    expect(
      admin?.children
        .filter((child) => child.availability === "live")
        .map((child) => ({ id: child.id, href: child.href })),
    ).toEqual([
      { id: "overview", href: "/admin?section=overview" },
      { id: "users", href: "/admin?section=users" },
      { id: "roles", href: "/admin?section=roles" },
      { id: "role-perms", href: "/admin?section=role-perms" },
      { id: "overrides", href: "/admin?section=overrides" },
      { id: "rules", href: "/admin?section=rules" },
    ]);
  });

  it("validates defaults against live submodules only", () => {
    expect(isValidDefaultSubmodule("accounting", "ap-billing")).toBe(true);
    expect(isValidDefaultSubmodule("accounting", "ar")).toBe(true);
    expect(isValidDefaultSubmodule("leads", "inbox")).toBe(false);
    expect(resolveDefaultSubmodule("accounting", "ar")).toBe("ar");
    expect(resolveDefaultSubmodule("accounting", "not-real")).toBe("ap-billing");
    expect(resolveDefaultSubmodule("unknown")).toBeUndefined();
  });

  it("resolves active prefixes to the owning module and submodule", () => {
    const cases = [
      ["/accounting/invoices/queue", "accounting", "ap-billing"],
      ["/projects/alpha", "projects", "active"],
      ["/projects/pending/review", "projects", "pending"],
      ["/accounting/documents/123", "accounting", "ap-billing"],
      ["/feature-requests/board", "dashboard", "feedback"],
      ["/workspace/accounting/ar", "accounting", "ar"],
      ["/workspace/projects/archived", "projects", "archived"],
    ] as const;

    cases.forEach(([pathname, moduleId, submoduleId]) => {
      expect(findModuleByPath(pathname)?.id).toBe(moduleId);
      expect(findSubmoduleByPath(pathname)?.id).toBe(submoduleId);
    });
  });

  it("normalizes admin submodule selection from the section query value", () => {
    expect(findModuleByPath("/admin")?.id).toBe("admin");
    expect(findSubmoduleByPath("/admin", "users")?.id).toBe("users");
    expect(findSubmoduleByPath("/admin", undefined)?.id).toBe("overview");
    expect(findSubmoduleByPath("/admin", "not-real")?.id).toBe("overview");
  });

  it("supports attention bubbling from child entries", () => {
    const accounting = MODULE_REGISTRY.find((module) => module.id === "accounting");

    expect(accounting && moduleHasAttention(accounting)).toBe(true);
  });

  it("forwards permission manifests through module registration", async () => {
    vi.resetModules();
    const { registerModule } = await import("@/modules/shared/lib/moduleRegistry");
    const { getEventDefinition, getModuleEventTypes } = await import("@/modules/shared/lib/eventRegistry");
    const { getModulePermissions } = await import("@/modules/shared/lib/permissionRegistry");

    registerModule("projects", {
      permissions: {
        "projects.view": "View projects",
      },
      events: {
        "project.future_event": {
          label: "Future project event",
          severity: "info",
          targetType: "project",
        },
      },
    });

    expect(getModulePermissions("projects")).toEqual(["projects.view"]);
    expect(getModuleEventTypes("projects")).toEqual(["project.future_event"]);
    expect(getEventDefinition("project.future_event")).toMatchObject({
      label: "Future project event",
      module: "projects",
    });
  });
});
