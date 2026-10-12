import { describe, expect, it } from "vitest";
import { PLATFORM_ADMIN_EVENTS } from "@/modules/platform-admin/events";

describe("PLATFORM_ADMIN_EVENTS", () => {
  it("defines the expected admin audit event types", () => {
    expect(Object.keys(PLATFORM_ADMIN_EVENTS).sort()).toEqual(
      [
        "admin.role.created",
        "admin.role.deleted",
        "admin.role.updated",
        "admin.title_rule.created",
        "admin.title_rule.deleted",
        "admin.title_rule.updated",
        "admin.user.permissions_overridden",
        "admin.user.role_changed",
      ].sort(),
    );
  });

  it("marks sensitive role deletion as critical", () => {
    expect(PLATFORM_ADMIN_EVENTS["admin.role.deleted"]).toMatchObject({
      severity: "critical",
      targetType: "role",
    });
    expect(PLATFORM_ADMIN_EVENTS["admin.title_rule.deleted"]).toMatchObject({
      severity: "warning",
      targetType: "title_rule",
    });
  });
});
