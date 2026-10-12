// TEST-ONLY fixture. Value-identical snapshot of the rule-builder catalogs that
// used to live in the deleted `ruleOptions.ts`, reshaped as the served
// `RuleOptionsResponse`. Rule tests seed `useRuleOptions` / build label maps
// from this so message and summary text stays byte-identical to production
// behavior. Not imported by any production source.

import type { RuleOptionsResponse } from "@/modules/accounting/modules/invoices/types/api";

export const SEEDED_RULE_OPTIONS: RuleOptionsResponse = {
  actions: [
    { value: "auto_approve", label: "Auto-approve" },
    { value: "auto_discard", label: "Auto-discard" },
    { value: "auto_file", label: "File it" },
    { value: "hide_from_queue", label: "Hide from queue" },
    { value: "set_vendor", label: "Set vendor" },
    { value: "set_job", label: "Set job number" },
    { value: "set_classification", label: "Set document type" },
    { value: "assign_reviewer", label: "Assign reviewer" },
    { value: "add_note", label: "Add note" },
    { value: "flag", label: "Flag for attention" },
    { value: "set_phase_code", label: "Set phase code" },
    { value: "set_gl_account", label: "Set GL account" },
    { value: "set_cost_type", label: "Set cost type" },
    { value: "set_routing_code", label: "Set routing code" },
  ],
  fields: [
    { value: "vendor_name", label: "Vendor Name" },
    { value: "vendor_code", label: "Vendor Code" },
    { value: "amount", label: "Amount ($)" },
    { value: "description", label: "Description / Memo" },
    { value: "invoice_number", label: "Invoice Number" },
    { value: "job_number", label: "Job Number" },
    { value: "classification", label: "Document Type" },
    { value: "status", label: "Status" },
    { value: "email_from", label: "Sender Email" },
    { value: "email_subject", label: "Email Subject" },
  ],
  operators: [
    { value: "contains", label: "Contains" },
    { value: "not_contains", label: "Does not contain" },
    { value: "equals", label: "Equals" },
    { value: "not_equals", label: "Does not equal" },
    { value: "starts_with", label: "Starts with" },
    { value: "ends_with", label: "Ends with" },
    { value: "gt", label: "Greater than" },
    { value: "lt", label: "Less than" },
    { value: "gte", label: "At least" },
    { value: "lte", label: "At most" },
    { value: "between", label: "Is between" },
    { value: "is_empty", label: "Is empty" },
    { value: "is_not_empty", label: "Is not empty" },
  ],
  statuses: [
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "discarded", label: "Discarded" },
    { value: "submitted", label: "Submitted" },
    { value: "retry-pending", label: "Retry Pending" },
    { value: "duplicate", label: "Duplicate" },
    { value: "reviewed", label: "Reviewed" },
  ],
};
