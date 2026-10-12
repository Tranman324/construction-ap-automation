// ─── Subcontractor Types ─────────────────────────────────────────────────────

export type SubcontractStatus =
  | 'not_started'
  | 'generated'
  | 'sent'
  | 'signed'
  | 'active';

export type CloseoutDocsStatus = 'not_started' | 'partial' | 'complete';

// ─── Subcontractor ───────────────────────────────────────────────────────────

export interface Subcontractor {
  id: string;
  project_id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  trade: string;
  subcontract_number: string;
  contract_amount?: number | null;
  billed_amount?: number | null;
  outstanding_ap_balance?: number | null;
  billed_percent?: number | null;
  subcontract_status: SubcontractStatus;
  signed_at: string | null;
  closeout_docs_status: CloseoutDocsStatus;
  vendor_code: string | null;
}
