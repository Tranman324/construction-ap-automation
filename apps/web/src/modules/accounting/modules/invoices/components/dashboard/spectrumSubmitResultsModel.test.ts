import { describe, expect, it } from "vitest";

import {
  canCompleteSpectrumSubmitResults,
  createSpectrumSubmitDiscardReason,
  getSpectrumSubmitFailureReason,
  getSpectrumSubmitFailureContext,
  getSpectrumSubmitFailureNavigation,
  getSpectrumSubmitRetryCandidates,
  getUnresolvedSpectrumSubmitFailures,
  markSpectrumSubmitResultDiscarded,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitResultsModel";
import type {
  SpectrumSubmitResultRow,
  SpectrumSubmitResultsPhase,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitProgressModel";

function makeRow(
  invoiceId: string,
  overrides: Partial<SpectrumSubmitResultRow> = {},
): SpectrumSubmitResultRow {
  return {
    invoiceId,
    invoiceNumber: invoiceId,
    vendorName: "Acme Concrete",
    amount: 100,
    submitted: false,
    issue: "Duplicate invoice",
    resolved: false,
    discarded: false,
    ...overrides,
  };
}

function makePhase(rows: SpectrumSubmitResultRow[]): SpectrumSubmitResultsPhase {
  return {
    phase: "results",
    candidates: rows.map((row) => ({
      id: row.invoiceId,
      vendorName: row.vendorName,
      invoiceNumber: row.invoiceNumber,
      amount: row.amount,
      jobNumber: "25-401",
      lienWaiverStatus: "attached",
      lienWaiverRequired: false,
      linkedLienWaiverId: "waiver-1",
    })),
    rows,
    submittedCount: rows.filter((row) => row.submitted).length,
    failedCount: rows.filter((row) => !row.submitted).length,
  };
}

describe("spectrumSubmitResultsModel", () => {
  it("gates completion on unresolved failed rows", () => {
    const phase = makePhase([
      makeRow("ok", { submitted: true, issue: null, resolved: true }),
      makeRow("failed"),
    ]);

    expect(canCompleteSpectrumSubmitResults(phase)).toBe(false);
    expect(getUnresolvedSpectrumSubmitFailures(phase).map((row) => row.invoiceId)).toEqual([
      "failed",
    ]);

    const resolved = markSpectrumSubmitResultDiscarded(phase, "failed");

    expect(canCompleteSpectrumSubmitResults(resolved)).toBe(true);
    expect(resolved.rows[1]).toMatchObject({ discarded: true, resolved: true });
  });

  it("creates discard reasons from Spectrum issues with a fallback", () => {
    expect(createSpectrumSubmitDiscardReason(makeRow("failed"))).toBe(
      "Discarded after Spectrum submission failure: Duplicate invoice",
    );
    expect(getSpectrumSubmitFailureReason(makeRow("waiver", { issue: "lien_waiver_required" }))).toBe(
      "Missing lien waiver. Link a signed waiver before submitting.",
    );
    expect(getSpectrumSubmitFailureReason(makeRow("blank", { issue: " " }))).toBe(
      "Spectrum submission failed.",
    );
  });

  it("uses duplicate reason and document context when the submit preflight provides them", () => {
    const alreadySubmitted = makeRow("approved", {
      duplicate: {
        vendorCode: "ACME01",
        invoiceNumber: "INV-7",
        documentIds: ["submitted", "approved"],
        reason: "already_submitted",
        documents: [
          { id: "submitted", status: "submitted", jobNumber: "25-407", amount: 100 },
          { id: "approved", status: "approved", jobNumber: "25-407", amount: 100 },
        ],
      },
    });
    const batchDuplicate = makeRow("second-approved", {
      duplicate: {
        vendorCode: "ACME01",
        invoiceNumber: "INV-8",
        documentIds: ["first-approved", "second-approved"],
        reason: "batch_duplicate",
        documents: [
          { id: "first-approved", status: "approved", jobNumber: "25-408", amount: 200 },
          { id: "second-approved", status: "approved", jobNumber: "25-408", amount: 200 },
        ],
      },
    });

    expect(getSpectrumSubmitFailureReason(alreadySubmitted)).toBe("Already submitted to Spectrum");
    expect(getSpectrumSubmitFailureContext(alreadySubmitted)).toBe("Existing submitted document: Job 25-407 · $100.00");
    expect(getSpectrumSubmitFailureReason(batchDuplicate)).toBe("Duplicate of another invoice in this batch");
    expect(getSpectrumSubmitFailureContext(batchDuplicate)).toBe(
      "Both documents are approved; discard one before resubmitting.",
    );
  });

  it("returns only unresolved candidates for retry", () => {
    const phase = makePhase([
      makeRow("submitted", { submitted: true, resolved: true }),
      makeRow("failed"),
      makeRow("discarded", { discarded: true, resolved: true }),
    ]);

    expect(getSpectrumSubmitRetryCandidates(phase).map((candidate) => candidate.id)).toEqual(["failed"]);
  });

  it("cycles navigation through actionable failures only", () => {
    const phase = makePhase([
      makeRow("submitted", { submitted: true, resolved: true, issue: null }),
      makeRow("first"),
      makeRow("discarded", { discarded: true, resolved: true }),
      makeRow("resolved", { resolved: true }),
      makeRow("second"),
    ]);

    const first = getSpectrumSubmitFailureNavigation(phase, null);
    expect(first).toMatchObject({
      activeInvoiceId: "first",
      position: 1,
      total: 2,
      previousInvoiceId: "second",
      nextInvoiceId: "second",
    });

    const second = getSpectrumSubmitFailureNavigation(phase, first.nextInvoiceId);
    expect(second).toMatchObject({
      activeInvoiceId: "second",
      position: 2,
      total: 2,
      previousInvoiceId: "first",
      nextInvoiceId: "first",
    });
  });
});
