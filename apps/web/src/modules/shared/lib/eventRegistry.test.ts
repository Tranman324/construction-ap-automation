import { beforeEach, describe, expect, it, vi } from "vitest";

function sortEventTypes(eventTypes: string[]): string[] {
  return [...eventTypes].sort();
}

beforeEach(() => {
  vi.resetModules();
});

describe("eventRegistry", () => {
  it("registers and looks up event definitions", async () => {
    const { getEventDefinition, registerModuleEvents } = await import("@/modules/shared/lib/eventRegistry");

    registerModuleEvents("invoices", {
      "invoice.approved": {
        label: "Invoice approved",
        severity: "info",
        targetType: "invoice",
      },
    });

    expect(getEventDefinition("invoice.approved")).toEqual({
      label: "Invoice approved",
      severity: "info",
      targetType: "invoice",
      module: "invoices",
    });
    expect(getEventDefinition("invoice.unknown")).toBeUndefined();
  });

  it("returns all registered event types across modules", async () => {
    const { getAllEventTypes, registerModuleEvents } = await import("@/modules/shared/lib/eventRegistry");

    registerModuleEvents("invoices", {
      "invoice.approved": {
        label: "Invoice approved",
        severity: "info",
        targetType: "invoice",
      },
    });
    registerModuleEvents("platform-admin", {
      "admin.role.deleted": {
        label: "Role deleted",
        severity: "critical",
        targetType: "role",
      },
    });

    expect(sortEventTypes(getAllEventTypes())).toEqual(
      sortEventTypes(["admin.role.deleted", "invoice.approved"]),
    );
  });

  it("returns event types for a single registered module", async () => {
    const { getModuleEventTypes, registerModuleEvents } = await import("@/modules/shared/lib/eventRegistry");

    registerModuleEvents("invoices", {
      "invoice.approved": {
        label: "Invoice approved",
        severity: "info",
        targetType: "invoice",
      },
      "invoice.deleted": {
        label: "Invoice deleted",
        severity: "warning",
        targetType: "invoice",
      },
    });
    registerModuleEvents("platform-admin", {
      "admin.role.deleted": {
        label: "Role deleted",
        severity: "critical",
        targetType: "role",
      },
    });

    expect(sortEventTypes(getModuleEventTypes("invoices"))).toEqual(
      sortEventTypes(["invoice.approved", "invoice.deleted"]),
    );
    expect(getModuleEventTypes("unknown")).toEqual([]);
  });

  it("re-registering a type replaces its definition", async () => {
    const { getEventDefinition, registerModuleEvents } = await import("@/modules/shared/lib/eventRegistry");

    registerModuleEvents("invoices", {
      "invoice.approved": {
        label: "Invoice approved",
        severity: "info",
        targetType: "invoice",
      },
    });
    registerModuleEvents("invoices", {
      "invoice.approved": {
        label: "Invoice approval recorded",
        severity: "warning",
        targetType: "invoice",
      },
    });

    expect(getEventDefinition("invoice.approved")).toMatchObject({
      label: "Invoice approval recorded",
      severity: "warning",
    });
  });
});
