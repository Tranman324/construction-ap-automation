import { describe, it, expect } from 'vitest';
import {
  validateRequired,
  validateDateRange,
  validateJobNumber,
  validateAddress,
  validateContractValue,
  validateJobSetup,
  type JobSetupInput,
} from './validation';

// ─── validateRequired ─────────────────────────────────────────────────────────

describe('validateRequired', () => {
  it('returns null for a non-empty string', () => {
    expect(validateRequired('hello', 'Field')).toBeNull();
  });

  it('returns error for empty string', () => {
    expect(validateRequired('', 'Field')).toBe('Field is required');
  });

  it('returns error for whitespace-only string', () => {
    expect(validateRequired('   ', 'Field')).toBe('Field is required');
  });

  it('returns error for null', () => {
    expect(validateRequired(null, 'Field')).toBe('Field is required');
  });

  it('returns error for undefined', () => {
    expect(validateRequired(undefined, 'Field')).toBe('Field is required');
  });

  it('returns null for a non-zero number', () => {
    expect(validateRequired(42, 'Field')).toBeNull();
  });
});

// ─── validateDateRange ────────────────────────────────────────────────────────

describe('validateDateRange', () => {
  it('returns null for valid range (end after start)', () => {
    expect(validateDateRange('2026-03-01', '2026-09-01')).toBeNull();
  });

  it('returns error when end date equals start date (same day fails)', () => {
    expect(validateDateRange('2026-03-01', '2026-03-01')).toBe(
      'End date must be after start date',
    );
  });

  it('returns error when end date is before start date', () => {
    expect(validateDateRange('2026-09-01', '2026-03-01')).toBe(
      'End date must be after start date',
    );
  });

  it('returns start date required error when start is empty', () => {
    expect(validateDateRange('', '2026-09-01')).toBe('Start date is required');
  });

  it('returns end date required error when end is empty', () => {
    expect(validateDateRange('2026-03-01', '')).toBe('End date is required');
  });
});

// ─── validateJobNumber ────────────────────────────────────────────────────────

describe('validateJobNumber', () => {
  it('returns null for valid format "25-559"', () => {
    expect(validateJobNumber('25-559')).toBeNull();
  });

  it('returns null for valid format "26-412"', () => {
    expect(validateJobNumber('26-412')).toBeNull();
  });

  it('returns null for 4-digit suffix "25-1234"', () => {
    expect(validateJobNumber('25-1234')).toBeNull();
  });

  it('returns error for "abc"', () => {
    expect(validateJobNumber('abc')).toBe(
      'Job number must match format YY-NNN (e.g. 25-559)',
    );
  });

  it('returns error for "25159" (missing hyphen)', () => {
    expect(validateJobNumber('25159')).toBe(
      'Job number must match format YY-NNN (e.g. 25-559)',
    );
  });

  it('returns error for empty string', () => {
    expect(validateJobNumber('')).toBe('Job number is required');
  });

  it('returns error for "2-123" (single digit year)', () => {
    expect(validateJobNumber('2-123')).toBe(
      'Job number must match format YY-NNN (e.g. 25-559)',
    );
  });
});

// ─── validateAddress ──────────────────────────────────────────────────────────

describe('validateAddress', () => {
  it('returns null for a valid address string >= 10 chars', () => {
    expect(validateAddress('123 Main St, Atlanta, GA')).toBeNull();
  });

  it('returns error for empty string', () => {
    expect(validateAddress('')).toBe('Address is required');
  });

  it('returns error for string shorter than 10 chars', () => {
    expect(validateAddress('123 Main')).toBe('Address appears too short');
  });

  it('returns error for whitespace-only string', () => {
    expect(validateAddress('         ')).toBe('Address is required');
  });
});

// ─── validateJobSetup ─────────────────────────────────────────────────────────

describe('validateJobSetup', () => {
  const validInput: JobSetupInput = {
    formData: {
      job_name: 'Buckhead Office Renovation',
      customer_name: 'Kinsley Properties',
      job_type: 'Renovation',
      address: '3280 Example Rd NE, Atlanta, GA 30305',
      start_date: '2026-03-01',
      end_date: '2026-09-01',
    },
    pmId: 'user-3',
  };

  it('returns valid: true for a complete valid input', () => {
    const result = validateJobSetup(validInput);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('returns valid: false when job_name is missing', () => {
    const result = validateJobSetup({
      ...validInput,
      formData: { ...validInput.formData, job_name: '' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.job_name).toBeDefined();
  });

  it('returns valid: false when customer_name is missing', () => {
    const result = validateJobSetup({
      ...validInput,
      formData: { ...validInput.formData, customer_name: '' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.customer_name).toBeDefined();
  });

  it('returns valid: false when job_type is missing', () => {
    const result = validateJobSetup({
      ...validInput,
      formData: { ...validInput.formData, job_type: '' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.job_type).toBeDefined();
  });

  it('returns valid: false when pmId is empty string', () => {
    const result = validateJobSetup({ ...validInput, pmId: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.pm).toBe('A project manager must be assigned');
  });

  it('returns valid: false when end_date is before start_date, error key is date_range', () => {
    const result = validateJobSetup({
      ...validInput,
      formData: {
        ...validInput.formData,
        start_date: '2026-09-01',
        end_date: '2026-03-01',
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.date_range).toBeDefined();
  });

  it('returns valid: false when address is too short', () => {
    const result = validateJobSetup({
      ...validInput,
      formData: { ...validInput.formData, address: '123 Main' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.address).toBe('Address appears too short');
  });

  it('returns multiple errors for multiple invalid fields', () => {
    const result = validateJobSetup({
      formData: {
        job_name: '',
        customer_name: '',
        job_type: '',
        address: '',
        start_date: '',
        end_date: '',
      },
      pmId: '',
    });
    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors).length).toBeGreaterThan(1);
    expect(result.errors.job_name).toBeDefined();
    expect(result.errors.customer_name).toBeDefined();
    expect(result.errors.pm).toBeDefined();
  });

  it('passes when contract_value is undefined (optional at submission)', () => {
    const result = validateJobSetup({
      ...validInput,
      formData: { ...validInput.formData, contract_value: undefined },
    });
    expect(result.valid).toBe(true);
    expect(result.errors.contract_value).toBeUndefined();
  });

  it('returns error for contract_value of 0 when provided', () => {
    const result = validateJobSetup({
      ...validInput,
      formData: { ...validInput.formData, contract_value: 0 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.contract_value).toBe(
      'Contract value must be greater than 0',
    );
  });

  it('passes with only required fields (no job_number, no contract_value)', () => {
    const result = validateJobSetup({
      formData: {
        job_name: 'Buckhead Office Renovation',
        customer_name: 'Kinsley Properties',
        job_type: 'Renovation',
        address: '3280 Example Rd NE, Atlanta, GA 30305',
        start_date: '2026-03-01',
        end_date: '2026-09-01',
      },
      pmId: 'user-3',
    });
    expect(result.valid).toBe(true);
  });

  it('returns error for malformed job_number when job_number is present', () => {
    const result = validateJobSetup({
      ...validInput,
      formData: { ...validInput.formData, job_number: '2-12' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.job_number).toBeDefined();
  });

  it('passes for valid job_number when present', () => {
    const result = validateJobSetup({
      ...validInput,
      formData: { ...validInput.formData, job_number: '26-442' },
    });
    expect(result.valid).toBe(true);
    expect(result.errors.job_number).toBeUndefined();
  });
});
