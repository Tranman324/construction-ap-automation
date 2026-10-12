import { describe, expect, it } from "vitest";

import {
  ADMIN_DISABLED_PERMISSION_COPY,
  ADMIN_HIGH_RISK_CONFIRMATION_COPY,
  ADMIN_OVERRIDE_COPY,
  ADMIN_PROTECTED_ROLE_COPY,
  HIGH_RISK_KEYS,
  getDisabledPermissionReason,
  getHighRiskConfirmationMessage,
  getOverrideSummary,
  getProtectedRoleReason,
} from "@/modules/platform-admin/lib/adminCopy";

describe("platform-admin adminCopy", () => {
  it("includes all required high-risk permission keys", () => {
    [
      "platform.admin",
      "platform.manage_users",
      "platform.manage_roles",
      "platform.manage_permissions",
      "platform.manage_title_rules",
      "accounting.invoices.submit_spectrum",
    ].forEach((permissionKey) => {
      expect(HIGH_RISK_KEYS.has(permissionKey)).toBe(true);
    });
  });

  it("returns deterministic operational copy", () => {
    expect(ADMIN_DISABLED_PERMISSION_COPY.title).toBe("Restricted permission");
    expect(ADMIN_OVERRIDE_COPY.emptyState).toContain("Select a user");
    expect(ADMIN_PROTECTED_ROLE_COPY.description).toContain("System roles");
    expect(ADMIN_HIGH_RISK_CONFIRMATION_COPY.description).toContain(
      "typed confirmation",
    );
    expect(getDisabledPermissionReason("platform.manage_roles")).toBe(
      "You cannot change platform.manage_roles until your account has the required admin access.",
    );
    expect(getOverrideSummary("Alex Admin")).toBe(
      "Overrides for Alex Admin replace role defaults for that user only.",
    );
    expect(getProtectedRoleReason("Platform Admin")).toBe(
      "Platform Admin is a protected system role and cannot be edited in v1.",
    );
    expect(getHighRiskConfirmationMessage("platform.admin")).toBe(
      "Changing platform.admin affects sensitive platform access and requires explicit confirmation.",
    );
    expect(getHighRiskConfirmationMessage("projects.view")).toBe(
      "Changing projects.view still requires confirmation before saving.",
    );
  });
});