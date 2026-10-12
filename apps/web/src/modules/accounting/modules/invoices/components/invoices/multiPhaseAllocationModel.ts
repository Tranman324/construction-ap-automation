/**
 * multiPhaseAllocationModel.ts
 *
 * Pure, presentation-only math for the Multi-Phase Allocation Panel.
 *
 * WHY THIS EXISTS: Spectrum stores subcontract change orders (COs) as EXTRA
 * phase lines whose `original_amount` is 0 — the CO's contract value lives ONLY
 * in the subcontract header's revised contract (`header.revContract`). A naive
 * per-phase remaining of `original_amount − amount_billed` therefore understates
 * (or goes negative on) any phase that carries CO billing, which made the panel
 * warn users away from correct allocations (repro doc-1784556034576-2vqi:
 * phase 09100 showed $674 remaining when the true remaining is $3,924).
 *
 * This module recovers the CO contract value from the header and attributes it
 * back to the phase(s) that carry it, so the per-phase "Remaining" reconciles to
 * the subcontract's Unbilled. It is DISPLAY math only — it never participates in
 * the save payload, the balanced/sum-to-total rule, or the approve gate (those
 * stay backend-authoritative and unchanged).
 */

import type { PhaseOption, PhaseRow, SubcontractHeader } from "@/modules/accounting/modules/invoices/types/api";

/** Sub-cent tolerance for money comparisons (values arrive rounded to cents). */
export const ALLOCATION_CENT_TOLERANCE = 0.005;

