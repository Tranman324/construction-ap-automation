import { describe, it, expect } from 'vitest';
import { StatusColor } from '@/modules/shared/types/ui';

// ─── StatusColor ──────────────────────────────────────────────────────────────

const EXPECTED_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'discarded',
  'submitted',
] as const;

describe('StatusColor', () => {
  it('has an entry for all core invoice statuses', () => {
    for (const status of EXPECTED_STATUSES) {
      expect(StatusColor).toHaveProperty(status);
    }
  });

  it('each value is a non-empty string', () => {
    for (const value of Object.values(StatusColor)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
