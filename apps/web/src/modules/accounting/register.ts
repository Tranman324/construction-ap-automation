import { ACCOUNTING_EVENTS } from "@/modules/accounting/events";
import { ACCOUNTING_PERMISSIONS } from "@/modules/accounting/permissions";
import { registerModule } from "@/modules/shared/lib/moduleRegistry";

registerModule("accounting", {
  events: ACCOUNTING_EVENTS,
  permissions: ACCOUNTING_PERMISSIONS,
});

export {};
