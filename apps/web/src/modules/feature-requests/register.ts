import { FEATURE_REQUEST_PERMISSIONS } from '@/modules/feature-requests/permissions';
import { registerModule } from '@/modules/shared/lib/moduleRegistry';

registerModule('feature-requests', {
  permissions: FEATURE_REQUEST_PERMISSIONS,
});

export {};
