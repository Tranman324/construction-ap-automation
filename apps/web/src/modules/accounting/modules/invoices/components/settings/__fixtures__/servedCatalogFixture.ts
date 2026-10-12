// TEST-ONLY frozen served-catalog contract for M-100 parity coverage.
import type { ClassificationInfo, CostTypesResponse, RuleOptionsResponse } from "@/modules/accounting/modules/invoices/types/api";

export const SERVED_CLASSIFICATIONS: ClassificationInfo[] = [
  { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
  { name: "receipt", label: "Receipt", opensAs: "receipt", action: "extract-match", builtIn: true, status: "active" },
  { name: "coi", label: "COI", opensAs: "coi", action: "view-only", builtIn: true, status: "active" },
  { name: "w9", label: "W-9", opensAs: "w9", action: "view-only", builtIn: true, status: "active" },
  { name: "other", label: "Other", opensAs: "other", action: "view-only", builtIn: true, status: "active" },
];

export const SERVED_RULE_OPTIONS: RuleOptionsResponse = {
  actions: [],
  fields: [
    { value: "vendor_code", label: "vendor code" },
    { value: "email_from", label: "sender email" },
    { value: "vendor_name", label: "vendor name" },
  ],
  operators: [],
  statuses: [
    { value: "approved", label: "Approved" },
    { value: "discarded", label: "Discarded" },
    { value: "submitted", label: "Submitted" },
  ],
};

export const SERVED_COST_TYPES: CostTypesResponse = {
  costTypes: [
    { value: "B", label: "B - Bond" }, { value: "E", label: "E - Equipment" },
    { value: "L", label: "L - Labor" }, { value: "M", label: "M - Material" },
    { value: "O", label: "O - Other" }, { value: "S", label: "S - Subcontract" },
  ],
};
