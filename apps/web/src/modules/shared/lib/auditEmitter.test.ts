import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitAuditEvent } from "@/modules/shared/lib/auditEmitter";
import type { AuditEvent, AuditEventInput } from "@/modules/shared/types/auditEvent";

const fetchMock = vi.fn<typeof fetch>();
let warnMock: ReturnType<typeof vi.spyOn>;

function makeEvent(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    type: "invoice.approved",
    actor: {
      userId: "user_123",
      name: "Alex Morgan",
      role: "admin",
    },
    target: {
      type: "invoice",
      id: "inv_123",
      label: "Acme Invoice",
    },
    summary: "Approved invoice from Acme",
    module: "invoices",
    severity: "info",
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  warnMock.mockRestore();
});

describe("auditEmitter", () => {
  it("posts audit events to the backend route", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    emitAuditEvent(
      makeEvent({
        id: "evt_123",
        timestamp: "2026-05-14T12:00:00.000Z",
      }),
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    const event = JSON.parse(String(init?.body)) as AuditEvent;

    expect(url).toBe("/api/backend/audit/events");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(event).toMatchObject({
      id: "evt_123",
      timestamp: "2026-05-14T12:00:00.000Z",
      type: "invoice.approved",
    });
  });

  it("assigns id and timestamp when callers omit them", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));

    emitAuditEvent(makeEvent());

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, init] = fetchMock.mock.calls[0];
    const event = JSON.parse(String(init?.body)) as AuditEvent;

    expect(event.id).toEqual(expect.any(String));
    expect(event.timestamp).toEqual(expect.any(String));
  });

  it("catches fetch failures and does not throw", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    expect(() => emitAuditEvent(makeEvent())).not.toThrow();

    await vi.waitFor(() => expect(warnMock).toHaveBeenCalled());
  });

  it("warns for non-success responses without throwing", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    expect(() => emitAuditEvent(makeEvent())).not.toThrow();

    await vi.waitFor(() => expect(warnMock).toHaveBeenCalledWith("[audit] Failed to emit event:", "invoice.approved", 500));
  });
});
