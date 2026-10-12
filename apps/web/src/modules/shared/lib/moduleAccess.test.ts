import { describe, expect, it } from "vitest";
import { canAccessRoute, getDefaultRoute } from "@/modules/shared/lib/moduleAccess";

describe("canAccessRoute", () => {
  it("allows admins on any mapped route", () => {
    expect(canAccessRoute({ isAdmin: true, permissions: [] }, "/projects/alpha")).toBe(true);
    expect(canAccessRoute({ isAdmin: true, permissions: [] }, "/admin")).toBe(true);
  });

  it("allows only the approved public route allowlist without permissions", () => {
    const zeroPermissionUser = { isAdmin: false, permissions: [] };

    expect(canAccessRoute(zeroPermissionUser, "/login")).toBe(true);
    expect(canAccessRoute(zeroPermissionUser, "/settings")).toBe(true);
    expect(canAccessRoute(zeroPermissionUser, "/feature-requests")).toBe(true);
  });

  it("denies unlisted routes and unlisted nested paths without permissions", () => {
    const zeroPermissionUser = { isAdmin: false, permissions: [] };

    expect(canAccessRoute(zeroPermissionUser, "/")).toBe(false);
    expect(canAccessRoute(zeroPermissionUser, "/workspace/projects/overview")).toBe(false);
    expect(canAccessRoute(zeroPermissionUser, "/feature-requests/board")).toBe(false);
    expect(canAccessRoute(zeroPermissionUser, "/login/unrecognized")).toBe(false);
  });

  it("grants access when the required permission key is present", () => {
    expect(canAccessRoute({ isAdmin: false, permissions: ["accounting.invoices.view_details"] }, "/accounting/documents/123")).toBe(true);
  });

  it("retains detail-route permission protection after the sidebar list retarget", () => {
    expect(canAccessRoute(
      { isAdmin: false, permissions: ["accounting.invoices.view_details"] },
      "/accounting/documents/doc-1",
    )).toBe(true);
    expect(canAccessRoute(
      { isAdmin: false, permissions: ["accounting.invoices.view"] },
      "/accounting/documents/doc-1",
    )).toBe(false);
  });

  it("maps invoice access to /invoices and nested routes", () => {
    expect(canAccessRoute({ isAdmin: false, permissions: ["accounting.invoices.view"] }, "/accounting/invoices")).toBe(true);
    expect(canAccessRoute({ isAdmin: false, permissions: ["accounting.invoices.view"] }, "/accounting/invoices/123")).toBe(true);
  });

  it("maps the accounting redirect route to invoice-view access", () => {
    expect(canAccessRoute({ isAdmin: false, permissions: [] }, "/accounting")).toBe(false);
    expect(canAccessRoute({ isAdmin: false, permissions: ["accounting.invoices.view"] }, "/accounting")).toBe(true);
    expect(canAccessRoute({ isAdmin: true, permissions: [] }, "/accounting")).toBe(true);
  });

  it("denies access when the required permission key is missing", () => {
    expect(canAccessRoute({ isAdmin: false, permissions: ["accounting.invoices.view"] }, "/accounting/documents/123")).toBe(false);
  });

  it("uses the longest matching route prefix", () => {
    expect(canAccessRoute({ isAdmin: false, permissions: ["accounting.invoices.view"] }, "/projects/123")).toBe(false);
    expect(canAccessRoute({ isAdmin: false, permissions: ["projects.view"] }, "/projects/123")).toBe(true);
  });

  it("allows wildcard permission bypasses", () => {
    expect(canAccessRoute({ isAdmin: false, permissions: ["*"] }, "/accounting/invoices/123")).toBe(true);
  });

  it("denies /admin to non-admin users without platform.admin", () => {
    expect(canAccessRoute({ isAdmin: false, permissions: [] }, "/admin")).toBe(false);
  });

  it("grants /admin when platform.admin is present", () => {
    expect(canAccessRoute({ isAdmin: false, permissions: ["platform.admin"] }, "/admin")).toBe(true);
  });

  it("prefers /invoices as the default route when invoice access is available", () => {
    expect(getDefaultRoute({ isAdmin: false, permissions: ["accounting.invoices.view"] })).toBe("/accounting/invoices");
  });

  it("falls through to the next permitted live route", () => {
    expect(getDefaultRoute({ isAdmin: false, permissions: ["projects.view"] })).toBe("/projects");
  });

  it("preserves protected-route priority ahead of the public fallback", () => {
    expect(getDefaultRoute({ isAdmin: false, permissions: ["platform.admin"] })).toBe("/admin");
    expect(getDefaultRoute({ isAdmin: false, permissions: ["accounting.invoices.delete"] })).toBe("/accounting/trash");
  });

  it("sends zero-permission users to the public feedback landing page", () => {
    expect(getDefaultRoute({ isAdmin: false, permissions: [] })).toBe("/feature-requests");
  });
});
