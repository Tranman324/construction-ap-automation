import { describe, expect, it } from "vitest";
import type {
  AuditEvent,
  AuditEventDefinition,
  AuditEventInput,
  AuditEventTargetType,
} from "@/modules/shared/types/auditEvent";

describe("auditEvent types", () => {
  it("accepts the documented audit event contract", () => {
    const targetType: AuditEventTargetType = "invoice";
    const event: AuditEvent = {
      id: "evt_123",
      type: "invoice.approved",
      timestamp: "2026-05-14T12:00:00.000Z",
      actor: {
        userId: "user_123",
        name: "Alex Morgan",
        role: "admin",
      },
      target: {
        type: targetType,
        id: "inv_123",
        label: "Acme Invoice",
      },
      changes: {
        status: { from: "pending", to: "approved" },
      },
      summary: "Approved invoice from Acme",
      module: "invoices",
      severity: "info",
    };

    expect(event.target.type).toBe("invoice");
    expect(event.changes?.status.to).toBe("approved");
  });

  it("allows emitter inputs before id and timestamp are assigned", () => {
    const input: AuditEventInput = {
      type: "admin.role.deleted",
      actor: {
        userId: "user_123",
        name: "Alex Morgan",
        role: "admin",
      },
      target: {
        type: "role",
        id: "role_123",
      },
      summary: "Deleted a role",
      module: "platform-admin",
      severity: "critical",
    };
    const definition: AuditEventDefinition = {
      label: "Role deleted",
      severity: "critical",
      targetType: "role",
    };

    expect(input.id).toBeUndefined();
    expect(definition.targetType).toBe("role");
  });
});
