import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type {
  Rule,
  RuleAction,
  RuleApplyPayload,
  RuleCreatePayload,
  RuleCriteriaField,
  RuleCriteriaOperator,
  RuleCriterion,
} from "@/modules/accounting/modules/invoices/types/rules";
import { CLEARABLE_ACTIONS, VALUELESS_ACTIONS } from "@/modules/accounting/modules/invoices/components/settings/ruleActionBehavior";
import type { RuleLabelMaps } from "@/modules/accounting/modules/invoices/components/settings/ruleLabels";
import { isBetweenOperator, isNullaryOperator } from "@/modules/accounting/modules/invoices/lib/rules/helpers";

export type RuleBuilderPlacement = "top" | "bottom";

export interface RuleBuilderDraft {
  name: string; isActive: boolean; stopOnMatch: boolean; applyExisting: boolean;
  applyScope: RuleApplyPayload["scope"];
  placement: RuleBuilderPlacement;
  criteria: RuleCriterion[];
  actions: RuleAction[];
}

export interface RuleBuilderValidation {
  isValid: boolean;
  errors: string[];
}

export interface InvoiceContextField {
  field: RuleCriteriaField; label: string; value: string; display: string; defaultOn: boolean;
}

const DEFAULT_CONTEXT_FIELDS: RuleCriteriaField[] = ["vendor_name", "classification"];

const INVOICE_CONTEXT_FIELDS: RuleCriteriaField[] = [
  "vendor_name", "vendor_code", "job_number", "classification", "amount",
  "invoice_number", "description", "status", "email_from", "email_subject",
];

export function createBlankRuleBuilderDraft(rules: Rule[] = []): RuleBuilderDraft {
  return {
    name: "New invoice automation rule",
    isActive: true,
    stopOnMatch: true,
    applyExisting: true,
    applyScope: "pending",
    placement: rules.length > 0 ? "bottom" : "top",
    criteria: [{ field: "vendor_name", operator: "contains", values: [""] }],
    actions: [{ type: "hide_from_queue" }],
  };
}

export function createInvoiceRuleBuilderDraft(invoice: Invoice): RuleBuilderDraft {
  const criteria = DEFAULT_CONTEXT_FIELDS
    .map((field) => createCriterionFromInvoiceField(invoice, field))
    .filter((criterion): criterion is RuleCriterion => criterion !== null);

  return {
    name: createInvoiceRuleName(invoice),
    isActive: true,
    stopOnMatch: true,
    applyExisting: true,
    applyScope: "pending",
    placement: "bottom",
    criteria: criteria.length > 0 ? criteria : [{ field: "status", operator: "equals", values: [invoice.status] }],
    actions: createInvoiceActions(invoice),
  };
}

export function buildInvoiceContextFields(invoice: Invoice, labels: RuleLabelMaps): InvoiceContextField[] {
  return INVOICE_CONTEXT_FIELDS
    .map((field) => {
      const value = getInvoiceFieldValue(invoice, field);
      if (value === null) return null;
      return {
        field,
        label: labels.fields[field] ?? field,
        value: String(value),
        display: formatContextValue(field, value),
        defaultOn: DEFAULT_CONTEXT_FIELDS.includes(field),
      };
    })
    .filter((field): field is InvoiceContextField => field !== null);
}

export function createCriterionFromInvoiceField(
  invoice: Invoice,
  field: RuleCriteriaField,
): RuleCriterion | null {
  const value = getInvoiceFieldValue(invoice, field);
  if (value === null) return null;
  return { field, operator: defaultOperatorForField(field), values: [String(value)] };
}

export function validateRuleBuilderDraft(draft: RuleBuilderDraft, labels: RuleLabelMaps): RuleBuilderValidation {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("Rule name is required.");
  if (draft.criteria.length === 0) errors.push("Add at least one criterion.");
  if (draft.actions.length === 0) errors.push("Add at least one action.");

  draft.criteria.forEach((criterion) => {
    if (isNullaryOperator(criterion.operator)) return;
    const fieldLabel = labels.fields[criterion.field] ?? criterion.field;
    if (isBetweenOperator(criterion.operator)) {
      if (!criterion.values[0]?.trim() || !criterion.values[1]?.trim()) {
        errors.push(`${fieldLabel} needs a minimum and maximum value.`);
      }
      return;
    }
    if (!criterion.values.some((value) => value.trim().length > 0)) {
      errors.push(`${fieldLabel} needs a value.`);
    }
  });

  draft.actions.forEach((action) => {
    if (action.clear) {
      if (!CLEARABLE_ACTIONS.has(action.type)) {
        errors.push("The selected action cannot clear its value.");
      }
      return;
    }
    if (!VALUELESS_ACTIONS.has(action.type) && !action.value?.trim()) {
      errors.push("Every selected action needs its required value.");
    }
  });

  return { isValid: errors.length === 0, errors };
}

export function toRuleCreatePayload(draft: RuleBuilderDraft, rules: Rule[]): RuleCreatePayload {
  const order = draft.placement === "top" ? 0 : rules.length > 0 ? nextRuleOrder(rules) : undefined;
  return {
    name: draft.name.trim(),
    isActive: draft.isActive,
    stopOnMatch: draft.stopOnMatch,
    ...(order === undefined ? {} : { order }),
    criteria: draft.criteria,
    actions: draft.actions,
  };
}

function createInvoiceRuleName(invoice: Invoice): string {
  const vendor = invoice.extracted?.vendorName ?? invoice.matching?.vendor?.vendorName ?? "Invoice";
  return `${vendor} rule`;
}

function createInvoiceActions(invoice: Invoice): RuleAction[] {
  const actions: RuleAction[] = [];
  const vendorCode = invoice.matching?.vendor?.vendorCode;
  const jobNumber = invoice.extracted?.jobNumber ?? invoice.matching?.job?.jobNumber;
  if (vendorCode) actions.push({ type: "set_vendor", value: vendorCode });
  if (jobNumber) actions.push({ type: "set_job", value: jobNumber });
  actions.push({ type: "set_classification", value: invoice.classification });
  return actions;
}

function defaultOperatorForField(field: RuleCriteriaField): RuleCriteriaOperator {
  if (field === "amount") return "equals";
  if (field === "classification" || field === "status") return "equals";
  if (field === "email_subject" || field === "description") return "contains";
  return "equals";
}

function nextRuleOrder(rules: Rule[]): number {
  if (rules.length === 0) return 0;
  return Math.max(...rules.map((rule) => rule.order)) + 1;
}

function getInvoiceFieldValue(invoice: Invoice, field: RuleCriteriaField): string | number | null {
  switch (field) {
    case "vendor_name":
      return invoice.extracted?.vendorName ?? invoice.matching?.vendor?.vendorName ?? null;
    case "vendor_code":
      return invoice.matching?.vendor?.vendorCode ?? null;
    case "amount":
      return invoice.extracted?.amount ?? null;
    case "description":
      return invoice.extracted?.description ?? null;
    case "invoice_number":
      return invoice.extracted?.invoiceNumber ?? null;
    case "job_number":
      return invoice.extracted?.jobNumber ?? invoice.matching?.job?.jobNumber ?? null;
    case "classification":
      return invoice.classification;
    case "status":
      return invoice.status;
    case "email_from":
      return invoice.email.from;
    case "email_subject":
      return invoice.email.subject;
    default:
      return null;
  }
}

function formatContextValue(field: RuleCriteriaField, value: string | number): string {
  if (field === "amount" && typeof value === "number") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
  }
  return String(value);
}
