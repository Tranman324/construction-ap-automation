import type { InvoiceStatus } from './invoice';

// ─── Invoice Filters ──────────────────────────────────────────────────────────

export type InvoiceStatusFilter = InvoiceStatus | 'all' | 'documents' | 'flagged';
export const INVOICE_PANELS = ['invoice', 'receipt', 'statement', 'coi', 'w9', 'lien-waiver', 'other'] as const;
export type InvoicePanel = (typeof INVOICE_PANELS)[number];

export interface InvoiceFilters {
  status?: InvoiceStatusFilter;
  panel?: InvoicePanel;
  /** Legacy exact-classification filter retained for deep-link compatibility. */
  classification?: string;
  /** Client-only dashboard filter. Omitted from API requests. */
  job?: string;
  search?: string;
  sort?: 'date' | 'received' | 'vendor' | 'amount' | 'classification' | 'waivers-first';
  /** Client-only — combined with sort into `-field` format before API call */
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  /** Lane separator: false = Invoice Queue, true = Documents Shelf */
  filed?: boolean;
  /** Server-side review-flag filter (`flagged=true`), composable with status and panel; never a client-side row filter. */
  flagged?: boolean;
  /** Opt-in search-only list scope. It ignores the ordinary dashboard filters. */
  scope?: 'global';
}
