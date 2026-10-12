import { describe, it, expect } from 'vitest';
import { evaluateHealthFlags } from './healthFlags';
import type { HealthResult } from './healthFlags';
import { ProjectStatus } from '@/modules/projects/types/project';
import type { Project, Phase } from '@/modules/projects/types/project';
import type { Subcontractor } from '@/modules/projects/types/subcontractor';
import type { ChecklistInstance, ChecklistItem, ChecklistType } from '@/modules/projects/types/checklist';
import type { CloseoutItem } from '@/modules/projects/types/closeout';

// ─── Test Data Builders ───────────────────────────────────────────────────────

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-test',
    job_number: '25-401',
    job_name: 'Test Project',
    customer_name: 'Test Customer',
    status: ProjectStatus.active,
    phase: 5 as Phase,
    closeout_type: 'short',
    photos_required: true,
    contract_value: 500000,
    profit_percent: 10,
    permit_status: 'obtained',
    contract_status: 'in_hand',
    start_date: new Date(Date.now() - 30 * 86400000).toISOString(),
    end_date: new Date(Date.now() + 60 * 86400000).toISOString(),
    projected_end_date: new Date(Date.now() + 60 * 86400000).toISOString(),
    address: '123 Test St',
    lat: 33.749,
    lng: -84.388,
    cost_center: 'CC-001',
    times_priced: 1,
    estimate_number: 'EST-001',
    job_type: 'TI',
    who_sold: 'Test User',
    notes: '',
    phase_codes: [],
    billing_items: [],
    created_at: new Date(Date.now() - 60 * 86400000).toISOString(),
    approved_at: null,
    approved_by: null,
    ...overrides,
  };
}

function makeSub(overrides: Partial<Subcontractor> = {}): Subcontractor {
  return {
    id: 's-test',
    project_id: 'p-test',
    company_name: 'Test Co',
    contact_name: 'Test Contact',
    email: 'test@example.test',
    phone: '555-0000',
    trade: 'General',
    subcontract_number: 'SC-001',
    subcontract_status: 'active',
    signed_at: '2025-01-01T00:00:00.000Z',
    closeout_docs_status: 'not_started',
    vendor_code: null,
    ...overrides,
  };
}

function makeChecklist(type: ChecklistType, items: Partial<ChecklistItem>[] = []): ChecklistInstance {
  return {
    id: 'cl-test',
    project_id: 'p-test',
    type,
    started_at: null,
    completed_at: null,
    sections: [
      {
        title: 'Test Section',
        items: items.map(i => ({
          id: 'item-test',
          section: 'Test Section',
          item_text: 'Test item',
          requires_photo: false,
          requires_input: false,
          input_placeholder: '',
          input_value: '',
          is_completed: false,
          completed_by: null,
          completed_at: null,
          photo_url: null,
          photo_gps_lat: null,
          photo_gps_lng: null,
          notes: '',
          ...i,
        })),
      },
    ],
  };
}

function makeCloseoutItem(overrides: Partial<CloseoutItem> = {}): CloseoutItem {
  return {
    id: 'co-test',
    item_name: 'Test Item',
    item_category: 'short',
    is_per_sub: false,
    status: 'not_started',
    document_url: null,
    received_at: null,
    notes: '',
    ...overrides,
  };
}

const FUTURE = new Date(Date.now() + 30 * 86400000);
const PAST_8 = new Date(Date.now() - 8 * 86400000);
const PAST_20 = new Date(Date.now() - 20 * 86400000);

// ─── RED FLAGS ────────────────────────────────────────────────────────────────

