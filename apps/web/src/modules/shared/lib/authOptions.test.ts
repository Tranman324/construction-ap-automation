import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.AZURE_AD_CLIENT_ID = process.env.AZURE_AD_CLIENT_ID ?? "test-client-id";
process.env.AZURE_AD_CLIENT_SECRET = process.env.AZURE_AD_CLIENT_SECRET ?? "test-client-secret";
process.env.AZURE_AD_TENANT_ID = process.env.AZURE_AD_TENANT_ID ?? "test-tenant-id";

const QM = vi.hoisted(() => ({
  getRoleByName: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserById: vi.fn(),
  getUserPermissions: vi.fn(),
  matchTitleRule: vi.fn(),
  upsertUser: vi.fn(),
}));

vi.mock("@/modules/shared/lib/userQueries", () => ({
  getRoleByName: QM.getRoleByName,
  getUserByEmail: QM.getUserByEmail,
  getUserById: QM.getUserById,
  getUserPermissions: QM.getUserPermissions,
  matchTitleRule: QM.matchTitleRule,
  upsertUser: QM.upsertUser,
}));

import { authOptions } from "@/modules/shared/lib/authOptions";

const fetchMock = vi.fn();
global.fetch = fetchMock as typeof fetch;

function makeUser(overrides: Partial<{
  id: string;
  email: string;
  name: string;
  roleId: string;
  roleName: string;
  isSystem: boolean;
  isActive: boolean;
  roleVersion: number;
  jobTitle: string | null;
}> = {}) {
  const roleId = overrides.roleId ?? "role-leadership-id";

  return {
    id: overrides.id ?? "user-1",
    azure_id: "azure-1",
    email: overrides.email ?? "user@northwindcg.example",
    name: overrides.name ?? "Test User",
    role_id: roleId,
    is_active: overrides.isActive ?? true,
    job_title: overrides.jobTitle ?? "Director of Operations",
    avatar_url: null,
    role_version: overrides.roleVersion ?? 1,
    last_login_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    role: {
      id: roleId,
      name: overrides.roleName ?? "leadership",
      isSystem: overrides.isSystem ?? false,
      description: null,
    },
  };
}

function getJwtCallback() {
  if (!authOptions.callbacks?.jwt) {
    throw new Error("jwt callback missing");
  }

  return authOptions.callbacks.jwt;
}

function getSessionCallback() {
  if (!authOptions.callbacks?.session) {
    throw new Error("session callback missing");
  }

  return authOptions.callbacks.session;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ jobTitle: "Director of Operations" }),
  } as Response);
});

