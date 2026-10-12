import { describe, expect, it } from 'vitest';
import { PROJECT_PERMISSIONS } from '@/modules/projects/permissions';

describe('PROJECT_PERMISSIONS', () => {
  it('contains only the project view permission', () => {
    expect(Object.keys(PROJECT_PERMISSIONS)).toEqual(['projects.view']);
  });
});
