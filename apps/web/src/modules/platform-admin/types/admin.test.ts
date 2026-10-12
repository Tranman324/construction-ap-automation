import { describe, expect, it } from "vitest";

import type {
  AdminPermissionGroups,
  AdminPermissionsResponse,
  AdminRole,
  AdminRoleCreatePayload,
  AdminRolePermissionsResponse,
  AdminRolesResponse,
  AdminRoleUpdatePayload,
  AdminUser,
  AdminUserOverridesResponse,
  AdminUserUpdatePayload,
  AdminUsersResponse,
  TitleRule,
  TitleRuleCreatePayload,
  TitleRulePreviewPayload,
  TitleRuleUpdatePayload,
  AdminTitleRulesResponse,
} from "@/modules/platform-admin/types/admin";

describe("platform-admin types", () => {
  it("supports the verified direct admin response contracts", () => {
    const role: AdminRole = {
      id: "role-1",
      name: "Platform Admin",
      description: "Full platform access",
      is_system: true,
      user_count: 3,
    };

    const user: AdminUser = {
      id: "user-1",
      azure_id: "azure-1",
      email: "admin@example.com",
      name: "Alex Admin",
      role_id: role.id,
      is_active: true,
      job_title: "Controller",
      phone: null,
      avatar_url: null,
      role_version: 4,
      last_login_at: "2026-05-13T10:00:00.000Z",
      created_at: "2026-05-01T10:00:00.000Z",
      updated_at: null,
      role: {
        id: role.id,
        name: role.name,
        description: role.description,
        is_system: role.is_system,
      },
    };

    const permissions: AdminPermissionGroups = {
      platform: [{ key: "platform.admin", description: null }],
    };

    const titleRule: TitleRule = {
      id: "rule-1",
      pattern: "Controller",
      match_type: "contains",
      role_id: role.id,
      priority: 10,
      is_active: true,
      created_at: "2026-05-13T10:00:00.000Z",
      role_name: role.name,
    };

    const rolesResponse: AdminRolesResponse = [role];
    const usersResponse: AdminUsersResponse = [user];
    const permissionsResponse: AdminPermissionsResponse = permissions;
    const rolePermissionsResponse: AdminRolePermissionsResponse = [
      "platform.admin",
    ];
    const userOverridesResponse: AdminUserOverridesResponse = [
      { key: "accounting.invoices.submit_spectrum", granted: false },
    ];
    const titleRulesResponse: AdminTitleRulesResponse = [titleRule];

    expect(rolesResponse[0]?.name).toBe("Platform Admin");
    expect(usersResponse[0]?.role?.name).toBe("Platform Admin");
    expect(permissionsResponse.platform[0]?.key).toBe("platform.admin");
    expect(rolePermissionsResponse).toEqual(["platform.admin"]);
    expect(userOverridesResponse[0]?.granted).toBe(false);
    expect(titleRulesResponse[0]?.role_name).toBe("Platform Admin");
  });

  it("supports optional create and patch payload fields", () => {
    const roleCreatePayload: AdminRoleCreatePayload = {
      name: "Operations Lead",
    };

    const roleUpdatePayload: AdminRoleUpdatePayload = {};

    const userUpdatePayload: AdminUserUpdatePayload = {
      role_id: "role-1",
    };

    const titleRuleCreatePayload: TitleRuleCreatePayload = {
      pattern: "Controller",
      match_type: "contains",
      role_id: "role-1",
      priority: 10,
    };

    const titleRuleUpdatePayload: TitleRuleUpdatePayload = {
      is_active: false,
    };

    const preview: TitleRulePreviewPayload = { jobTitle: "Controller" };

    expect(roleCreatePayload.name).toBe("Operations Lead");
    expect(roleUpdatePayload).toEqual({});
    expect(userUpdatePayload.role_id).toBe("role-1");
    expect(titleRuleCreatePayload.priority).toBe(10);
    expect(titleRuleUpdatePayload.is_active).toBe(false);
    expect(preview.jobTitle).toBe("Controller");
  });
});