function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** A CO detail line: contract value 0 but carrying billing (Spectrum's CO shape). */
function isChangeOrderRow(row: PhaseRow): boolean {
  return row.original_amount === 0 && row.amount_billed > ALLOCATION_CENT_TOLERANCE;
}

export interface PhaseComputation {
  phaseCode: string;
  costType: string;
  description: string;
  rows: PhaseRow[];
  /** Naive contract (Σ original_amount incl CO lines, which are 0) + attributed CO value. */
  phaseContract: number;
  /** Σ amount_billed across all lines incl CO. */
  phaseBilled: number;
  /** CO-corrected remaining: phaseContract − phaseBilled. */
  phaseRemaining: number;
  /** CO contract value attributed to this phase (0 when none / unattributable). */
  coAdjustment: number;
  /** True when this phase received CO contract value (drives the footnote). */
  isCoAffected: boolean;
  /** True when the CO-corrected remaining is ≈ $0 (fully billed → done style, disabled input). */
  isFullyBilled: boolean;
}

export interface PhaseAllocationModel {
  /** Phases in first-occurrence order of `phaseRows`. */
  phases: PhaseComputation[];
  /** Σ of CO-corrected phaseRemaining. When attributable this equals header.unbilled. */
  totalRemaining: number;
  /** Header revised contract disagrees with the summed phase originals (COs exist). */
  hasChangeOrders: boolean;
  /**
   * COs exist (totals disagree) but no phase carries a detectable CO line to
   * attribute them to — fall back to naive per-phase numbers and rely on the
   * subcontract-level Unbilled. Drives the "doesn't reconcile" footnote.
   */
  coUnattributable: boolean;
}

/**
 * Compute CO-corrected per-phase contract / billed / remaining.
 *
 * Attribution of the header's undistributed CO contract value
 * (`coTotal = header.revContract − Σ naive phase originals`):
 *   (a) exactly ONE phase has CO lines → all of coTotal to that phase;
 *   (b) multiple phases have CO lines → split proportional to each phase's CO billed;
 *   (c) totals disagree but NO phase has CO lines → unattributable: keep naive
 *       numbers + footnote, rely on the subcontract-level Unbilled.
 *
 * INVARIANT (a & b): Σ phaseRemaining === header.unbilled, because
 *   Σ (naiveOriginal + coAdj − billed) = ΣnaiveOriginal + coTotal − Σbilled
 *   = revContract − totalBilled = header.unbilled.
 */
export function computePhaseAllocationModel(
  phases: PhaseOption[],
  phaseRows: PhaseRow[],
  header: Pick<SubcontractHeader, "revContract" | "totalBilled" | "unbilled">,
): PhaseAllocationModel {
  // Group rows by phase_code, preserving first-occurrence order.
  const order: string[] = [];
  const rowsByPhase = new Map<string, PhaseRow[]>();
  for (const row of phaseRows) {
    const bucket = rowsByPhase.get(row.phase_code);
    if (bucket) {
      bucket.push(row);
    } else {
      rowsByPhase.set(row.phase_code, [row]);
      order.push(row.phase_code);
    }
  }

  const aggByPhase = new Map(phases.map((p) => [p.phase_code, p] as const));

  interface Naive {
    contract: number;
    billed: number;
    coBilled: number;
    costType: string;
    description: string;
    rows: PhaseRow[];
  }
  const naive = new Map<string, Naive>();
  let sumNaiveOriginal = 0;

  for (const code of order) {
    const rows = rowsByPhase.get(code) ?? [];
    const agg = aggByPhase.get(code);
    // Prefer the backend aggregate; fall back to summing rows if absent.
    const contract = agg?.original_amount ?? rows.reduce((s, r) => s + r.original_amount, 0);
    const billed = agg?.amount_billed ?? rows.reduce((s, r) => s + r.amount_billed, 0);
    const coBilled = rows.reduce((s, r) => (isChangeOrderRow(r) ? s + r.amount_billed : s), 0);
    naive.set(code, {
      contract,
      billed,
      coBilled,
      costType: agg?.cost_type ?? rows[0]?.cost_type ?? "",
      description: agg?.description ?? rows[0]?.description ?? "",
      rows,
    });
    sumNaiveOriginal += contract;
  }

  const coTotal = header.revContract - sumNaiveOriginal;
  const hasChangeOrders = Math.abs(coTotal) > ALLOCATION_CENT_TOLERANCE;

  const coPhases = order.filter((code) => (naive.get(code)?.coBilled ?? 0) > ALLOCATION_CENT_TOLERANCE);
  const totalCoBilled = coPhases.reduce((s, code) => s + (naive.get(code)?.coBilled ?? 0), 0);

  const coAdjByPhase = new Map<string, number>(order.map((code) => [code, 0]));
  let coUnattributable = false;

  if (hasChangeOrders) {
    if (coPhases.length === 1) {
      // (a) single CO phase absorbs the entire undistributed CO value.
      coAdjByPhase.set(coPhases[0], roundCents(coTotal));
    } else if (coPhases.length > 1 && totalCoBilled > ALLOCATION_CENT_TOLERANCE) {
      // (b) proportional to CO billed; last CO phase absorbs rounding residue
      // so the attributed shares always sum to coTotal exactly.
      let distributed = 0;
      coPhases.forEach((code, i) => {
        if (i === coPhases.length - 1) {
          coAdjByPhase.set(code, roundCents(coTotal - distributed));
        } else {
          const share = roundCents(coTotal * ((naive.get(code)?.coBilled ?? 0) / totalCoBilled));
          coAdjByPhase.set(code, share);
          distributed = roundCents(distributed + share);
        }
      });
    } else {
      // (c) totals disagree but nothing to attribute to.
      coUnattributable = true;
    }
  }

  const computed: PhaseComputation[] = order.map((code) => {
    const n = naive.get(code) as Naive;
    const coAdjustment = coAdjByPhase.get(code) ?? 0;
    const phaseContract = roundCents(n.contract + coAdjustment);
    const phaseBilled = roundCents(n.billed);
    const phaseRemaining = roundCents(phaseContract - phaseBilled);
    return {
      phaseCode: code,
      costType: n.costType,
      description: n.description,
      rows: n.rows,
      phaseContract,
      phaseBilled,
      phaseRemaining,
      coAdjustment,
      isCoAffected: coAdjustment > ALLOCATION_CENT_TOLERANCE,
      isFullyBilled: phaseRemaining <= ALLOCATION_CENT_TOLERANCE,
    };
  });

  const totalRemaining = roundCents(computed.reduce((s, p) => s + p.phaseRemaining, 0));

  return { phases: computed, totalRemaining, hasChangeOrders, coUnattributable };
}

/**
 * "Fill from remaining" pre-fill: distribute the invoice total across phases,
 * largest-remaining-first, capped at each phase's CO-corrected remaining, with
 * any rounding residue folded into the last phase that received an allocation.
 *
 * Returns a `{ phase_code → "amount.toFixed(2)" }` map containing ONLY the
 * phases that receive a positive amount (callers clear the rest), or `null` when
 * the invoice cannot fit within the total remaining (button is then unavailable).
 * NEVER auto-saves — the caller seeds the inputs and the user can still edit.
 */
export function fillFromRemaining(
  model: PhaseAllocationModel,
  invoiceTotal: number,
): Record<string, string> | null {
  if (!(invoiceTotal > 0)) return null;
  if (invoiceTotal > model.totalRemaining + ALLOCATION_CENT_TOLERANCE) return null;

  // Work in integer cents to avoid float drift.
  let leftover = Math.round(invoiceTotal * 100);

  const sorted = model.phases
    .map((p, index) => ({ p, index }))
    .sort((a, b) => (b.p.phaseRemaining - a.p.phaseRemaining) || (a.index - b.index));

  const cents: Record<string, number> = {};
  const assigned: string[] = [];
  for (const { p } of sorted) {
    if (leftover <= 0) break;
    const cap = Math.max(0, Math.round(p.phaseRemaining * 100));
    const take = Math.min(cap, leftover);
    if (take > 0) {
      cents[p.phaseCode] = take;
      assigned.push(p.phaseCode);
      leftover -= take;
    }
  }

  // Residue (from cent rounding when filling to the brim) → last assigned phase.
  if (leftover > 0 && assigned.length > 0) {
    const last = assigned[assigned.length - 1];
    cents[last] += leftover;
    leftover = 0;
  }

  if (assigned.length === 0) return null;

  const out: Record<string, string> = {};
  for (const [code, value] of Object.entries(cents)) {
    out[code] = (value / 100).toFixed(2);
  }
  return out;
}
