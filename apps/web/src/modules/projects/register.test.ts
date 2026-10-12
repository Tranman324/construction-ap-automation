import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('projects registration', () => {
  it('registers the project permission manifest', async () => {
    await import('@/modules/projects/register');
    const { getModulePermissions } = await import('@/modules/shared/lib/permissionRegistry');

    expect(getModulePermissions('projects')).toEqual(['projects.view']);
  });
});
