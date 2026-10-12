import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type {
  RuleCriterion,
  RuleCriteriaField,
  RuleCriteriaOperator,
} from "@/modules/accounting/modules/invoices/types/rules";

// ─── Field resolution ─────────────────────────────────────────────────────────

export function resolveField(
  invoice: Invoice,
  field: RuleCriteriaField
): string | number | null {
  switch (field) {
    case "vendor_name":
      return invoice.extracted?.vendorName ?? null;
    case "vendor_code":
      return invoice.matching?.vendor?.vendorCode ?? null;
    case "amount":
      return invoice.extracted?.amount ?? null;
    case "description":
      return invoice.extracted?.description ?? null;
    case "invoice_number":
      return invoice.extracted?.invoiceNumber ?? null;
    case "job_number":
      return (
        invoice.extracted?.jobNumber ??
        invoice.matching?.job?.jobNumber ??
        null
      );
    case "classification":
      return invoice.classification;
    case "status":
      return invoice.status;
    case "email_from":
      return invoice.email?.from ?? null;
    case "email_subject":
      return invoice.email?.subject ?? null;
    default:
      return null;
  }
}

// ─── Operator evaluation ──────────────────────────────────────────────────────

function matchesOperator(
  fieldValue: string | number | null,
  operator: RuleCriteriaOperator,
  criterionValues: string[]
): boolean {
  if (operator === "is_empty") {
    return fieldValue === null || fieldValue === "" || fieldValue === undefined;
  }
  if (operator === "is_not_empty") {
    return fieldValue !== null && fieldValue !== "" && fieldValue !== undefined;
  }
  if (fieldValue === null || fieldValue === undefined) return false;

  // between: special two-value numeric operator
  if (operator === "between") {
    const num =
      typeof fieldValue === "number" ? fieldValue : parseFloat(String(fieldValue));
    if (isNaN(num) || criterionValues.length < 2) return false;
    const min = parseFloat(criterionValues[0]);
    const max = parseFloat(criterionValues[1]);
    if (isNaN(min) || isNaN(max)) return false;
    return num >= min && num <= max;
  }

  // numeric operators — any matching value is sufficient
  if (operator === "gt" || operator === "lt" || operator === "gte" || operator === "lte") {
    const num =
      typeof fieldValue === "number" ? fieldValue : parseFloat(String(fieldValue));
    if (isNaN(num)) return false;
    return criterionValues.some((v) => {
      const cmp = parseFloat(v);
      if (isNaN(cmp)) return false;
      switch (operator) {
        case "gt":  return num > cmp;
        case "lt":  return num < cmp;
        case "gte": return num >= cmp;
        case "lte": return num <= cmp;
        default: return false;
      }
    });
  }

  // string operators — OR across criterionValues
  // Positive operators (contains, equals, starts_with, ends_with) use .some() — match if ANY value hits.
  // Negative operators (not_contains, not_equals) use .every() — match only if ALL values miss.
  const strVal = String(fieldValue).toLowerCase().trim();

  if (operator === "not_contains") {
    return criterionValues.every((v) => {
      const cmpVal = v.toLowerCase().trim();
      return !cmpVal || !strVal.includes(cmpVal);
    });
  }
  if (operator === "not_equals") {
    return criterionValues.every((v) => {
      const cmpVal = v.toLowerCase().trim();
      return !cmpVal || strVal !== cmpVal;
    });
  }

  return criterionValues.some((v) => {
    const cmpVal = v.toLowerCase().trim();
    if (!cmpVal) return false;
    switch (operator) {
      case "contains":     return strVal.includes(cmpVal);
      case "equals":       return strVal === cmpVal;
      case "starts_with":  return strVal.startsWith(cmpVal);
      case "ends_with":    return strVal.endsWith(cmpVal);
      default: return false;
    }
  });
}

// ─── Criterion + rule matching ────────────────────────────────────────────────

export function matchesCriterion(
  invoice: Invoice,
  criterion: RuleCriterion
): boolean {
  const fieldValue = resolveField(invoice, criterion.field);
  return matchesOperator(fieldValue, criterion.operator, criterion.values);
}

/** All criteria must match (AND logic between rows). */
export function matchesAllCriteria(
  invoice: Invoice,
  criteria: RuleCriterion[]
): boolean {
  if (criteria.length === 0) return false;
  return criteria.every((c) => matchesCriterion(invoice, c));
}

// ─── Field/operator metadata helpers (used by the UI) ────────────────────────

/** Fields whose values are numbers — show numeric operator options. */
export const NUMERIC_FIELDS = new Set<RuleCriteriaField>(["amount"]);

/** Fields whose values are bounded enums — show only equals/not_equals. */
export const ENUM_FIELDS = new Set<RuleCriteriaField>([
  "classification",
  "status",
]);

export function operatorsForField(
  field: RuleCriteriaField
): RuleCriteriaOperator[] {
  if (NUMERIC_FIELDS.has(field)) {
    return ["equals", "not_equals", "gt", "lt", "gte", "lte", "between", "is_empty", "is_not_empty"];
  }
  if (ENUM_FIELDS.has(field)) {
    return ["equals", "not_equals", "is_empty", "is_not_empty"];
  }
  return ["contains", "not_contains", "equals", "not_equals", "starts_with", "ends_with", "is_empty", "is_not_empty"];
}

/** Whether this operator requires no value inputs. */
export function isNullaryOperator(op: RuleCriteriaOperator): boolean {
  return op === "is_empty" || op === "is_not_empty";
}

/** Whether this operator requires exactly two value inputs. */
export function isBetweenOperator(op: RuleCriteriaOperator): boolean {
  return op === "between";
}
