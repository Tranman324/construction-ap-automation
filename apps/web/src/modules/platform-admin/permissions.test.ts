import { describe, expect, it } from 'vitest';
import { PLATFORM_ADMIN_PERMISSIONS } from '@/modules/platform-admin/permissions';

describe('PLATFORM_ADMIN_PERMISSIONS', () => {
  it('contains only the platform admin permission', () => {
    expect(Object.keys(PLATFORM_ADMIN_PERMISSIONS)).toEqual(['platform.admin']);
  });
});
