import { PLATFORM_ADMIN_EVENTS } from "@/modules/platform-admin/events";
import { emitAuditEvent } from "@/modules/shared/lib/auditEmitter";
import type { AuditEventActor, AuditEventInput } from "@/modules/shared/types/auditEvent";

type PlatformAdminEventType = keyof typeof PLATFORM_ADMIN_EVENTS;

interface AuditAuthUser {
  userId?: string;
  name?: string;
  email?: string;
  role?: string;
}

interface PlatformAdminAuditOptions {
  targetId: string;
  summary: string;
  label?: string;
  changes?: AuditEventInput["changes"];
}

function resolveAuditActor(user: AuditAuthUser | null): AuditEventActor {
  return {
    userId: user?.userId || "unknown",
    name: user?.name || user?.email || "Unknown user",
    role: user?.role || "unknown",
  };
}

export function emitPlatformAdminAuditEvent(
  user: AuditAuthUser | null,
  type: PlatformAdminEventType,
  options: PlatformAdminAuditOptions,
): void {
  const definition = PLATFORM_ADMIN_EVENTS[type];
  const target: AuditEventInput["target"] = {
    type: definition.targetType,
    id: options.targetId,
    ...(options.label ? { label: options.label } : {}),
  };

  emitAuditEvent({
    type,
    actor: resolveAuditActor(user),
    target,
    ...(options.changes ? { changes: options.changes } : {}),
    summary: options.summary,
    module: "platform-admin",
    severity: definition.severity,
  });
}
