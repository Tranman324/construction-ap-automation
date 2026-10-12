import { describe, expect, it } from "vitest";

import {
  buildUserOverridesPayload,
  countUserOverrideModes,
  createUserOverrideModeMap,
  getEffectiveUserOverrideState,
  normalizeUserOverrides,
} from "@/modules/platform-admin/components/userOverridesUtils";

describe("userOverridesUtils", () => {
  it("normalizes duplicate overrides and sorts them by permission key", () => {
    expect(
      normalizeUserOverrides([
        { key: "accounting.invoices.view", granted: true },
        { key: "platform.manage_users", granted: false },
        { key: "accounting.invoices.view", granted: false },
      ]),
    ).toEqual([
      { key: "accounting.invoices.view", granted: false },
      { key: "platform.manage_users", granted: false },
    ]);
  });

  it("derives effective inherited, granted, and revoked permission states", () => {
    const inheritedPermissions = new Set(["accounting.invoices.view"]);
    const overrideModeMap = createUserOverrideModeMap([
      { key: "platform.manage_users", granted: true },
      { key: "accounting.invoices.view", granted: false },
    ]);

    expect(
      getEffectiveUserOverrideState("projects.view", inheritedPermissions, overrideModeMap),
    ).toEqual({
      mode: "inherited",
      inheritedGranted: false,
      effectiveGranted: false,
    });

    expect(
      getEffectiveUserOverrideState("platform.manage_users", inheritedPermissions, overrideModeMap),
    ).toEqual({
      mode: "grant",
      inheritedGranted: false,
      effectiveGranted: true,
    });

    expect(
      getEffectiveUserOverrideState("accounting.invoices.view", inheritedPermissions, overrideModeMap),
    ).toEqual({
      mode: "revoke",
      inheritedGranted: true,
      effectiveGranted: false,
    });
  });

  it("builds a sorted replacement payload with only explicit grant and revoke overrides", () => {
    expect(
      buildUserOverridesPayload({
        "platform.manage_users": "grant",
        "accounting.invoices.view": "revoke",
        "projects.view": "inherited",
      }),
    ).toEqual([
      { key: "accounting.invoices.view", granted: false },
      { key: "platform.manage_users", granted: true },
    ]);
  });

  it("counts inherited, granted, and revoked override modes across the permission registry", () => {
    expect(
      countUserOverrideModes(
        ["accounting.invoices.view", "platform.manage_users", "projects.view"],
        {
          "accounting.invoices.view": "revoke",
          "platform.manage_users": "grant",
        },
      ),
    ).toEqual({
      inheritedCount: 1,
      grantCount: 1,
      revokeCount: 1,
    });
  });
});