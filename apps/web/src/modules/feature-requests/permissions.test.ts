import { describe, expect, it } from 'vitest';
import { FEATURE_REQUEST_PERMISSIONS } from '@/modules/feature-requests/permissions';

describe('FEATURE_REQUEST_PERMISSIONS', () => {
  it('contains the feature request permissions in deterministic order', () => {
    expect(Object.keys(FEATURE_REQUEST_PERMISSIONS)).toEqual([
      'feature_requests.view',
      'feature_requests.manage',
    ]);
  });
});
