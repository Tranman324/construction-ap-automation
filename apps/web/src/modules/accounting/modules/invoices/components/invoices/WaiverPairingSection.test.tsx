import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Eye } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WaiverPairingSection } from "@/modules/accounting/modules/invoices/components/invoices/WaiverPairingSection";
import { PanelNoticeProvider, PanelNoticeOutlet, PanelNoticeObserver } from "../documents/PanelNotice";
import type { InvoiceOrphanWaiversResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice, WaiverActionState } from "@/modules/accounting/modules/invoices/types/invoice";

const mocks = vi.hoisted(() => ({
  useInvoiceOrphanWaivers: vi.fn(),
  useWaiverRecipient: vi.fn(),
  linkMutate: vi.fn(),
  unlinkMutate: vi.fn(),
  revertOverrideMutate: vi.fn(),
  setOverrideMutate: vi.fn(),
  setBypassMutate: vi.fn(),
  revertBypassMutate: vi.fn(),
  requestMutateAsync: vi.fn(),
  createCommentMutateAsync: vi.fn(),
  recipientRefetch: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/accounting/modules/invoices/hooks/queries")>()),
  useInvoiceOrphanWaivers: mocks.useInvoiceOrphanWaivers,
  useWaiverRecipient: mocks.useWaiverRecipient,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useLinkWaiver: () => ({ mutate: mocks.linkMutate, isPending: false }),
  useUnlinkWaiver: () => ({ mutate: mocks.unlinkMutate, isPending: false }),
  useRevertWaiverOverride: () => ({ mutate: mocks.revertOverrideMutate, isPending: false }),
  useSetWaiverOverride: () => ({ mutate: mocks.setOverrideMutate, isPending: false }),
  useSetWaiverBypass: () => ({ mutate: mocks.setBypassMutate, isPending: false }),
  useRevertWaiverBypass: () => ({ mutate: mocks.revertBypassMutate, isPending: false }),
  useRequestWaiver: () => ({ mutateAsync: mocks.requestMutateAsync, isPending: false }),
  useCreateComment: () => ({ mutateAsync: mocks.createCommentMutateAsync, isPending: false, error: null }),
}));

vi.mock("@/modules/shared/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: { error: mocks.toastError },
}));

function waiverActions(overrides: Partial<Invoice>): WaiverActionState {
  const attached = overrides.waiverOnDocument === true;
  const bypassed = overrides.lienWaiverRequired === false;
  return {
    request: { permitted: true, blockers: [] },
    resend: { permitted: false, blockers: [{ code: "WAIVER_REQUEST_NOT_SENT", message: "No prior lien waiver request is available to resend." }] },
    markOnDocument: attached
      ? { permitted: false, blockers: [{ code: "WAIVER_ALREADY_ON_DOCUMENT", message: "A waiver is already marked as present on this document." }] }
      : { permitted: true, blockers: [] },
    clearOnDocument: attached
      ? { permitted: true, blockers: [] }
      : { permitted: false, blockers: [{ code: "WAIVER_NOT_ON_DOCUMENT", message: "No waiver-on-document marker is set." }] },
    bypass: bypassed
      ? { permitted: false, blockers: [{ code: "WAIVER_NOT_REQUIRED", message: "A lien waiver is not currently required for this document." }] }
      : { permitted: true, blockers: [] },
    revertBypass: bypassed
      ? { permitted: true, blockers: [] }
      : { permitted: false, blockers: [{ code: "WAIVER_ALREADY_REQUIRED", message: "A lien waiver is already required for this document." }] },
    bypassHint: { count: 0, show: false },
  };
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1", classification: "invoice", confidence: 0.91, file: "invoice.pdf",
    email: { messageId: "message-1", from: "accounting@example.com", subject: "Invoice", receivedAt: "2026-07-01T12:00:00.000Z" },
    status: "pending", queuedAt: "2026-07-01T12:00:00.000Z", extracted: null, matching: null,
    overallConfidence: 0.91, splitFrom: null, duplicateOf: null, reason: null, error: null,
    reclassifiedFrom: null, reclassifiedAt: null, lienWaiverStatus: "missing", lienWaiverRequired: true,
    linkedLienWaiverId: null, waiverActions: waiverActions(overrides), ...overrides,
  };
}

