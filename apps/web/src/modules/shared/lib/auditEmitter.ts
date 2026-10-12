import type { AuditEvent, AuditEventInput } from "@/modules/shared/types/auditEvent";

const AUDIT_EVENTS_ENDPOINT = "/api/backend/audit/events";

function createAuditEventId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function prepareAuditEvent(event: AuditEventInput): AuditEvent {
  return {
    ...event,
    id: event.id ?? createAuditEventId(),
    timestamp: event.timestamp ?? new Date().toISOString(),
  };
}

async function postAuditEvent(eventInput: AuditEventInput): Promise<void> {
  const event = prepareAuditEvent(eventInput);

  try {
    const response = await fetch(AUDIT_EVENTS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      console.warn("[audit] Failed to emit event:", event.type, response.status);
    }
  } catch (error) {
    console.warn("[audit] Failed to emit event:", event.type, error);
  }
}

export function emitAuditEvent(event: AuditEventInput): void {
  void postAuditEvent(event);
}
