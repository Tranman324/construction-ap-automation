// Display-only labels for approval DB fields (M-047).
//
// The approval/coding VERDICT is server-authoritative — see
// `GET /api/validate-approval/:id` (types/api.ts `ApprovalState`) and the
// `useValidateApproval` hook. The former client-side derivation
// (`getApprovalPath` / `validateApproval` / `readInvoiceString`) has been
// deleted; nothing here computes a path, required fields, blockers, or coding
// defaults. This module retains ONLY the human-readable labels used to format
// the backend-returned `missing` field list on an approval rejection (400).

export type ApprovalDbField =
  | "invoice_number"
  | "vendor_code"
  | "invoice_date"
  | "gl_date"
  | "amount"
  | "job_match_number"
  | "phase_code"
  | "cost_type"
  | "gl_account"
  | "routing_code";

const FIELD_LABELS: Record<ApprovalDbField, string> = {
  invoice_number: "Invoice Number",
  vendor_code: "Vendor",
  invoice_date: "Invoice Date",
  gl_date: "GL Date",
  amount: "Amount",
  job_match_number: "Job",
  phase_code: "Phase Code",
  cost_type: "Cost Type",
  gl_account: "GL Account",
  routing_code: "Routing Code",
};

export function formatMissingApprovalFields(missing: ApprovalDbField[]): string {
  return missing.map((field) => FIELD_LABELS[field] ?? field).join(", ");
}
