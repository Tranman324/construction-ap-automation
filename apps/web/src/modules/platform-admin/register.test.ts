import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('platform admin registration', () => {
  it('registers the platform admin permission manifest', async () => {
    await import('@/modules/platform-admin/register');
    const { getModulePermissions } = await import('@/modules/shared/lib/permissionRegistry');

    expect(getModulePermissions('platform-admin')).toEqual(['platform.admin']);
  });
});
