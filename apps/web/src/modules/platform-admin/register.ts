import { PLATFORM_ADMIN_EVENTS } from '@/modules/platform-admin/events';
import { PLATFORM_ADMIN_PERMISSIONS } from '@/modules/platform-admin/permissions';
import { registerModule } from '@/modules/shared/lib/moduleRegistry';

registerModule('platform-admin', {
  events: PLATFORM_ADMIN_EVENTS,
  permissions: PLATFORM_ADMIN_PERMISSIONS,
});

export {};
