import type {
  AuditEventCatalog,
  RegisteredAuditEventDefinition,
} from "@/modules/shared/types/auditEvent";

const eventRegistry: Record<string, RegisteredAuditEventDefinition> = {};

export function registerModuleEvents(moduleName: string, events: AuditEventCatalog): void {
  Object.entries(events).forEach(([type, definition]) => {
    eventRegistry[type] = { ...definition, module: moduleName };
  });
}

export function getEventDefinition(type: string): RegisteredAuditEventDefinition | undefined {
  return eventRegistry[type];
}

export function getAllEventTypes(): string[] {
  return Object.keys(eventRegistry);
}

export function getModuleEventTypes(moduleName: string): string[] {
  return Object.entries(eventRegistry)
    .filter(([, definition]) => definition.module === moduleName)
    .map(([type]) => type);
}