describe('RED FLAGS', () => {

  describe('unsigned_paid_sub', () => {
    it('flags sub with closeout_docs_status=complete but no signed contract', () => {
      const sub = makeSub({ subcontract_status: 'sent', signed_at: null, closeout_docs_status: 'complete' });
      const result: HealthResult = evaluateHealthFlags(makeProject(), [sub], [], []);
      expect(result.flags.some(f => f.flag_type === 'unsigned_paid_sub')).toBe(true);
      expect(result.health).toBe('red');
    });

    it('does not flag active sub with signed contract', () => {
      const sub = makeSub({ subcontract_status: 'active', signed_at: '2025-01-01T00:00:00.000Z', closeout_docs_status: 'complete' });
      const result = evaluateHealthFlags(makeProject(), [sub], [], []);
      expect(result.flags.some(f => f.flag_type === 'unsigned_paid_sub')).toBe(false);
    });
  });

  describe('missing_permit', () => {
    it('flags project with permit in_process and start > 7 days ago', () => {
      const project = makeProject({ permit_status: 'in_process', start_date: PAST_8.toISOString() });
      const result = evaluateHealthFlags(project, [], [], [], FUTURE);
      expect(result.flags.some(f => f.flag_type === 'missing_permit')).toBe(true);
    });

    it('does not flag project started <= 7 days ago', () => {
      const recent = new Date(Date.now() - 5 * 86400000);
      const project = makeProject({ permit_status: 'in_process', start_date: recent.toISOString() });
      const result = evaluateHealthFlags(project, [], [], [], FUTURE);
      expect(result.flags.some(f => f.flag_type === 'missing_permit')).toBe(false);
    });

    it('does not flag project with permit obtained', () => {
      const project = makeProject({ permit_status: 'obtained', start_date: PAST_20.toISOString() });
      const result = evaluateHealthFlags(project, [], [], [], FUTURE);
      expect(result.flags.some(f => f.flag_type === 'missing_permit')).toBe(false);
    });

    it('does not flag not_required permit project', () => {
      const project = makeProject({ permit_status: 'not_required', start_date: PAST_20.toISOString() });
      const result = evaluateHealthFlags(project, [], [], [], FUTURE);
      expect(result.flags.some(f => f.flag_type === 'missing_permit')).toBe(false);
    });
  });

  describe('closeout_not_initiated', () => {
    it('flags phase 7 project with no closeout items', () => {
      const result = evaluateHealthFlags(makeProject({ phase: 7 as Phase }), [], [], []);
      expect(result.flags.some(f => f.flag_type === 'closeout_not_initiated')).toBe(true);
    });

    it('flags phase 8 project where all closeout items are not_started', () => {
      const items = [makeCloseoutItem({ status: 'not_started' }), makeCloseoutItem({ id: 'co-2', status: 'not_started' })];
      const result = evaluateHealthFlags(makeProject({ phase: 8 as Phase }), [], [], items);
      expect(result.flags.some(f => f.flag_type === 'closeout_not_initiated')).toBe(true);
    });

    it('does not flag phase 7 project with at least one in-progress closeout item', () => {
      const items = [makeCloseoutItem({ status: 'requested' })];
      const result = evaluateHealthFlags(makeProject({ phase: 7 as Phase }), [], [], items);
      expect(result.flags.some(f => f.flag_type === 'closeout_not_initiated')).toBe(false);
    });

    it('does not flag phase 2 project (below threshold)', () => {
      const result = evaluateHealthFlags(makeProject({ phase: 2 as Phase }), [], [], []);
      expect(result.flags.some(f => f.flag_type === 'closeout_not_initiated')).toBe(false);
    });
  });

});

// ─── YELLOW FLAGS ─────────────────────────────────────────────────────────────

