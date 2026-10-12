import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SpectrumSubmitResultsView } from "@/modules/accounting/modules/invoices/components/dashboard/SpectrumSubmitResultsView";
import { getSpectrumSubmitFailureNavigation } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitResultsModel";
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
    candidates: [],
    rows,
    submittedCount: rows.filter((row) => row.submitted).length,
    failedCount: rows.filter((row) => !row.submitted).length,
  };
}

function ResultsNavigationHarness({
  initialInvoiceId = null,
  phase,
}: {
  initialInvoiceId?: string | null;
  phase: SpectrumSubmitResultsPhase;
}) {
  const [activeFailureInvoiceId, setActiveFailureInvoiceId] = useState<string | null>(initialInvoiceId);
  const navigation = getSpectrumSubmitFailureNavigation(phase, activeFailureInvoiceId);

  return (
    <SpectrumSubmitResultsView
      activeFailureInvoiceId={navigation.activeInvoiceId}
      failureNavigation={navigation}
      phase={phase}
      onFailureNavigationChange={setActiveFailureInvoiceId}
    />
  );
}

describe("SpectrumSubmitResultsView", () => {
  it("renders completed and failed row treatments with actions", async () => {
    const user = userEvent.setup();
    const onOpenInvoice = vi.fn();
    const onDiscardInvoice = vi.fn();
    const failed = makeRow("inv-2", {
      invoiceNumber: "B-200",
      vendorName: "Beacon Electric",
      amount: 800,
    });

    render(
      <SpectrumSubmitResultsView
        phase={makePhase([
          makeRow("inv-1", { submitted: true, issue: null, resolved: true }),
          failed,
        ])}
        onDiscardInvoice={onDiscardInvoice}
        onOpenInvoice={onOpenInvoice}
      />,
    );

    expect(screen.getByLabelText("Spectrum submission results")).toHaveTextContent(
      "Submitted to Spectrum",
    );
    expect(screen.getByLabelText("Spectrum submission results")).toHaveTextContent(
      "Duplicate invoice",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("1 failed.");
    expect(screen.getByRole("button", { name: "Fix 1 failed ->" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Discard B-200" }));

    expect(onOpenInvoice).toHaveBeenCalledWith("inv-2");
    expect(onDiscardInvoice).toHaveBeenCalledWith(failed);
  });

  it("groups failed rows before submitted rows while preserving their original order", () => {
    render(
      <SpectrumSubmitResultsView
        phase={makePhase([
          makeRow("submitted-first", { submitted: true, issue: null, resolved: true }),
          makeRow("failed-first"),
          makeRow("submitted-second", { submitted: true, issue: null, resolved: true }),
          makeRow("failed-second"),
        ])}
      />,
    );

    const resultRows = Array.from(screen.getByLabelText("Spectrum submission results").children);
    expect(resultRows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("failed-first"),
      expect.stringContaining("failed-second"),
      expect.stringContaining("submitted-first"),
      expect.stringContaining("submitted-second"),
    ]);
  });

  it("keeps discarded failures visible with resolved treatment", () => {
    render(
      <SpectrumSubmitResultsView
        phase={makePhase([
          makeRow("inv-2", {
            discarded: true,
            resolved: true,
          }),
        ])}
      />,
    );

    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("All failures resolved.");
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
  });

  it("renders reason-aware duplicate messages and submitted-document context", () => {
    render(
      <SpectrumSubmitResultsView
        phase={makePhase([
          makeRow("approved-duplicate", {
            duplicate: {
              vendorCode: "ACME01",
              invoiceNumber: "INV-7",
              documentIds: ["submitted-duplicate", "approved-duplicate"],
              reason: "already_submitted",
              documents: [
                { id: "submitted-duplicate", status: "submitted", jobNumber: "25-407", amount: 100 },
                { id: "approved-duplicate", status: "approved", jobNumber: "25-407", amount: 100 },
              ],
            },
          }),
          makeRow("batch-duplicate", {
            duplicate: {
              vendorCode: "ACME01",
              invoiceNumber: "INV-8",
              documentIds: ["first-approved", "batch-duplicate"],
              reason: "batch_duplicate",
              documents: [
                { id: "first-approved", status: "approved", jobNumber: "25-408", amount: 200 },
                { id: "batch-duplicate", status: "approved", jobNumber: "25-408", amount: 200 },
              ],
            },
          }),
        ])}
      />,
    );

    expect(screen.getByText("Already submitted to Spectrum")).toBeInTheDocument();
    expect(screen.getByText("Spectrum issue: Existing submitted document: Job 25-407 · $100.00")).toBeInTheDocument();
    expect(screen.getByText("Duplicate of another invoice in this batch")).toBeInTheDocument();
    expect(screen.getByText("Spectrum issue: Both documents are approved; discard one before resubmitting.")).toBeInTheDocument();
  });

  it("shows server pre-flight validation lines beneath the generic failure and caps them", () => {
    const preflightErrors = Array.from(
      { length: 12 },
      (_, index) => `invoice A-100 detail[${index + 1}]: invalid Spectrum field`,
    );
    render(
      <SpectrumSubmitResultsView
        phase={makePhase([
          makeRow("preflight", {
            issue: "Spectrum submission payload failed validation — no invoices were submitted.",
            preflightErrors,
          }),
        ])}
      />,
    );

    expect(screen.getByText("Spectrum submission payload failed validation — no invoices were submitted.")).toBeInTheDocument();
    expect(screen.getByText(preflightErrors[0])).toBeInTheDocument();
    expect(screen.getByText(preflightErrors[9])).toBeInTheDocument();
    expect(screen.queryByText(preflightErrors[10])).not.toBeInTheDocument();
    expect(screen.getByText("+2 more")).toBeInTheDocument();
  });

  it("highlights the active failure and opens the focused fix queue", async () => {
    const user = userEvent.setup();
    const onOpenInvoice = vi.fn();
    const phase = makePhase([
      makeRow("submitted", { submitted: true, issue: null, resolved: true }),
      makeRow("first"),
      makeRow("discarded", { discarded: true, resolved: true }),
      makeRow("resolved", { resolved: true }),
      makeRow("second"),
    ]);
    const navigation = getSpectrumSubmitFailureNavigation(phase, "second");

    render(
      <SpectrumSubmitResultsView
        activeFailureInvoiceId={navigation.activeInvoiceId}
        failureNavigation={navigation}
        phase={phase}
        onOpenInvoice={onOpenInvoice}
      />,
    );

    expect(screen.getByText("second").closest("[aria-current='true']")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Fix 2 failed ->" }));

    expect(onOpenInvoice).toHaveBeenCalledWith("second");
  });

  it("cycles previous and next controls through unresolved failures only", async () => {
    const user = userEvent.setup();
    const phase = makePhase([
      makeRow("submitted", { submitted: true, issue: null, resolved: true }),
      makeRow("first"),
      makeRow("discarded", { discarded: true, resolved: true }),
      makeRow("resolved", { resolved: true }),
      makeRow("second"),
    ]);

    render(<ResultsNavigationHarness phase={phase} />);

    expect(screen.getByLabelText("Current unresolved failure")).toHaveTextContent("1 / 2");
    expect(screen.getByText("first").closest("[aria-current='true']")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Next unresolved failure" }));

    expect(screen.getByLabelText("Current unresolved failure")).toHaveTextContent("2 / 2");
    expect(screen.getByText("second").closest("[aria-current='true']")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Next unresolved failure" }));

    expect(screen.getByLabelText("Current unresolved failure")).toHaveTextContent("1 / 2");
    expect(screen.getByText("first").closest("[aria-current='true']")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Previous unresolved failure" }));

    expect(screen.getByLabelText("Current unresolved failure")).toHaveTextContent("2 / 2");
    expect(screen.getByText("second").closest("[aria-current='true']")).not.toBeNull();
  });

  it("disables previous and next controls for one unresolved failure", () => {
    render(
      <ResultsNavigationHarness
        phase={makePhase([
          makeRow("submitted", { submitted: true, issue: null, resolved: true }),
          makeRow("only"),
          makeRow("resolved", { resolved: true }),
        ])}
      />,
    );

    expect(screen.getByLabelText("Current unresolved failure")).toHaveTextContent("1 / 1");
    expect(screen.getByRole("button", { name: "Previous unresolved failure" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next unresolved failure" })).toBeDisabled();
    expect(screen.getByText("only").closest("[aria-current='true']")).not.toBeNull();
  });
});