describe("authOptions jwt callback", () => {
  it("auto-provisions a new user with a matched title rule", async () => {
    const jwt = getJwtCallback();
    const provisionedUser = makeUser({ roleId: "role-leadership-id", roleName: "leadership" });

    QM.getUserByEmail.mockResolvedValueOnce(null);
    QM.matchTitleRule.mockResolvedValue({ role_id: "role-leadership-id" });
    QM.upsertUser.mockResolvedValue(provisionedUser);
    QM.getUserPermissions.mockResolvedValue(["accounting.invoices.view"]);

    const result = await jwt({
      token: { email: "user@northwindcg.example", name: "Test User" },
      account: { access_token: "graph-token", providerAccountId: "azure-oid" },
      profile: { oid: "azure-oid" },
      user: { email: "user@northwindcg.example", name: "Test User" },
    } as never);

    expect(QM.matchTitleRule).toHaveBeenCalledWith("Director of Operations");
    expect(QM.upsertUser).toHaveBeenCalledWith(expect.objectContaining({ roleId: "role-leadership-id" }));
    expect(result.roleId).toBe("role-leadership-id");
    expect(result.jobTitle).toBe("Director of Operations");
  });

  it("defaults a new user to the employee role when no title rule matches", async () => {
    const jwt = getJwtCallback();
    const employeeUser = makeUser({ roleId: "role-employee-id", roleName: "employee" });

    QM.getUserByEmail.mockResolvedValueOnce(null);
    QM.matchTitleRule.mockResolvedValue(null);
    QM.getRoleByName.mockResolvedValue({ id: "role-employee-id", name: "employee", isSystem: false });
    QM.upsertUser.mockResolvedValue(employeeUser);
    QM.getUserPermissions.mockResolvedValue(["accounting.invoices.view", "accounting.invoices.view_details"]);

    const result = await jwt({
      token: { email: "user@northwindcg.example", name: "Test User" },
      account: { access_token: "graph-token", providerAccountId: "azure-oid" },
      profile: { oid: "azure-oid" },
      user: { email: "user@northwindcg.example", name: "Test User" },
    } as never);

    expect(QM.getRoleByName).toHaveBeenCalledWith("employee");
    expect(result.roleId).toBe("role-employee-id");
  });

  it("loads permissions for an existing user", async () => {
    const jwt = getJwtCallback();
    const existingUser = makeUser();

    QM.getUserByEmail.mockResolvedValue(existingUser);
    QM.upsertUser.mockResolvedValue(existingUser);
    QM.getUserPermissions.mockResolvedValue(["accounting.invoices.view", "accounting.invoices.view_details"]);

    const result = await jwt({
      token: { email: "user@northwindcg.example", name: "Test User" },
      account: { access_token: "graph-token", providerAccountId: "azure-oid" },
      profile: { oid: "azure-oid" },
      user: { email: "user@northwindcg.example", name: "Test User" },
    } as never);

    expect(result.permissions).toEqual(["accounting.invoices.view", "accounting.invoices.view_details"]);
    expect(result.role).toBe("leadership");
  });

  it("denies a deactivated user", async () => {
    const jwt = getJwtCallback();

    QM.getUserByEmail.mockResolvedValue(makeUser({ isActive: false }));

    await expect(jwt({
      token: { email: "user@northwindcg.example", name: "Test User" },
      account: { access_token: "graph-token", providerAccountId: "azure-oid" },
      profile: { oid: "azure-oid" },
      user: { email: "user@northwindcg.example", name: "Test User" },
    } as never)).rejects.toThrow("Account deactivated");
  });

  it("reloads role and permissions when the DB roleVersion is newer", async () => {
    const jwt = getJwtCallback();
    const refreshedUser = makeUser({ roleVersion: 2, roleName: "employee", roleId: "role-employee-id" });

    QM.getUserById.mockResolvedValue(refreshedUser);
    QM.getUserPermissions.mockResolvedValue(["accounting.invoices.view"]);

    const result = await jwt({
      token: {
        email: "user@northwindcg.example",
        userId: "user-1",
        role: "leadership",
        roleId: "role-leadership-id",
        isAdmin: false,
        roleVersion: 1,
        permissions: ["accounting.invoices.approve"],
      },
    } as never);

    expect(QM.getUserById).toHaveBeenCalledWith("user-1");
    expect(result.roleVersion).toBe(2);
    expect(result.roleId).toBe("role-employee-id");
    expect(result.permissions).toEqual(["accounting.invoices.view"]);
  });

  it("refreshes a Leadership session with the seeded COI override permission after a role-version bump", async () => {
    const jwt = getJwtCallback();
    const refreshedLeadershipUser = makeUser({
      roleId: "0782c7ec-4f29-4f0b-8a19-277ab6aa4b86",
      roleName: "Leadership",
      roleVersion: 2,
    });

    QM.getUserById.mockResolvedValue(refreshedLeadershipUser);
    QM.getUserPermissions.mockResolvedValue([
      "accounting.invoices.coi_override",
      "accounting.invoices.view",
    ]);

    const result = await jwt({
      token: {
        email: "user@northwindcg.example",
        userId: "user-1",
        role: "Leadership",
        roleId: "0782c7ec-4f29-4f0b-8a19-277ab6aa4b86",
        isAdmin: false,
        roleVersion: 1,
        permissions: ["accounting.invoices.view"],
      },
    } as never);

    expect(QM.getUserPermissions).toHaveBeenCalledWith("user-1");
    expect(result.roleVersion).toBe(2);
    expect(result.permissions).toContain("accounting.invoices.coi_override");
  });
});

describe("authOptions session callback", () => {
  it("copies the auth pipeline fields from the token onto session.user", async () => {
    const session = getSessionCallback();

    const result = await session({
      session: { user: { name: null, email: null, image: null } },
      token: {
        name: "Test User",
        email: "user@northwindcg.example",
        picture: null,
        jobTitle: "Director of Operations",
        userId: "user-1",
        role: "leadership",
        roleId: "role-leadership-id",
        isAdmin: false,
        roleVersion: 2,
        permissions: ["accounting.invoices.view"],
      },
    } as never);

    const user = result.user;

    expect(user).toBeDefined();
    if (!user || !("userId" in user)) {
      throw new Error("Expected resolved session user");
    }

    expect(user.position).toBe("Director of Operations");
    expect(user.userId).toBe("user-1");
    expect(user.role).toBe("leadership");
    expect(user.permissions).toEqual(["accounting.invoices.view"]);
  });
});