const unpairedResponse: InvoiceOrphanWaiversResponse = {
  target: { id: "inv-1", fileName: "invoice.pdf", vendorName: "Apex", vendorCode: "V100", amount: 100, invoiceNumber: "INV-1", jobNumber: "24-017", status: "pending", receivedAt: null },
  paired: null,
  waivers: [{ id: "waiver-1", fileName: "waiver.pdf", vendorName: "Apex", vendorCode: "V100", amount: 100, invoiceNumber: null, jobNumber: "24-017", status: "filed", receivedAt: null }],
  total: 1,
  page: 1,
  limit: 10,
};

describe("WaiverPairingSection", () => {
  beforeEach(() => {
    mocks.linkMutate.mockReset();
    mocks.unlinkMutate.mockReset();
    mocks.revertOverrideMutate.mockReset();
    mocks.setOverrideMutate.mockReset();
    mocks.setBypassMutate.mockReset();
    mocks.revertBypassMutate.mockReset();
    mocks.requestMutateAsync.mockResolvedValue({ success: true, sentTo: "vendor@example.com", requestedAt: "2026-07-01T12:30:00.000Z" });
    mocks.toastError.mockReset();
    mocks.useWaiverRecipient.mockReturnValue({ isFetching: false, refetch: mocks.recipientRefetch });
    mocks.recipientRefetch.mockResolvedValue({ data: { recipientType: "direct", directEmail: "vendor@example.com", candidates: [], cachedVendorEmail: null, emailFrom: "vendor@example.com", reason: "Direct", directoryContacts: [] }, error: null });
    mocks.useInvoiceOrphanWaivers.mockReturnValue({ data: unpairedResponse, isLoading: false, isError: false, error: null });
    mocks.linkMutate.mockImplementation((_variables, callbacks) => callbacks?.onSuccess?.());
    mocks.unlinkMutate.mockImplementation((_variables, callbacks) => callbacks?.onSuccess?.());
  });

  afterEach(() => vi.useRealTimers());

  it("portals a link failure without moving candidates or changing the mutation", async () => {
    mocks.linkMutate.mockImplementation((_variables, callbacks) => callbacks?.onError?.(new Error("Synthetic pairing failure")));
    const onNotices = vi.fn();
    render(
      <PanelNoticeProvider documentId="inv-1">
        <div data-testid="waiver-source"><WaiverPairingSection invoice={makeInvoice()} /></div>
        <div data-testid="notice-target"><PanelNoticeOutlet /></div>
        <PanelNoticeObserver onChange={onNotices} />
      </PanelNoticeProvider>,
    );
    const source = within(screen.getByTestId("waiver-source"));
    const target = within(screen.getByTestId("notice-target"));
    expect(source.getByText("waiver.pdf")).toBeInTheDocument();
    expect(target.queryByText("waiver.pdf")).not.toBeInTheDocument();
    await userEvent.click(source.getByRole("button", { name: "Link" }));
    expect(mocks.linkMutate.mock.calls[0][0]).toEqual({ invoiceId: "inv-1", waiverId: "waiver-1" });
    expect(target.getByText("Synthetic pairing failure")).toBeInTheDocument();
    expect(onNotices).toHaveBeenLastCalledWith([expect.objectContaining({ id: "waiver-pairing-error", tabId: "waiver", resolved: false })]);
    expect(source.queryByText("Synthetic pairing failure")).not.toBeInTheDocument();
  });

  it("portals query errors only when the original list would render an error", () => {
    mocks.useInvoiceOrphanWaivers.mockReturnValue({ data: unpairedResponse, isLoading: false, isError: true, error: new Error("Synthetic query failure") });
    const view = () => (
      <PanelNoticeProvider documentId="inv-1">
        <div data-testid="waiver-source"><WaiverPairingSection invoice={makeInvoice()} /></div>
        <div data-testid="notice-target"><PanelNoticeOutlet /></div>
      </PanelNoticeProvider>
    );
    const { rerender } = render(view());
    expect(within(screen.getByTestId("notice-target")).getByText("Synthetic query failure")).toBeInTheDocument();
    mocks.useInvoiceOrphanWaivers.mockReturnValue({ data: unpairedResponse, isLoading: true, isError: true, error: new Error("Synthetic query failure") });
    rerender(view());
    expect(screen.queryByText("Synthetic query failure")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("waiver-source")).getByLabelText("Loading lien waivers")).toBeInTheDocument();
  });

  it("lists resource-scoped waiver candidates and links manually", async () => {
    const user = userEvent.setup();
    render(<WaiverPairingSection invoice={makeInvoice()} />);

    expect(screen.getByText("waiver.pdf")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Link" }));

    expect(mocks.linkMutate.mock.calls[0]?.[0]).toEqual({ invoiceId: "inv-1", waiverId: "waiver-1" });
  });

  it("keeps approved invoice candidates visible but disables Link with an accessible reason", async () => {
    const user = userEvent.setup();
    render(<WaiverPairingSection invoice={makeInvoice({ status: "approved" })} />);

    const linkButton = screen.getByRole("button", { name: "Link" });
    expect(linkButton).toBeDisabled();
    await user.hover(linkButton.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Approved invoices are locked — unapprove first to change waiver linkage.");
    expect(mocks.linkMutate).not.toHaveBeenCalled();
  });

  it.each([
    ["bypassed", { lienWaiverRequired: false }],
    ["attached", { lienWaiverStatus: "attached" as const, waiverOnDocument: true }],
  ])("does not offer orphan waiver linking when the invoice is %s", (_state, overrides) => {
    render(<WaiverPairingSection invoice={makeInvoice(overrides)} />);

    expect(screen.queryByText("waiver.pdf")).not.toBeInTheDocument();
    expect(screen.getByText("Lien waiver linking is not needed for this invoice.")).toBeInTheDocument();
    expect(mocks.useInvoiceOrphanWaivers).toHaveBeenLastCalledWith("inv-1", { page: 1 }, false);
  });

  it("keeps the server-paired card available when a bypassed invoice has a linked waiver", () => {
    mocks.useInvoiceOrphanWaivers.mockReturnValue({
      data: { ...unpairedResponse, waivers: [], paired: { id: "waiver-7", fileName: "paired-waiver.pdf", vendorName: "Apex", vendorCode: "V100", amount: 100, invoiceNumber: null, jobNumber: "24-017", status: "filed" } },
      isLoading: false, isError: false, error: null,
    });

    render(<WaiverPairingSection invoice={makeInvoice({ lienWaiverRequired: false, linkedLienWaiverId: "waiver-7" })} />);

    expect(screen.getByText("paired-waiver.pdf")).toBeInTheDocument();
    expect(mocks.useInvoiceOrphanWaivers).toHaveBeenLastCalledWith("inv-1", { page: 1 }, true);
  });

  it("renders only the server paired summary and unlinks that counterpart", async () => {
    const user = userEvent.setup();
    mocks.useInvoiceOrphanWaivers.mockReturnValue({
      data: { ...unpairedResponse, waivers: [], paired: { id: "waiver-7", fileName: "paired-waiver.pdf", vendorName: "Apex", vendorCode: "V100", amount: 100, invoiceNumber: null, jobNumber: "24-017", status: "filed" } },
      isLoading: false, isError: false, error: null,
    });
    render(<WaiverPairingSection invoice={makeInvoice({ linkedLienWaiverId: "waiver-7" })} />);

    expect(screen.getByText("paired-waiver.pdf")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Unlink" }));

    expect(mocks.unlinkMutate.mock.calls[0]?.[0]).toEqual({ invoiceId: "inv-1", waiverId: "waiver-7" });
  });

  it("keeps an approved invoice's paired unlink visible but disabled", async () => {
    const user = userEvent.setup();
    mocks.useInvoiceOrphanWaivers.mockReturnValue({
      data: { ...unpairedResponse, waivers: [], paired: { id: "waiver-7", fileName: "paired-waiver.pdf", vendorName: "Apex", vendorCode: "V100", amount: 100, invoiceNumber: null, jobNumber: "24-017", status: "filed" } },
      isLoading: false, isError: false, error: null,
    });
    render(<WaiverPairingSection invoice={makeInvoice({ status: "approved", linkedLienWaiverId: "waiver-7" })} />);

    const unlinkButton = screen.getByRole("button", { name: "Unlink" });
    expect(unlinkButton).toBeDisabled();
    await user.hover(unlinkButton.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Approved invoices are locked — unapprove first to change waiver linkage.");
    expect(mocks.unlinkMutate).not.toHaveBeenCalled();
  });

  it("keeps approved compact unlink visible but disabled with its accessible reason", async () => {
    const user = userEvent.setup();
    mocks.useInvoiceOrphanWaivers.mockReturnValue({
      data: { ...unpairedResponse, waivers: [], paired: { id: "waiver-7", fileName: "paired-waiver.pdf", vendorName: "Apex", vendorCode: "V100", amount: 100, invoiceNumber: null, jobNumber: "24-017", status: "filed" } },
      isLoading: false, isError: false, error: null,
    });
    render(
      <WaiverPairingSection
        invoice={makeInvoice({ status: "approved", linkedLienWaiverId: "waiver-7" })}
        compact
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));
    const unlinkAction = screen.getByRole("menuitem", { name: "Unlink Waiver" });
    expect(unlinkAction).toHaveAttribute("aria-disabled", "true");
    await user.hover(unlinkAction.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Approved invoices are locked — unapprove first to change waiver linkage.");
    await user.click(unlinkAction);
    expect(mocks.unlinkMutate).not.toHaveBeenCalled();
  });

  it("toasts the verbatim stale link refusal without replacing the inline fallback path", async () => {
    const user = userEvent.setup();
    let linkCallbacks: { onError?: (error: unknown) => void } | undefined;
    mocks.linkMutate.mockImplementationOnce((_variables, callbacks) => {
      linkCallbacks = callbacks;
    });
    render(<WaiverPairingSection invoice={makeInvoice()} />);

    await user.click(screen.getByRole("button", { name: "Link" }));
    act(() => linkCallbacks?.onError?.({ status: 409, code: "WAIVER_PARENT_STATUS_PROTECTED", message: "Invoice was approved while you were pairing it." }));

    expect(mocks.toastError).toHaveBeenCalledWith("Invoice was approved while you were pairing it.");
    expect(screen.queryByText("Invoice was approved while you were pairing it.")).not.toBeInTheDocument();
  });

  it("keeps unrelated link errors in the existing inline fallback", async () => {
    const user = userEvent.setup();
    let linkCallbacks: { onError?: (error: unknown) => void } | undefined;
    mocks.linkMutate.mockImplementationOnce((_variables, callbacks) => {
      linkCallbacks = callbacks;
    });
    render(<WaiverPairingSection invoice={makeInvoice()} />);

    await user.click(screen.getByRole("button", { name: "Link" }));
    act(() => linkCallbacks?.onError?.({ status: 409, code: "OTHER_CONFLICT", message: "Link failed for another reason." }));

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(screen.getByText("Link failed for another reason.")).toBeInTheDocument();
  });

  it("toasts a stale paired unlink refusal verbatim", async () => {
    const user = userEvent.setup();
    let unlinkCallbacks: { onError?: (error: unknown) => void } | undefined;
    mocks.useInvoiceOrphanWaivers.mockReturnValue({
      data: { ...unpairedResponse, waivers: [], paired: { id: "waiver-7", fileName: "paired-waiver.pdf", vendorName: "Apex", vendorCode: "V100", amount: 100, invoiceNumber: null, jobNumber: "24-017", status: "filed" } },
      isLoading: false, isError: false, error: null,
    });
    mocks.unlinkMutate.mockImplementationOnce((_variables, callbacks) => {
      unlinkCallbacks = callbacks;
    });
    render(<WaiverPairingSection invoice={makeInvoice({ linkedLienWaiverId: "waiver-7" })} />);

    await user.click(screen.getByRole("button", { name: "Unlink" }));
    act(() => unlinkCallbacks?.onError?.({ status: 409, code: "WAIVER_PARENT_STATUS_PROTECTED", message: "Invoice approval is now locked." }));

    expect(mocks.toastError).toHaveBeenCalledWith("Invoice approval is now locked.");
  });

  it("does not expose document-level waiver marking in compact actions", async () => {
    const user = userEvent.setup();
    render(
      <WaiverPairingSection
        invoice={makeInvoice()}
        compact
        compactActions={[{ id: "existing-action", label: "Existing action", icon: Eye, onClick: vi.fn() }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));

    expect(screen.queryByRole("menuitem", { name: "Waiver on Document" })).not.toBeInTheDocument();
    expect(mocks.revertOverrideMutate).not.toHaveBeenCalled();
  });

  it("binds search and pagination to the resource-scoped waiver query", async () => {
    vi.useFakeTimers();
    render(<WaiverPairingSection invoice={makeInvoice()} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search lien waivers" }), { target: { value: "Apex" } });
    act(() => vi.advanceTimersByTime(300));

    expect(mocks.useInvoiceOrphanWaivers).toHaveBeenLastCalledWith(
      "inv-1",
      { page: 1, q: "Apex" },
      true,
    );
    expect(screen.getByText("1 result")).toBeInTheDocument();
  });

  it("keeps pairing focused on candidates for pay-application workflow documents", () => {
    render(<WaiverPairingSection invoice={makeInvoice({ classification: "pay-application" })} />);

    expect(screen.getByText("waiver.pdf")).toBeInTheDocument();
    expect(mocks.useInvoiceOrphanWaivers).toHaveBeenLastCalledWith(
      "inv-1",
      { page: 1 },
      true,
    );
    expect(screen.queryByRole("button", { name: "Request" })).not.toBeInTheDocument();
  });
});
