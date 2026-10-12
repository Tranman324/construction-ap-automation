export type AuditEventTargetType =
  | "invoice"
  | "project"
  | "user"
  | "role"
  | "title_rule"
  | "feature_request"
  | "system";

export type AuditEventSeverity = "info" | "warning" | "critical";

export interface AuditEventActor {
  userId: string;
  name: string;
  role: string;
}

export interface AuditEventTarget {
  type: AuditEventTargetType;
  id: string;
  label?: string;
}

export interface AuditEventChange {
  from: unknown;
  to: unknown;
}

export interface AuditEvent {
  id: string;
  type: string;
  timestamp: string;
  actor: AuditEventActor;
  target: AuditEventTarget;
  changes?: Record<string, AuditEventChange>;
  summary: string;
  module: string;
  severity: AuditEventSeverity;
}

export interface AuditEventInput extends Omit<AuditEvent, "id" | "timestamp"> {
  id?: string;
  timestamp?: string;
}

export interface AuditEventDefinition {
  label: string;
  severity: AuditEventSeverity;
  targetType: AuditEventTargetType;
}

export interface AuditEventCatalog {
  readonly [type: string]: AuditEventDefinition;
}

export interface RegisteredAuditEventDefinition extends AuditEventDefinition {
  module: string;
}
