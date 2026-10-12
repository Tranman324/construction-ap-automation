import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LienWaiverPairingPanel } from "@/modules/accounting/modules/invoices/components/documents/LienWaiverPairingPanel";
import type { LienWaiverOrphanInvoicesResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

const mocks = vi.hoisted(() => ({
  useLienWaiverOrphanInvoices: vi.fn(),
  linkMutate: vi.fn(),
  unlinkMutate: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useLienWaiverOrphanInvoices: mocks.useLienWaiverOrphanInvoices,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useLinkWaiver: () => ({ mutate: mocks.linkMutate, isPending: false }),
  useUnlinkWaiver: () => ({ mutate: mocks.unlinkMutate, isPending: false }),
}));

vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: { error: mocks.toastError },
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

const unpairedResponse: LienWaiverOrphanInvoicesResponse = {
  target: { id: "waiver-1", fileName: "waiver.pdf", vendorName: "Apex", vendorCode: "V100", amount: null, invoiceNumber: null, jobNumber: null, status: "pending", receivedAt: null },
  paired: null,
  invoices: [{ id: "invoice-1", fileName: "invoice-1.pdf", vendorName: "Apex", vendorCode: "V100", amount: 2400, invoiceNumber: "INV-100", jobNumber: "24-017", status: "pending", receivedAt: null }],
  total: 1,
  page: 1,
  limit: 10,
};

describe("LienWaiverPairingPanel", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    mocks.linkMutate.mockReset();
    mocks.unlinkMutate.mockReset();
    mocks.toastError.mockReset();
    mocks.useLienWaiverOrphanInvoices.mockReturnValue({ data: unpairedResponse, isLoading: false, isError: false, error: null });
    mocks.linkMutate.mockImplementation((_variables, callbacks) => callbacks?.onSuccess?.());
    mocks.unlinkMutate.mockImplementation((_variables, callbacks) => callbacks?.onSuccess?.());
  });

  it("pairs exactly once when the candidate card is clicked", async () => {
    const user = userEvent.setup();
    const onLinkedInvoiceChange = vi.fn();
    const onLinkComplete = vi.fn();
    render(
      <LienWaiverPairingPanel
        record={makeWaiver()}
        linkedInvoiceId={null}
        onLinkedInvoiceChange={onLinkedInvoiceChange}
        onLinkComplete={onLinkComplete}
      />,
    );

    expect(screen.getByText("Invoice INV-100 · 24-017 · $2,400.00")).toBeInTheDocument();
    const candidateCard = screen.getByRole("button", { name: /Pair Apex invoice INV-100/i });
    expect(candidateCard).toHaveClass("flex-1", "text-left");
    expect(candidateCard.querySelector("button")).toBeNull();
    expect(candidateCard.parentElement?.parentElement?.querySelectorAll("button")).toHaveLength(2);
    expect(screen.queryByRole("searchbox", { name: "Search invoices" })).not.toBeInTheDocument();
    await user.click(candidateCard);

    expect(mocks.linkMutate).toHaveBeenCalledTimes(1);
    expect(mocks.linkMutate.mock.calls[0]?.[0]).toEqual({ invoiceId: "invoice-1", waiverId: "waiver-1" });
    expect(onLinkedInvoiceChange).toHaveBeenCalledWith("invoice-1");
    expect(onLinkComplete).toHaveBeenCalledTimes(1);
  });

  it("publishes empty-candidate presentation to the existing row and keeps query errors distinct", () => {
    const onCandidatesEmptyChange = vi.fn();
    mocks.useLienWaiverOrphanInvoices.mockReturnValue({ data: { ...unpairedResponse, invoices: [], total: 0 }, isLoading: false, isError: false });
    const view = (candidatesEmpty: boolean) => <LienWaiverPairingPanel record={makeWaiver()} linkedInvoiceId={null}
      onLinkedInvoiceChange={vi.fn()} candidatesEmpty={candidatesEmpty} onCandidatesEmptyChange={onCandidatesEmptyChange} />;
    const { rerender } = render(view(false));
    expect(onCandidatesEmptyChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText("No unlinked invoices are available.")).not.toBeInTheDocument();
    mocks.useLienWaiverOrphanInvoices.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("Synthetic query failure") });
    rerender(view(true));
    expect(onCandidatesEmptyChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByText("Synthetic query failure")).toBeInTheDocument();
    expect(mocks.linkMutate).not.toHaveBeenCalled();
    expect(mocks.unlinkMutate).not.toHaveBeenCalled();
  });

  it("disables candidate pairing while the authoritative mutation is pending", async () => {
    const user = userEvent.setup();
    mocks.linkMutate.mockImplementationOnce(() => undefined);
    render(<LienWaiverPairingPanel record={makeWaiver()} linkedInvoiceId={null} onLinkedInvoiceChange={vi.fn()} />);

    const candidateCard = screen.getByRole("button", { name: /Pair Apex invoice INV-100/i });
    await user.click(candidateCard);

    expect(candidateCard).toBeDisabled();
    await user.click(candidateCard);
    expect(mocks.linkMutate).toHaveBeenCalledTimes(1);
  });

  it("keeps a rejected pair unpaired and available for retry", async () => {
    const user = userEvent.setup();
    let linkCallbacks: { onError?: (error: unknown) => void } | undefined;
    mocks.linkMutate.mockImplementationOnce((_variables, callbacks) => {
      linkCallbacks = callbacks;
    });
    const onLinkedInvoiceChange = vi.fn();
    render(<LienWaiverPairingPanel record={makeWaiver()} linkedInvoiceId={null} onLinkedInvoiceChange={onLinkedInvoiceChange} />);

    await user.click(screen.getByRole("button", { name: /Pair Apex invoice INV-100/i }));
    act(() => linkCallbacks?.onError?.(new Error("Pair was rejected")));

    expect(await screen.findByText("Pair was rejected")).toBeInTheDocument();
    expect(onLinkedInvoiceChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: /Pair Apex invoice INV-100/i })).toBeEnabled());
    expect(screen.queryByLabelText("Paired invoice")).not.toBeInTheDocument();
  });

  it.each(["{Enter}", " "])("pairs exactly once when the candidate card receives %s", async (key) => {
    const user = userEvent.setup();
    render(<LienWaiverPairingPanel record={makeWaiver()} linkedInvoiceId={null} onLinkedInvoiceChange={vi.fn()} />);

    const candidateCard = screen.getByRole("button", { name: /Pair Apex invoice INV-100/i });
    candidateCard.focus();
    await user.keyboard(key);

    expect(mocks.linkMutate).toHaveBeenCalledTimes(1);
    expect(mocks.linkMutate.mock.calls[0]?.[0]).toEqual({ invoiceId: "invoice-1", waiverId: "waiver-1" });
  });

  it("opens the candidate invoice without pairing", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<LienWaiverPairingPanel record={makeWaiver()} linkedInvoiceId={null} onLinkedInvoiceChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Preview invoice INV-100" }));

    expect(open).toHaveBeenCalledWith("/accounting/invoices/invoice-1", "_blank");
    expect(mocks.linkMutate).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("keeps approved invoice candidates visible but disables Link with an accessible reason", async () => {
    const user = userEvent.setup();
    const response = { ...unpairedResponse, invoices: [{ ...unpairedResponse.invoices[0], status: "approved" }] };
    mocks.useLienWaiverOrphanInvoices.mockReturnValue({ data: response, isLoading: false, isError: false, error: null });
    render(<LienWaiverPairingPanel record={makeWaiver()} linkedInvoiceId={null} onLinkedInvoiceChange={vi.fn()} />);

    const candidateCard = screen.getByRole("button", { name: /Pair Apex invoice INV-100/i });
    expect(candidateCard).toBeDisabled();
    await user.hover(candidateCard.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Approved invoices are locked — unapprove first to change waiver linkage.");
    expect(mocks.linkMutate).not.toHaveBeenCalled();
  });

  it("does not advance a different waiver after an earlier link response arrives", async () => {
    const user = userEvent.setup();
    const onLinkedInvoiceChange = vi.fn();
    const onLinkComplete = vi.fn();
    let linkCallbacks: { onSuccess?: () => void } | undefined;
    mocks.linkMutate.mockImplementationOnce((_variables, callbacks) => {
      linkCallbacks = callbacks;
    });
    const view = render(
      <LienWaiverPairingPanel
        record={makeWaiver()}
        linkedInvoiceId={null}
        onLinkedInvoiceChange={onLinkedInvoiceChange}
        onLinkComplete={onLinkComplete}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Pair Apex invoice INV-100/i }));
    view.rerender(
      <LienWaiverPairingPanel
        record={{ ...makeWaiver(), id: "waiver-2" }}
        linkedInvoiceId={null}
        onLinkedInvoiceChange={onLinkedInvoiceChange}
        onLinkComplete={onLinkComplete}
      />,
    );
    act(() => linkCallbacks?.onSuccess?.());

    expect(onLinkedInvoiceChange).not.toHaveBeenCalled();
    expect(onLinkComplete).not.toHaveBeenCalled();
  });

  it("does not advance after the linked waiver panel was unmounted", async () => {
    const user = userEvent.setup();
    const onLinkedInvoiceChange = vi.fn();
    const onLinkComplete = vi.fn();
    let linkCallbacks: { onSuccess?: () => void } | undefined;
    mocks.linkMutate.mockImplementationOnce((_variables, callbacks) => {
      linkCallbacks = callbacks;
    });
    const view = render(
      <LienWaiverPairingPanel
        record={makeWaiver()}
        linkedInvoiceId={null}
        onLinkedInvoiceChange={onLinkedInvoiceChange}
        onLinkComplete={onLinkComplete}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Pair Apex invoice INV-100/i }));
    view.unmount();
    act(() => linkCallbacks?.onSuccess?.());

    expect(onLinkedInvoiceChange).not.toHaveBeenCalled();
    expect(onLinkComplete).not.toHaveBeenCalled();
  });

  it.each(["approved", "discarded"] as const)("does not offer orphan invoice linking when the waiver is %s", (status) => {
    render(<LienWaiverPairingPanel record={{ ...makeWaiver(), status }} linkedInvoiceId={null} onLinkedInvoiceChange={vi.fn()} />);

    expect(screen.queryByText(/Invoice INV-100/)).not.toBeInTheDocument();
    expect(screen.getByText("Invoice linking is not available for this document.")).toBeInTheDocument();
    expect(mocks.useLienWaiverOrphanInvoices).toHaveBeenLastCalledWith("waiver-1", { page: 1 }, false);
  });

  it("keeps candidate lookup enabled when lienWaiverRequired is false", () => {
    render(<LienWaiverPairingPanel record={{ ...makeWaiver(), lienWaiverRequired: false }} linkedInvoiceId={null} onLinkedInvoiceChange={vi.fn()} />);

    expect(screen.getByText(/Invoice INV-100/)).toBeInTheDocument();
    expect(mocks.useLienWaiverOrphanInvoices).toHaveBeenLastCalledWith("waiver-1", { page: 1 }, true);
  });

  it("keeps candidate lookup enabled for a submitted waiver", () => {
    render(<LienWaiverPairingPanel record={{ ...makeWaiver(), status: "submitted" }} linkedInvoiceId={null} onLinkedInvoiceChange={vi.fn()} />);

    expect(screen.getByText(/Invoice INV-100/)).toBeInTheDocument();
    expect(mocks.useLienWaiverOrphanInvoices).toHaveBeenLastCalledWith("waiver-1", { page: 1 }, true);
  });

  it("renders the server-supplied paired invoice and unlinks its exact id", async () => {
    const user = userEvent.setup();
    const onLinkedInvoiceChange = vi.fn();
    mocks.useLienWaiverOrphanInvoices.mockReturnValue({
      data: { ...unpairedResponse, invoices: [], paired: { id: "invoice-7", fileName: "paired.pdf", vendorName: "Apex", vendorCode: "V100", amount: 2400, invoiceNumber: "INV-7", jobNumber: "24-017", status: "pending" } },
      isLoading: false, isError: false, error: null,
    });
    render(<LienWaiverPairingPanel record={makeWaiver()} linkedInvoiceId="invoice-stale" onLinkedInvoiceChange={onLinkedInvoiceChange} />);

    expect(screen.getByText("Invoice INV-7 · 24-017 · $2,400.00")).toBeInTheDocument();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const pairedSummary = screen.getByLabelText("Paired invoice");
    expect(pairedSummary).toHaveClass("items-center", "border-emerald-300", "bg-emerald-50/70");
    expect(screen.getByText("Paired to invoice")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(open).toHaveBeenCalledWith("/accounting/invoices/invoice-7", "_blank");
    await user.click(screen.getByRole("button", { name: "Change" }));

    expect(mocks.unlinkMutate.mock.calls[0]?.[0]).toEqual({ invoiceId: "invoice-7", waiverId: "waiver-1" });
    expect(onLinkedInvoiceChange).toHaveBeenCalledWith(null);
    open.mockRestore();
  });

  it("keeps an approved paired invoice visible but disables Unlink with an accessible reason", async () => {
    const user = userEvent.setup();
    const onLinkedInvoiceChange = vi.fn();
    mocks.useLienWaiverOrphanInvoices.mockReturnValue({
      data: { ...unpairedResponse, invoices: [], paired: { id: "invoice-7", fileName: "approved.pdf", vendorName: "Apex", vendorCode: "V100", amount: 2400, invoiceNumber: "INV-7", jobNumber: "24-017", status: "approved" } },
      isLoading: false, isError: false, error: null,
    });
    render(<LienWaiverPairingPanel record={makeWaiver()} linkedInvoiceId="invoice-7" onLinkedInvoiceChange={onLinkedInvoiceChange} />);

    const changeButton = screen.getByRole("button", { name: "Change" });
    expect(changeButton).toBeDisabled();
    await user.hover(changeButton.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Approved invoices are locked — unapprove first to change waiver linkage.");
    expect(mocks.unlinkMutate).not.toHaveBeenCalled();
  });

  it("toasts a stale reverse link refusal verbatim", async () => {
    const user = userEvent.setup();
    let linkCallbacks: { onError?: (error: unknown) => void } | undefined;
    mocks.linkMutate.mockImplementationOnce((_variables, callbacks) => {
      linkCallbacks = callbacks;
    });
    render(<LienWaiverPairingPanel record={makeWaiver()} linkedInvoiceId={null} onLinkedInvoiceChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Pair Apex invoice INV-100/i }));
    act(() => linkCallbacks?.onError?.({ status: 409, code: "WAIVER_PARENT_STATUS_PROTECTED", message: "The selected invoice was approved." }));

    expect(mocks.toastError).toHaveBeenCalledWith("The selected invoice was approved.");
    expect(screen.queryByText("The selected invoice was approved.")).not.toBeInTheDocument();
  });

  it("toasts a stale reverse unlink refusal verbatim", async () => {
    const user = userEvent.setup();
    let unlinkCallbacks: { onError?: (error: unknown) => void } | undefined;
    mocks.useLienWaiverOrphanInvoices.mockReturnValue({
      data: { ...unpairedResponse, invoices: [], paired: { id: "invoice-7", fileName: "paired.pdf", vendorName: "Apex", vendorCode: "V100", amount: 2400, invoiceNumber: "INV-7", jobNumber: "24-017", status: "pending" } },
      isLoading: false, isError: false, error: null,
    });
    mocks.unlinkMutate.mockImplementationOnce((_variables, callbacks) => {
      unlinkCallbacks = callbacks;
    });
    render(<LienWaiverPairingPanel record={makeWaiver()} linkedInvoiceId="invoice-7" onLinkedInvoiceChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Change" }));
    act(() => unlinkCallbacks?.onError?.({ status: 409, code: "WAIVER_PARENT_STATUS_PROTECTED", message: "The paired invoice was approved." }));

    expect(mocks.toastError).toHaveBeenCalledWith("The paired invoice was approved.");
  });

  it("binds search and pagination to the scoped orphan-invoices query", async () => {
    vi.useFakeTimers();
    mocks.useLienWaiverOrphanInvoices.mockReturnValue({
      data: { ...unpairedResponse, total: 11 },
      isLoading: false,
      isError: false,
      error: null,
    });
    render(<LienWaiverPairingPanel record={makeWaiver()} linkedInvoiceId={null} onLinkedInvoiceChange={vi.fn()} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search invoices" }), { target: { value: "INV-100" } });
    act(() => vi.advanceTimersByTime(300));

    expect(mocks.useLienWaiverOrphanInvoices).toHaveBeenLastCalledWith(
      "waiver-1",
      { page: 1, q: "INV-100" },
      true,
    );
  });
});
