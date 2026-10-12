import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LienWaiverPairingPanel } from "@/modules/accounting/modules/invoices/components/documents/LienWaiverPairingPanel";
import type { LienWaiverOrphanInvoicesResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

const mocks = vi.hoisted(() => ({
  useLienWaiverOrphanInvoices: vi.fn(),
  linkMutate: vi.fn(),
  unlinkMutate: vi.fn(),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useLienWaiverOrphanInvoices: mocks.useLienWaiverOrphanInvoices,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useLinkWaiver: () => ({ mutate: mocks.linkMutate, isPending: false }),
  useUnlinkWaiver: () => ({ mutate: mocks.unlinkMutate, isPending: false }),
}));

function makeWaiver(): Invoice {
  return {
    id: "waiver-1", classification: "lien-waiver", confidence: 0.9, file: "waiver.pdf",
    email: { from: "apex@example.com", subject: "Waiver", receivedAt: "2026-06-14T12:00:00.000Z" },
    status: "pending", queuedAt: "2026-06-14T12:00:00.000Z", extracted: null, matching: null,
    overallConfidence: 0.9, splitFrom: null, duplicateOf: null, reason: null, error: null,
    reclassifiedFrom: null, reclassifiedAt: null,
  };
}

const noServerPair: LienWaiverOrphanInvoicesResponse = {
  target: { id: "waiver-1", fileName: "waiver.pdf", vendorName: "Apex", vendorCode: "V100", amount: null, invoiceNumber: null, jobNumber: null, status: "pending", receivedAt: null },
  paired: null,
  invoices: [],
  total: 0,
  page: 1,
  limit: 10,
};

describe("LienWaiverPairingPanel authority", () => {
  beforeEach(() => {
    mocks.linkMutate.mockReset();
    mocks.unlinkMutate.mockReset();
    mocks.useLienWaiverOrphanInvoices.mockReturnValue({ data: noServerPair, isLoading: false, isError: false, error: null });
  });

  it("does not let a stale linkedInvoiceId authorize unlink without a server paired envelope", () => {
    render(
      <LienWaiverPairingPanel
        record={makeWaiver()}
        linkedInvoiceId="invoice-stale"
        onLinkedInvoiceChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Unlink" })).not.toBeInTheDocument();
    expect(screen.getByText("No unlinked invoices are available.")).toBeInTheDocument();
    expect(mocks.unlinkMutate).not.toHaveBeenCalled();
  });
});
