import { describe, expect, it } from "vitest";

import type { PhaseOption, PhaseRow } from "@/modules/accounting/modules/invoices/types/api";
import {
  computePhaseAllocationModel,
  fillFromRemaining,
} from "@/modules/accounting/modules/invoices/components/invoices/multiPhaseAllocationModel";

// ── Fixture helpers ──────────────────────────────────────────────────────────

function row(
  row_index: number,
  phase_code: string,
  original_amount: number,
  amount_billed: number,
  extra: Partial<PhaseRow> = {},
): PhaseRow {
  return {
    row_index,
    phase_code,
    cost_type: "L",
    description: `${phase_code} line ${row_index}`,
    original_amount,
    amount_billed,
    remaining_amount: original_amount - amount_billed,
    ...extra,
  };
}

function agg(
  phase_code: string,
  original_amount: number,
  amount_billed: number,
): PhaseOption {
  return {
    phase_code,
    cost_type: "L",
    description: phase_code,
    original_amount,
    amount_billed,
    remaining_amount: original_amount - amount_billed,
  };
}

function byCode(model: ReturnType<typeof computePhaseAllocationModel>, code: string) {
  const found = model.phases.find((p) => p.phaseCode === code);
  if (!found) throw new Error(`phase ${code} not in model`);
  return found;
}

// ── Scenario matrix (acceptance) ─────────────────────────────────────────────

describe("computePhaseAllocationModel", () => {
  // ── Scenario 1 — no-CO normal split (identical to naive, reconciles) ────────
  it("scenario 1: no change orders → naive per-phase remaining, reconciles to unbilled", () => {
    const phases = [agg("09100", 20000, 15000), agg("09500", 15000, 8000)];
    const rows = [row(0, "09100", 20000, 15000), row(1, "09500", 15000, 8000)];
    const header = { revContract: 35000, totalBilled: 23000, unbilled: 12000 };

    const model = computePhaseAllocationModel(phases, rows, header);

    expect(model.hasChangeOrders).toBe(false);
    expect(model.coUnattributable).toBe(false);
    expect(byCode(model, "09100").phaseRemaining).toBe(5000);
    expect(byCode(model, "09100").isCoAffected).toBe(false);
    expect(byCode(model, "09500").phaseRemaining).toBe(7000);
    expect(model.totalRemaining).toBe(12000);
    expect(model.totalRemaining).toBe(header.unbilled);
  });

  // ── Scenario 2 — 2vqi/26-430.01 EXACT numbers (load-bearing) ────────────────
  it("scenario 2 (2vqi): phase 09100 remaining is $3,924 not $674; 09510 is $0/done", () => {
    // Invoice $3,924.00, subcontract 26-430.01. 09100 carries a $3,250 CO billed
    // on a 0-contract line; the CO's contract value is only in header.revContract.
    const phases = [agg("09100", 9936, 9262), agg("09510", 5000, 5000)];
    const rows = [
      row(0, "09100", 9936, 6012, { description: "Concrete" }),
      row(1, "09100", 0, 3250, { description: "Concrete CO #1" }), // CO line: original 0, billed 3250
      row(2, "09510", 5000, 5000, { description: "Rebar" }),
    ];
    const header = { revContract: 18186, totalBilled: 14262, unbilled: 3924 };

    const model = computePhaseAllocationModel(phases, rows, header);

    const p09100 = byCode(model, "09100");
    expect(p09100.phaseContract).toBe(13186); // 9936 naive + 3250 CO
    expect(p09100.phaseBilled).toBe(9262);
    expect(p09100.phaseRemaining).toBe(3924); // NOT the naive 674
    expect(p09100.phaseRemaining).not.toBe(674);
    expect(p09100.coAdjustment).toBe(3250);
    expect(p09100.isCoAffected).toBe(true);
    expect(p09100.isFullyBilled).toBe(false);

    const p09510 = byCode(model, "09510");
    expect(p09510.phaseRemaining).toBe(0);
    expect(p09510.isFullyBilled).toBe(true);
    expect(p09510.isCoAffected).toBe(false);

    expect(model.hasChangeOrders).toBe(true);
    expect(model.coUnattributable).toBe(false);
    // Reconciliation invariant: per-phase remainings sum to the subcontract unbilled.
    expect(model.totalRemaining).toBe(3924);
    expect(model.totalRemaining).toBe(header.unbilled);
  });

  // ── Scenario 7 — multiple CO phases → proportional split, reconciles ────────
  it("scenario 7: multiple CO phases split coTotal proportional to CO billed, reconcile to unbilled", () => {
    const phases = [agg("09100", 10000, 6000), agg("09200", 8000, 9000)];
    const rows = [
      row(0, "09100", 10000, 4000),
      row(1, "09100", 0, 2000), // CO billed 2000
      row(2, "09200", 8000, 3000),
      row(3, "09200", 0, 6000), // CO billed 6000
    ];
    // Naive originals 18000; revContract 22000 → coTotal 4000. Split 2000:6000 → 1000:3000.
    const header = { revContract: 22000, totalBilled: 15000, unbilled: 7000 };

    const model = computePhaseAllocationModel(phases, rows, header);

    expect(byCode(model, "09100").coAdjustment).toBe(1000);
    expect(byCode(model, "09100").phaseRemaining).toBe(5000); // 11000 - 6000
    expect(byCode(model, "09200").coAdjustment).toBe(3000);
    // Naive 09200 remaining would be NEGATIVE (8000 - 9000 = -1000); corrected is +2000.
    expect(byCode(model, "09200").phaseRemaining).toBe(2000);
    expect(model.coUnattributable).toBe(false);
    expect(model.totalRemaining).toBe(7000);
    expect(model.totalRemaining).toBe(header.unbilled);
  });

  // ── Scenario 8 — unattributable discrepancy → naive + footnote flag ─────────
  it("scenario 8: totals disagree but no CO lines → unattributable, naive numbers kept", () => {
    const phases = [agg("09100", 20000, 15000), agg("09500", 15000, 8000)];
    const rows = [row(0, "09100", 20000, 15000), row(1, "09500", 15000, 8000)];
    // revContract 50000 but naive originals sum to 35000 (disagree by 15000) with NO CO lines.
    const header = { revContract: 50000, totalBilled: 23000, unbilled: 27000 };

    const model = computePhaseAllocationModel(phases, rows, header);

    expect(model.hasChangeOrders).toBe(true);
    expect(model.coUnattributable).toBe(true);
    expect(byCode(model, "09100").coAdjustment).toBe(0);
    expect(byCode(model, "09100").phaseRemaining).toBe(5000); // naive kept
    expect(byCode(model, "09500").phaseRemaining).toBe(7000);
    // Per-phase does NOT reconcile to unbilled here → panel relies on subcontract tier.
    expect(model.totalRemaining).toBe(12000);
    expect(model.totalRemaining).not.toBe(header.unbilled);
  });

  it("clamps nothing but exposes rows so the panel can fold CO detail lines (no negative phase remaining)", () => {
    const phases = [agg("09200", 8000, 9000)];
    const rows = [row(0, "09200", 8000, 3000), row(1, "09200", 0, 6000)];
    const header = { revContract: 12000, totalBilled: 9000, unbilled: 3000 };

    const model = computePhaseAllocationModel(phases, rows, header);
    // Single CO phase absorbs coTotal 4000 → contract 12000, remaining 3000 (not -1000).
    expect(byCode(model, "09200").phaseRemaining).toBe(3000);
    expect(byCode(model, "09200").phaseRemaining).toBeGreaterThan(0);
  });
});

