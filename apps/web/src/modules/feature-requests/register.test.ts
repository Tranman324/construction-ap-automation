import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('feature requests registration', () => {
  it('registers the feature request permission manifest', async () => {
    await import('@/modules/feature-requests/register');
    const { getModulePermissions } = await import('@/modules/shared/lib/permissionRegistry');

    expect(getModulePermissions('feature-requests')).toEqual([
      'feature_requests.view',
      'feature_requests.manage',
    ]);
  });
});