describe('YELLOW FLAGS', () => {

  describe('unsigned_subcontract', () => {
    it('flags sent sub with no signature when project start > 14 days ago', () => {
      const sub = makeSub({ subcontract_status: 'sent', signed_at: null });
      // Use phase 2 to avoid closeout_not_initiated red flag (triggers at phase >= 3)
      const project = makeProject({ phase: 2 as Phase, start_date: PAST_20.toISOString() });
      const result = evaluateHealthFlags(project, [sub], [], []);
      expect(result.flags.some(f => f.flag_type === 'unsigned_subcontract')).toBe(true);
      expect(result.health).toBe('yellow');
    });

    it('does not flag sent sub when project start <= 14 days ago', () => {
      const sub = makeSub({ subcontract_status: 'sent', signed_at: null });
      const project = makeProject({ start_date: new Date(Date.now() - 10 * 86400000).toISOString() });
      const result = evaluateHealthFlags(project, [sub], [], []);
      expect(result.flags.some(f => f.flag_type === 'unsigned_subcontract')).toBe(false);
    });

    it('does not flag signed sub', () => {
      const sub = makeSub({ subcontract_status: 'signed', signed_at: '2025-01-01T00:00:00.000Z' });
      const result = evaluateHealthFlags(makeProject({ start_date: PAST_20.toISOString() }), [sub], [], []);
      expect(result.flags.some(f => f.flag_type === 'unsigned_subcontract')).toBe(false);
    });
  });

  describe('preflight_incomplete', () => {
    it('flags phase 5+ project with incomplete preflight', () => {
      const cl = makeChecklist('preflight', [{ is_completed: false }]);
      const result = evaluateHealthFlags(makeProject({ phase: 5 as Phase }), [], [cl], []);
      expect(result.flags.some(f => f.flag_type === 'preflight_incomplete')).toBe(true);
    });

    it('does not flag when all preflight items complete', () => {
      const cl = makeChecklist('preflight', [{ is_completed: true }]);
      const result = evaluateHealthFlags(makeProject({ phase: 5 as Phase }), [], [cl], []);
      expect(result.flags.some(f => f.flag_type === 'preflight_incomplete')).toBe(false);
    });

    it('does not flag phase 1 project (below threshold)', () => {
      const cl = makeChecklist('preflight', [{ is_completed: false }]);
      const result = evaluateHealthFlags(makeProject({ phase: 1 as Phase }), [], [cl], []);
      expect(result.flags.some(f => f.flag_type === 'preflight_incomplete')).toBe(false);
    });
  });

  describe('missing_evidence', () => {
    it('flags completed requires_photo item with no photo_url', () => {
      const cl = makeChecklist('preflight', [{ requires_photo: true, is_completed: true, photo_url: null }]);
      const result = evaluateHealthFlags(makeProject(), [], [cl], []);
      expect(result.flags.some(f => f.flag_type === 'missing_evidence')).toBe(true);
    });

    it('does not flag completed requires_photo item that has a photo', () => {
      const cl = makeChecklist('preflight', [{ requires_photo: true, is_completed: true, photo_url: '#photo' }]);
      const result = evaluateHealthFlags(makeProject(), [], [cl], []);
      expect(result.flags.some(f => f.flag_type === 'missing_evidence')).toBe(false);
    });

    it('does not flag incomplete requires_photo item', () => {
      const cl = makeChecklist('preflight', [{ requires_photo: true, is_completed: false, photo_url: null }]);
      const result = evaluateHealthFlags(makeProject(), [], [cl], []);
      expect(result.flags.some(f => f.flag_type === 'missing_evidence')).toBe(false);
    });

    it('caps missing_evidence flags at 3', () => {
      const items = Array.from({ length: 6 }, (_, i) => ({
        id: `item-${i}`,
        requires_photo: true,
        is_completed: true,
        photo_url: null,
      }));
      const cl = makeChecklist('preflight', items);
      const result = evaluateHealthFlags(makeProject(), [], [cl], []);
      const evidenceFlags = result.flags.filter(f => f.flag_type === 'missing_evidence');
      expect(evidenceFlags.length).toBeLessThanOrEqual(3);
    });
  });

  describe('closeout_doc_overdue', () => {
    it('flags phase 7 with not_started closeout item', () => {
      const items = [makeCloseoutItem({ status: 'not_started' })];
      const result = evaluateHealthFlags(makeProject({ phase: 7 as Phase }), [], [], items);
      expect(result.flags.some(f => f.flag_type === 'closeout_doc_overdue')).toBe(true);
    });

    it('does not flag when all items received or verified', () => {
      const items = [makeCloseoutItem({ status: 'received' }), makeCloseoutItem({ id: 'co-2', status: 'verified' })];
      const result = evaluateHealthFlags(makeProject({ phase: 7 as Phase }), [], [], items);
      expect(result.flags.some(f => f.flag_type === 'closeout_doc_overdue')).toBe(false);
    });
  });

});

// ─── HEALTH DERIVATION ────────────────────────────────────────────────────────

describe('HEALTH DERIVATION', () => {
  it('returns green for a clean project', () => {
    const sub = makeSub();
    const cl = makeChecklist('preflight', [{ is_completed: true }]);
    const co = [makeCloseoutItem({ status: 'received' })];
    const result = evaluateHealthFlags(makeProject(), [sub], [cl], co);
    expect(result.health).toBe('green');
    expect(result.flags).toHaveLength(0);
  });

  it('returns red when any red flag exists even if yellow flags also present', () => {
    const cl = makeChecklist('preflight', [{ is_completed: false }]);
    const result = evaluateHealthFlags(makeProject({ phase: 7 as Phase }), [], [cl], []);
    expect(result.health).toBe('red');
  });

  it('returns yellow when only yellow flags', () => {
    const cl = makeChecklist('preflight', [{ is_completed: false }]);
    const co = [makeCloseoutItem({ status: 'received' })];
    const result = evaluateHealthFlags(makeProject({ phase: 5 as Phase }), [], [cl], co);
    expect(result.health).toBe('yellow');
  });

  it('handles empty inputs without throwing', () => {
    expect(() => evaluateHealthFlags(makeProject(), [], [], [])).not.toThrow();
  });
});
