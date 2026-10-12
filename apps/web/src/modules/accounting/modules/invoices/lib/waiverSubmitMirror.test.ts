import { describe, expect, it } from "vitest";

import { isWaiverGateBlocked, type WaiverGateCandidate } from "@/modules/accounting/modules/invoices/lib/waiverGate";
import { deriveSpectrumSubmitPrechecks } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitPrecheckModel";
import type { SpectrumSubmitCandidate } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";

/**
 * WAIVER SUBMIT MIRROR (Task 4.3) — a bidirectional, exact-correspondence tripwire.
 *
 * The frontend submit precheck stays client-side for UX speed; this test PINS it
 * to the backend's authoritative submit gate so a divergence fails here rather
 * than shipping. The load-bearing submit blocker is the lien-waiver gate — the
 * one condition the frontend hard-blocks on (`blockingWaiverCount`) and the
 * money-path submit rejection the backend `validateApprovalEligibility` gate
 * produces (see `apps/api/tests/invoices/waiver-gate.static.test.js` +
 * `approval-state.test.js`). Correspondence is asserted as EXACT boolean/count
 * equality — never a loose substring match that could let a backend blocker with
 * no frontend counterpart slip through.
 */

// ── Backend submit-blocker reference (documented gate condition) ───────────────
// The backend rejects a submit for lien-waiver iff the document requires a lien
// waiver, has no linked waiver, no pipeline-detected embedded waiver, and no
// manual waiver-on-document override.
function backendLienWaiverBlocked(c: WaiverGateCandidate): boolean {
  return c.lienWaiverRequired === true
    && !(c.linkedLienWaiverId && c.linkedLienWaiverId.trim())
    && c.lienWaiverStatus !== 'attached'
    && c.waiverOnDocument !== true;
}

// Every combination of the four inputs the gate reads.
const BOOLS = [true, false];
const NULLABLE_ID = [null, "", "  ", "lw-1"];
const WAIVER_STATUSES: WaiverGateCandidate["lienWaiverStatus"][] = [null, "missing", "attached"];
function allWaiverCandidates(): WaiverGateCandidate[] {
  const out: WaiverGateCandidate[] = [];
  for (const lienWaiverRequired of BOOLS) {
    for (const linkedLienWaiverId of NULLABLE_ID) {
      for (const lienWaiverStatus of WAIVER_STATUSES) {
        for (const waiverOnDocument of BOOLS) {
          out.push({ lienWaiverRequired, linkedLienWaiverId, lienWaiverStatus, waiverOnDocument });
        }
      }
    }
  }
  return out;
}

function makeCandidate(over: Partial<SpectrumSubmitCandidate> = {}): SpectrumSubmitCandidate {
  return {
    id: "doc-1",
    jobNumber: "24-001",
    vendorName: "Vendor",
    amount: 100,
    lienWaiverRequired: false,
    linkedLienWaiverId: null,
    lienWaiverStatus: null,
    waiverOnDocument: false,
    ...over,
  } as SpectrumSubmitCandidate;
}

describe("waiver submit mirror (bidirectional, exact-correspondence)", () => {
  it("frontend waiver gate reproduces the backend blocker for EVERY input combination (both directions)", () => {
    for (const c of allWaiverCandidates()) {
      const fe = isWaiverGateBlocked(c);
      const be = backendLienWaiverBlocked(c);
      // Exact boolean equality — the frontend blocks iff the backend blocks.
      // (a) no backend blocker without a frontend counterpart, and
      // (b) no frontend block without a backend counterpart.
      expect(fe, `waiver gate must equal backend for ${JSON.stringify(c)}`).toBe(be);
    }
  });

  it("blockingWaiverCount equals the number of backend-blocked candidates (exact count, not substring)", () => {
    const candidates = [
      makeCandidate({ id: "a", lienWaiverRequired: true, linkedLienWaiverId: null, waiverOnDocument: false }), // blocked
      makeCandidate({ id: "b", lienWaiverRequired: true, linkedLienWaiverId: "lw-9", waiverOnDocument: false }), // linked → not blocked
      makeCandidate({ id: "c", lienWaiverRequired: true, linkedLienWaiverId: null, waiverOnDocument: true }), // override → not blocked
      makeCandidate({ id: "d", lienWaiverRequired: false, linkedLienWaiverId: null, waiverOnDocument: false }), // not required
      makeCandidate({ id: "e", lienWaiverRequired: true, linkedLienWaiverId: null, lienWaiverStatus: "attached", waiverOnDocument: false }), // pipeline-detected → not blocked
    ];
    const backendBlockedCount = candidates.filter(backendLienWaiverBlocked).length;
    const summary = deriveSpectrumSubmitPrechecks(candidates);
    expect(summary.blockingWaiverCount).toBe(backendBlockedCount);
    expect(summary.blockingWaiverCount).toBe(1); // only candidate "a"
    // The precheck also surfaces a "missing-waiver" warning for exactly the blocked set.
    const missingWaiver = summary.warnings.find((w) => w.code === "missing-waiver");
    expect(missingWaiver?.count).toBe(backendBlockedCount);
  });

  it("advisory warnings (missing job/vendor/amount) are NON-blocking — not the money-path submit gate", () => {
    // A candidate that trips every advisory warning but is NOT waiver-blocked must
    // NOT contribute to blockingWaiverCount — the frontend does not invent a hard
    // submit blocker the backend gate lacks.
    const advisoryOnly = makeCandidate({
      jobNumber: "", vendorName: "", amount: null,
      lienWaiverRequired: false,
    });
    const summary = deriveSpectrumSubmitPrechecks([advisoryOnly]);
    expect(summary.blockingWaiverCount).toBe(0); // no hard blocker invented
    expect(summary.warnings.map((w) => w.code).sort()).toEqual(
      ["missing-amount", "missing-job", "missing-vendor"],
    );
  });
});
