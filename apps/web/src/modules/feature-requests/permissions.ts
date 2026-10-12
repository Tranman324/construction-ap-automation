import type { PermissionManifest } from '@/modules/shared/types/permissions';

export const FEATURE_REQUEST_PERMISSIONS: PermissionManifest = {
  'feature_requests.view': 'View feature requests',
  'feature_requests.manage': 'Manage feature request statuses and administrative actions',
} as const;
