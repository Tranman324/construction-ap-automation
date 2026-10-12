import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const MM = vi.hoisted(() => ({
  getToken: vi.fn(),
}));

vi.mock("next-auth/jwt", () => ({
  getToken: MM.getToken,
}));

import { middleware } from "./middleware";

function makeRequest(pathname: string): NextRequest {
  return new NextRequest(`http://localhost:3000${pathname}`);
}

describe("middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AZURE_AD_CLIENT_ID = "configured";
    process.env.NEXTAUTH_SECRET = "test-secret";
    process.env.INTERNAL_API_SECRET = "internal-secret";
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:3456";
  });

  it("allows authenticated admins through protected routes", async () => {
    MM.getToken.mockResolvedValue({ isAdmin: true, permissions: [] });

    const response = await middleware(makeRequest("/accounting/documents"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows invoices home but denies documents for users missing view_details", async () => {
    MM.getToken.mockResolvedValue({ isAdmin: false, permissions: ["accounting.invoices.view"] });

    const allowedResponse = await middleware(makeRequest("/accounting/invoices"));
    const deniedResponse = await middleware(makeRequest("/accounting/documents"));

    expect(allowedResponse.status).toBe(200);
    expect(deniedResponse.status).toBe(403);
    await expect(deniedResponse.json()).resolves.toEqual({ error: "Forbidden" });

    const accountingRedirectResponse = await middleware(makeRequest("/accounting"));
    expect(accountingRedirectResponse.status).toBe(200);
  });

  it("returns 403 for authenticated users with no matching permissions", async () => {
    MM.getToken.mockResolvedValue({ isAdmin: false, permissions: [] });

    const response = await middleware(makeRequest("/accounting/invoices"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("allows the approved public route allowlist for users with no permissions", async () => {
    MM.getToken.mockResolvedValue({ isAdmin: false, permissions: [] });

    for (const pathname of ["/settings", "/feature-requests"]) {
      const response = await middleware(makeRequest(pathname));
      expect(response.status).toBe(200);
    }
  });

  it("redirects authenticated zero-permission users from the root to feature requests", async () => {
    MM.getToken.mockResolvedValue({ isAdmin: false, permissions: [] });

    const response = await middleware(makeRequest("/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/feature-requests");
  });

  it("denies authenticated users from every unlisted route", async () => {
    MM.getToken.mockResolvedValue({ isAdmin: false, permissions: [] });

    for (const pathname of ["/workspace/projects/overview", "/feature-requests/board", "/login/unrecognized"]) {
      const response = await middleware(makeRequest(pathname));
      expect(response.status).toBe(403);
    }
  });

  it("redirects unauthenticated users to login", async () => {
    MM.getToken.mockResolvedValue(null);

    const response = await middleware(makeRequest("/projects"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });
});
