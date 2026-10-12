import type { Project } from '@/modules/projects/types/project';

// ─── Result type ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

// ─── Field validators ─────────────────────────────────────────────────────────

export function validateRequired(value: unknown, fieldName: string): string | null {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? null : `${fieldName} is required`;
  }
  return value != null && !!value ? null : `${fieldName} is required`;
}

export function validateDateRange(start: string, end: string): string | null {
  if (!start) return 'Start date is required';
  if (!end) return 'End date is required';
  return new Date(end) > new Date(start) ? null : 'End date must be after start date';
}

export function validateJobNumber(value: string): string | null {
  if (!value) return 'Job number is required';
  return /^\d{2}-\d{3,}$/.test(value)
    ? null
    : 'Job number must match format YY-NNN (e.g. 25-559)';
}

export function validateAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Address is required';
  if (trimmed.length < 10) return 'Address appears too short';
  return null;
}

export function validateContractValue(value: number | undefined): string | null {
  if (value === undefined || isNaN(value)) return 'Contract value is required';
  if (value <= 0) return 'Contract value must be greater than 0';
  return null;
}

// ─── Main validator ───────────────────────────────────────────────────────────

export interface JobSetupInput {
  formData: Partial<Project>;
  pmId: string;
}

export function validateJobSetup(input: JobSetupInput): ValidationResult {
  const { formData, pmId } = input;
  const errors: Record<string, string> = {};

  const jobNameError = validateRequired(formData.job_name, 'Job name');
  if (jobNameError) errors.job_name = jobNameError;

  const customerError = validateRequired(formData.customer_name, 'Customer');
  if (customerError) errors.customer_name = customerError;

  const jobTypeError = validateRequired(formData.job_type, 'Job type');
  if (jobTypeError) errors.job_type = jobTypeError;

  const addressError = validateAddress(formData.address ?? '');
  if (addressError) errors.address = addressError;

  const dateRangeError = validateDateRange(
    formData.start_date ?? '',
    formData.end_date ?? '',
  );
  if (dateRangeError) errors.date_range = dateRangeError;

  if (!pmId) {
    errors.pm = 'A project manager must be assigned';
  }

  if (formData.contract_value !== undefined) {
    const contractError = validateContractValue(formData.contract_value);
    if (contractError) errors.contract_value = contractError;
  }

  if (formData.job_number) {
    const jobNumberError = validateJobNumber(formData.job_number);
    if (jobNumberError) errors.job_number = jobNumberError;
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
