import { PROJECT_PERMISSIONS } from '@/modules/projects/permissions';
import { registerModule } from '@/modules/shared/lib/moduleRegistry';

registerModule('projects', {
  permissions: PROJECT_PERMISSIONS,
});

export {};
