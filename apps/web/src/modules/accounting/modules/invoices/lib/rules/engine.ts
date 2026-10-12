import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { Rule } from "@/modules/accounting/modules/invoices/types/rules";
import { matchesAllCriteria } from "./helpers";

// ─── Result type ──────────────────────────────────────────────────────────────

export interface ApplyRulesResult {
  /**
   * Invoices that should be visible after applying client-side rules.
   * Invoices matched by a `hide_from_queue` action — or with `hidden: true`
   * from the API — are excluded.
   */
  visibleInvoices: Invoice[];
}

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * Pure client-side rule engine. Evaluates all active rules against the
 * provided invoice list and returns those that should remain visible.
 *
 * Scope of client-side evaluation (v1):
 *   - `hide_from_queue` → filter invoice out of the visible list entirely
 *   - `hidden` field from the API → also filtered out
 *
 * All persistent actions (auto_approve, auto_discard, auto_file, set_vendor,
 * set_job, set_classification, assign_reviewer, add_note, flag) are applied
 * server-side via POST /api/rules/apply. The frontend renders those results
 * from the API response fields (flagged, notes, assignedTo, status, etc.).
 */
export function applyRules(
  invoices: Invoice[],
  rules: Rule[]
): ApplyRulesResult {
  const activeRules = [...rules]
    .filter((r) => r.isActive)
    .sort((a, b) => a.order - b.order);

  // Fast path — no active rules
  if (activeRules.length === 0) {
    // Still respect backend-persisted `hidden` field
    const visibleInvoices = invoices.filter(
      (inv) => !(inv as Invoice & { hidden?: boolean }).hidden
    );
    return { visibleInvoices };
  }

  const visibleInvoices: Invoice[] = [];

  for (const invoice of invoices) {
    // Respect backend-persisted hidden flag
    if ((invoice as Invoice & { hidden?: boolean }).hidden) continue;

    let hideThisInvoice = false;

    for (const rule of activeRules) {
      if (!matchesAllCriteria(invoice, rule.criteria)) continue;

      // If any action on this matching rule is hide_from_queue → exclude
      if (rule.actions.some((a) => a.type === "hide_from_queue")) {
        hideThisInvoice = true;
      }

      if (rule.stopOnMatch) break;
    }

    if (!hideThisInvoice) {
      visibleInvoices.push(invoice);
    }
  }

  return { visibleInvoices };
}
