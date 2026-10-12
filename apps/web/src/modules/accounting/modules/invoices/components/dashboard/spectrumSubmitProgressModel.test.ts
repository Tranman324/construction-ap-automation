import { describe, expect, it } from "vitest";

import {
  completeSpectrumSubmitProgress,
  mergeSpectrumSubmitResults,
  normalizeSpectrumSubmitError,
  normalizeSpectrumSubmitResponse,
  recordSpectrumSubmitResult,
  startSpectrumSubmitProgress,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitProgressModel";
import type { SpectrumSubmitCandidate } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";

function makeCandidate(id: string): SpectrumSubmitCandidate {
  return {
    id,
    vendorName: "Acme Concrete",
    invoiceNumber: id,
    amount: 100,
    jobNumber: "25-401",
    lienWaiverStatus: "attached",
    lienWaiverRequired: false,
    linkedLienWaiverId: "waiver-1",
  };
}

describe("spectrumSubmitProgressModel", () => {
  it("tracks deterministic active row and percentage updates", () => {
    const first = makeCandidate("inv-1");
    const second = makeCandidate("inv-2");
    const initial = startSpectrumSubmitProgress([first, second]);
    const result = normalizeSpectrumSubmitResponse(first, {
      success: true,
      submitted: 1,
      message: "Submitted",
    });

    const next = recordSpectrumSubmitResult(initial, result);

    expect(initial.activeInvoiceId).toBe("inv-1");
    expect(next.completedCount).toBe(1);
    expect(next.percentage).toBe(50);
    expect(next.activeInvoiceId).toBe("inv-2");
    expect(next.rows.map((row) => row.state)).toEqual(["success", "active"]);
  });

  it("normalizes success, backend failure, thrown error, and results summary", () => {
    const candidate = makeCandidate("inv-1");

    expect(
      normalizeSpectrumSubmitResponse(candidate, {
        success: true,
        submitted: 1,
        message: "Submitted",
      }),
    ).toMatchObject({ invoiceId: "inv-1", submitted: true, issue: null });
    expect(
      normalizeSpectrumSubmitResponse(candidate, {
        success: false,
        submitted: 0,
        message: "Rejected",
        results: [{ id: "inv-1", success: false, error: "Duplicate invoice" }],
      }),
    ).toMatchObject({ submitted: false, issue: "Duplicate invoice" });
    expect(normalizeSpectrumSubmitError(candidate, new Error("offline"))).toMatchObject({
      submitted: false,
      issue: "offline",
    });
  });

  it("retains duplicate preflight metadata and selects the approved duplicate for discard", () => {
    const candidate = makeCandidate("approved-duplicate");

    expect(normalizeSpectrumSubmitError(candidate, {
      status: 400,
      message: "Cannot submit: selected invoices contain duplicate vendor and invoice-number combinations.",
      details: {
        duplicates: [{
          vendorCode: "ACME01",
          invoiceNumber: "INV-7",
          documentIds: ["submitted-duplicate", "approved-duplicate"],
          reason: "already_submitted",
          documents: [
            { id: "submitted-duplicate", status: "submitted", jobNumber: "25-407", amount: 100 },
            { id: "approved-duplicate", status: "approved", jobNumber: "25-407", amount: 100 },
          ],
        }],
      },
    })).toMatchObject({
      duplicate: { reason: "already_submitted" },
      discardInvoiceId: "approved-duplicate",
    });
  });

  it("retains canonical pre-flight validation lines from a rejected API response", () => {
    const preflightErrors = [
      'invoice 263746 detail[1]: Job_Number "11973.003" does not exist in Spectrum job cache',
      "invoice 263746: Job.Phase_Code is required when Job is present",
    ];

    expect(normalizeSpectrumSubmitError(makeCandidate("inv-1"), {
      status: 400,
      message: "Spectrum submission payload failed validation — no invoices were submitted.",
      details: { reason: "payload_validation", errors: preflightErrors },
    })).toMatchObject({
      issue: "Spectrum submission payload failed validation — no invoices were submitted.",
      preflightErrors,
    });
  });

  it("passes an unknown server message through without inventing a category", () => {
    const rawMessage = "Spectrum rejected invoice: routing profile is temporarily unavailable";

    expect(normalizeSpectrumSubmitError(makeCandidate("inv-unknown"), {
      status: 422,
      message: rawMessage,
    })).toMatchObject({ issue: rawMessage });
  });

  it("completes with one result row per candidate", () => {
    const first = makeCandidate("inv-1");
    const second = makeCandidate("inv-2");
    const initial = startSpectrumSubmitProgress([first, second]);
    const afterFirst = recordSpectrumSubmitResult(
      initial,
      normalizeSpectrumSubmitResponse(first, { success: true, submitted: 1, message: "Submitted" }),
    );
    const afterSecond = recordSpectrumSubmitResult(
      afterFirst,
      normalizeSpectrumSubmitResponse(second, { success: false, submitted: 0, message: "Rejected" }),
    );

    expect(completeSpectrumSubmitProgress(afterSecond)).toMatchObject({
      phase: "results",
      submittedCount: 1,
      failedCount: 1,
      rows: [
        { invoiceId: "inv-1", submitted: true },
        { invoiceId: "inv-2", submitted: false, issue: "Rejected" },
      ],
    });
  });

  it("merges retry results without dropping previous successes", () => {
    const first = makeCandidate("inv-1");
    const second = makeCandidate("inv-2");
    const previous = completeSpectrumSubmitProgress(
      recordSpectrumSubmitResult(
        recordSpectrumSubmitResult(
          startSpectrumSubmitProgress([first, second]),
          normalizeSpectrumSubmitResponse(first, { success: true, submitted: 1, message: "Submitted" }),
        ),
        normalizeSpectrumSubmitResponse(second, { success: false, submitted: 0, message: "Rejected" }),
      ),
    );
    const retry = completeSpectrumSubmitProgress(
      recordSpectrumSubmitResult(
        startSpectrumSubmitProgress([second]),
        normalizeSpectrumSubmitResponse(second, { success: true, submitted: 1, message: "Submitted" }),
      ),
    );

    expect(mergeSpectrumSubmitResults(previous, retry)).toMatchObject({
      submittedCount: 2,
      failedCount: 0,
      rows: [
        { invoiceId: "inv-1", submitted: true },
        { invoiceId: "inv-2", submitted: true, issue: null },
      ],
    });
  });
});
