import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SPECTRUM_SUBMIT_WORKFLOW_STORAGE_KEY,
  clearSpectrumSubmitFailureWorkflowSnapshot,
  createSpectrumSubmitFailureDetailHref,
  createSpectrumSubmitFailureWorkflowSnapshot,
  createSpectrumSubmitReturnHref,
  hasSpectrumSubmitFailureWorkflowSnapshot,
  isSpectrumSubmitReturnVisit,
  markSpectrumSubmitFailureWorkflowInvoiceFailed,
  markSpectrumSubmitFailureWorkflowInvoiceSubmitted,
  readSpectrumSubmitFailureWorkflowSnapshot,
  refreshSpectrumSubmitFailureWorkflow,
  writeSpectrumSubmitFailureWorkflowSnapshot,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitFailureWorkflowModel";
import type {
  SpectrumSubmitResultRow,
  SpectrumSubmitResultsPhase,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitProgressModel";
import {
  getSpectrumSubmitRetryCandidates,
  getUnresolvedSpectrumSubmitFailures,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitResultsModel";

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
    candidates: [],
    rows,
    submittedCount: rows.filter((row) => row.submitted).length,
    failedCount: rows.filter((row) => !row.submitted).length,
  };
}

describe("spectrumSubmitFailureWorkflowModel", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("creates small route intent URLs and stores snapshots out of band", () => {
    const returnHref = createSpectrumSubmitReturnHref(
      "/accounting/invoices",
      "status=approved",
    );
    const detailHref = createSpectrumSubmitFailureDetailHref("inv 1", returnHref);
    const snapshot = createSpectrumSubmitFailureWorkflowSnapshot(
      makePhase([makeRow("inv 1")]),
      "inv 1",
    );

    writeSpectrumSubmitFailureWorkflowSnapshot(snapshot);

    expect(returnHref).toBe("/accounting/invoices?status=approved&spectrumSubmitReturn=1");
    expect(detailHref).toBe(
      "/accounting/invoices/inv%201?from=%2Faccounting%2Finvoices%3Fstatus%3Dapproved%26spectrumSubmitReturn%3D1&spectrumSubmitReturn=1",
    );
    expect(isSpectrumSubmitReturnVisit(new URLSearchParams("spectrumSubmitReturn=1"))).toBe(true);
    expect(hasSpectrumSubmitFailureWorkflowSnapshot()).toBe(true);
    expect(readSpectrumSubmitFailureWorkflowSnapshot()).toMatchObject({
      activeInvoiceId: "inv 1",
      results: { phase: "results" },
    });

    clearSpectrumSubmitFailureWorkflowSnapshot();
    expect(window.sessionStorage.getItem(SPECTRUM_SUBMIT_WORKFLOW_STORAGE_KEY)).toBeNull();
  });

  it("resolves unapproved rows and keeps still-approved failures actionable", async () => {
    const fetchInvoice = vi.fn()
      .mockResolvedValueOnce({ id: "submitted", status: "submitted", lastSpectrumError: null })
      .mockResolvedValueOnce({ id: "discarded", status: "discarded", lastSpectrumError: null })
      .mockResolvedValueOnce({ id: "unapproved", status: "pending", lastSpectrumError: "Rework required" })
      .mockResolvedValueOnce({ id: "still-failing", status: "approved", lastSpectrumError: "Missing GL" });
    const snapshot = createSpectrumSubmitFailureWorkflowSnapshot(
      {
        ...makePhase([
          makeRow("submitted"),
          makeRow("discarded"),
          makeRow("unapproved"),
          makeRow("still-failing"),
        ]),
        candidates: [
          {
            id: "unapproved",
            vendorName: "Acme Concrete",
            invoiceNumber: "unapproved",
            amount: 100,
            jobNumber: null,
            lienWaiverStatus: null,
            lienWaiverRequired: false,
            linkedLienWaiverId: null,
          },
          {
            id: "still-failing",
            vendorName: "Acme Concrete",
            invoiceNumber: "still-failing",
            amount: 100,
            jobNumber: null,
            lienWaiverStatus: null,
            lienWaiverRequired: false,
            linkedLienWaiverId: null,
          },
        ],
      },
      "submitted",
    );

    const refreshed = await refreshSpectrumSubmitFailureWorkflow(snapshot, fetchInvoice);

    expect(refreshed.activeInvoiceId).toBe("still-failing");
    expect(refreshed.results.submittedCount).toBe(1);
    expect(getUnresolvedSpectrumSubmitFailures(refreshed.results).map((row) => row.invoiceId)).toEqual([
      "still-failing",
    ]);
    expect(getSpectrumSubmitRetryCandidates(refreshed.results).map((candidate) => candidate.id)).toEqual([
      "still-failing",
    ]);
    expect(refreshed.results.rows).toEqual([
      expect.objectContaining({ invoiceId: "submitted", submitted: true, resolved: true }),
      expect.objectContaining({ invoiceId: "discarded", discarded: true, resolved: true }),
      expect.objectContaining({
        invoiceId: "unapproved",
        submitted: false,
        discarded: false,
        resolved: true,
      }),
      expect.objectContaining({
        invoiceId: "still-failing",
        issue: "Missing GL",
        resolved: false,
      }),
    ]);
  });

  it("marks individual returned invoices as submitted or failed", () => {
    const snapshot = createSpectrumSubmitFailureWorkflowSnapshot(
      makePhase([
        makeRow("fixed"),
        makeRow("still-failing"),
      ]),
      "fixed",
    );

    const submitted = markSpectrumSubmitFailureWorkflowInvoiceSubmitted(snapshot, "fixed");
    expect(submitted.activeInvoiceId).toBe("still-failing");
    expect(submitted.results.submittedCount).toBe(1);
    expect(submitted.results.rows).toEqual([
      expect.objectContaining({ invoiceId: "fixed", submitted: true, resolved: true, issue: null }),
      expect.objectContaining({ invoiceId: "still-failing", submitted: false, resolved: false }),
    ]);

    const failedAgain = markSpectrumSubmitFailureWorkflowInvoiceFailed(submitted, "fixed", "Missing GL account");
    expect(failedAgain.activeInvoiceId).toBe("fixed");
    expect(failedAgain.results.submittedCount).toBe(0);
    expect(failedAgain.results.rows[0]).toEqual(expect.objectContaining({
      invoiceId: "fixed",
      submitted: false,
      resolved: false,
      issue: "Missing GL account",
    }));
  });
});
