import type { PermissionManifest } from '@/modules/shared/types/permissions';

export const INVOICE_PERMISSIONS: PermissionManifest = {
  'accounting.invoices.view': 'View invoices list and search',
  'accounting.invoices.view_details': 'View invoice details, documents, and audit trail',
  'accounting.invoices.approve': 'Approve invoices for payment',
  'accounting.invoices.reject': 'Reject invoices with reason',
  'accounting.invoices.delete': 'Soft-delete invoices',
  'accounting.invoices.manage_retention': 'Configure retention and ignore rules',
  'accounting.invoices.manage_splits': 'Create and manage invoice splits',
  'accounting.invoices.export': 'Export invoice data',
  'accounting.invoices.submit_spectrum': 'Submit invoices to Spectrum',
  'accounting.invoices.request_waiver': 'Send lien waiver requests to vendors',
  'accounting.invoices.coi_override': 'Apply and revoke COI compliance overrides',
  'accounting.invoices.manage_settings': 'Manage invoice compliance settings',
} as const;