// ── Fill from remaining ──────────────────────────────────────────────────────

describe("fillFromRemaining", () => {
  const twoVqi = computePhaseAllocationModel(
    [agg("09100", 9936, 9262), agg("09510", 5000, 5000)],
    [row(0, "09100", 9936, 6012), row(1, "09100", 0, 3250), row(2, "09510", 5000, 5000)],
    { revContract: 18186, totalBilled: 14262, unbilled: 3924 },
  );

  it("2vqi: fills the whole invoice into 09100 (the only phase with remaining)", () => {
    const filled = fillFromRemaining(twoVqi, 3924);
    expect(filled).toEqual({ "09100": "3924.00" });
    expect(filled?.["09510"]).toBeUndefined();
  });

  it("distributes largest-remaining-first, capped per phase", () => {
    const model = computePhaseAllocationModel(
      [agg("09100", 10000, 6000), agg("09200", 8000, 9000)],
      [row(0, "09100", 10000, 4000), row(1, "09100", 0, 2000), row(2, "09200", 8000, 3000), row(3, "09200", 0, 6000)],
      { revContract: 22000, totalBilled: 15000, unbilled: 7000 },
    );
    // remaining 09100=5000, 09200=2000; invoice 6000 → 5000 to 09100 (cap), 1000 to 09200.
    const filled = fillFromRemaining(model, 6000);
    expect(filled).toEqual({ "09100": "5000.00", "09200": "1000.00" });
  });

  it("filling to the brim sums exactly to the invoice total", () => {
    const model = computePhaseAllocationModel(
      [agg("09100", 10000, 6000), agg("09200", 8000, 9000)],
      [row(0, "09100", 10000, 4000), row(1, "09100", 0, 2000), row(2, "09200", 8000, 3000), row(3, "09200", 0, 6000)],
      { revContract: 22000, totalBilled: 15000, unbilled: 7000 },
    );
    const filled = fillFromRemaining(model, 7000);
    const sum = Object.values(filled ?? {}).reduce((s, v) => s + parseFloat(v), 0);
    expect(sum).toBeCloseTo(7000, 2);
  });

  it("returns null when the invoice exceeds the total remaining", () => {
    const model = computePhaseAllocationModel(
      [agg("09100", 20000, 15000), agg("09500", 15000, 8000)],
      [row(0, "09100", 20000, 15000), row(1, "09500", 15000, 8000)],
      { revContract: 35000, totalBilled: 23000, unbilled: 12000 },
    );
    expect(fillFromRemaining(model, 13000)).toBeNull();
  });

  it("returns null for a non-positive invoice total", () => {
    expect(fillFromRemaining(twoVqi, 0)).toBeNull();
  });
});
