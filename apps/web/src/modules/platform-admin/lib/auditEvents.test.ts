import { describe, expect, it, vi } from "vitest";

const TM = vi.hoisted(() => ({
  emitAuditEvent: vi.fn(),
}));

vi.mock("@/modules/shared/lib/auditEmitter", () => ({
  emitAuditEvent: TM.emitAuditEvent,
}));

import { emitPlatformAdminAuditEvent } from "@/modules/platform-admin/lib/auditEvents";

describe("platform admin audit event helpers", () => {
  it("emits catalog-backed admin audit payloads", () => {
    TM.emitAuditEvent.mockReset();

    emitPlatformAdminAuditEvent(
      { userId: "user-1", name: "Alex", email: "alex@example.com", role: "admin" },
      "admin.user.role_changed",
      {
        targetId: "user-2",
        label: "Dana",
        summary: "Changed Dana's role to Admin",
        changes: { role: { from: "viewer", to: "admin" } },
      },
    );

    expect(TM.emitAuditEvent).toHaveBeenCalledWith({
      type: "admin.user.role_changed",
      actor: { userId: "user-1", name: "Alex", role: "admin" },
      target: { type: "user", id: "user-2", label: "Dana" },
      changes: { role: { from: "viewer", to: "admin" } },
      summary: "Changed Dana's role to Admin",
      module: "platform-admin",
      severity: "warning",
    });
  });

  it("falls back to unknown actor fields when auth is unavailable", () => {
    TM.emitAuditEvent.mockReset();

    emitPlatformAdminAuditEvent(null, "admin.role.deleted", {
      targetId: "role-1",
      summary: "Deleted role role-1",
    });

    expect(TM.emitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      actor: { userId: "unknown", name: "Unknown user", role: "unknown" },
      target: { type: "role", id: "role-1" },
      severity: "critical",
    }));
  });
});
