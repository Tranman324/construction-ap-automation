import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LienWaiverMissingNotice } from "@/modules/accounting/modules/invoices/components/invoices/LienWaiverMissingNotice";
import type { Invoice, WaiverActionState } from "@/modules/accounting/modules/invoices/types/invoice";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  override: vi.fn(),
  revertOverride: vi.fn(),
  bypass: vi.fn(),
  revertBypass: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  recipientRefetch: vi.fn(),
  addContact: vi.fn(),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useRequestWaiver: () => ({ mutateAsync: mocks.request, isPending: false }),
  useAddWaiverContact: () => ({ mutateAsync: mocks.addContact, isPending: false }),
  useSetWaiverOverride: () => ({ mutate: mocks.override, isPending: false }),
  useRevertWaiverOverride: () => ({ mutate: mocks.revertOverride, isPending: false, error: null }),
  useSetWaiverBypass: () => ({ mutate: mocks.bypass, isPending: false, error: null }),
  useRevertWaiverBypass: () => ({ mutate: mocks.revertBypass, isPending: false, error: null }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useWaiverRecipient: () => ({ refetch: mocks.recipientRefetch, isFetching: false }),
}));

vi.mock("@/modules/shared/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));

function waiverActions(overrides: Partial<WaiverActionState> = {}): WaiverActionState {
  return {
    request: { permitted: true, blockers: [] },
    resend: { permitted: false, blockers: [{ code: "WAIVER_REQUEST_NOT_SENT", message: "No prior lien waiver request is available to resend." }] },
    markOnDocument: { permitted: true, blockers: [] },
    clearOnDocument: { permitted: false, blockers: [{ code: "WAIVER_NOT_ON_DOCUMENT", message: "No waiver-on-document marker is set." }] },
    bypass: { permitted: true, blockers: [] },
    revertBypass: { permitted: false, blockers: [{ code: "WAIVER_ALREADY_REQUIRED", message: "A lien waiver is already required for this document." }] },
    bypassHint: { count: 0, show: false },
    ...overrides,
  };
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice-1",
    classification: "invoice",
    confidence: 0.98,
    file: "invoice.pdf",
    email: {
      messageId: "message-1",
      from: "vendor@example.com",
      subject: "Invoice",
      receivedAt: "2026-07-14T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-07-14T12:00:00.000Z",
    extracted: null,
    matching: null,
    overallConfidence: 0.98,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    lienWaiverRequired: true,
    waiverActions: waiverActions(),
    ...overrides,
  };
}

describe("LienWaiverMissingNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.request.mockResolvedValue({
      success: true,
      sentTo: "vendor@example.com",
      requestedAt: "2026-07-14T12:30:00.000Z",
    });
    mocks.recipientRefetch.mockResolvedValue({
      data: {
        recipientType: "direct",
        directEmail: "vendor@example.com",
        candidates: [],
        cachedVendorEmail: null,
        emailFrom: "vendor@example.com",
        reason: "Direct vendor email",
        directoryContacts: [],
      },
      error: null,
    });
  });

  it("requests a waiver on the original email thread", async () => {
    const user = userEvent.setup();
    render(<LienWaiverMissingNotice invoice={makeInvoice()} />);

    await user.click(screen.getByRole("button", { name: "Request" }));

    expect(mocks.request).toHaveBeenCalledWith({ invoiceId: "invoice-1" });
    expect(mocks.success).toHaveBeenCalledWith("Waiver request sent", expect.any(Object));
  });

  it("confirms a parsed recipient and sends the override", async () => {
    const user = userEvent.setup();
    mocks.recipientRefetch.mockResolvedValueOnce({
      data: {
        recipientType: "parsed",
        directEmail: null,
        candidates: [{ email: "ap@vendor.test", source: "forwarded_header" }],
        cachedVendorEmail: null,
        emailFrom: "mreyes@northwindcg.example",
        reason: "Internal forward from mreyes@northwindcg.example",
        directoryContacts: [],
      },
      error: null,
    });
    render(<LienWaiverMissingNotice invoice={makeInvoice()} />);

    await user.click(screen.getByRole("button", { name: "Request" }));
    expect(await screen.findByText("Confirm waiver recipient")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(mocks.request).toHaveBeenCalledWith({
      invoiceId: "invoice-1",
      recipientOverride: "ap@vendor.test",
    });
  });

  it("sends a selected directory contact only after final Send", async () => {
    const user = userEvent.setup();
    mocks.recipientRefetch.mockResolvedValueOnce({
      data: {
        recipientType: "parsed",
        directEmail: null,
        candidates: [],
        cachedVendorEmail: null,
        emailFrom: "mreyes@northwindcg.example",
        reason: "Internal forward",
        directoryContacts: [{ email: "directory@vendor.test", name: "Directory AP", source: "observed", lastSeenAt: null }],
      },
      error: null,
    });
    render(<LienWaiverMissingNotice invoice={makeInvoice()} />);

    await user.click(screen.getByRole("button", { name: "Request" }));
    await user.click(await screen.findByRole("option"));
    expect(mocks.request).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(mocks.request).toHaveBeenCalledWith({ invoiceId: "invoice-1", recipientOverride: "directory@vendor.test" });
  });

  it.each([
    [400, "That email is not allowed for this vendor."],
    [422, "A vendor contact name is required."],
  ])("shows a %s add-contact message once without a toast", async (status, message) => {
    const user = userEvent.setup();
    mocks.recipientRefetch.mockResolvedValueOnce({
      data: {
        recipientType: "parsed",
        directEmail: null,
        candidates: [],
        cachedVendorEmail: null,
        emailFrom: "mreyes@northwindcg.example",
        reason: "Internal forward",
        directoryContacts: [],
      },
      error: null,
    });
    mocks.addContact.mockRejectedValueOnce({ status, message });
    render(<LienWaiverMissingNotice invoice={makeInvoice()} />);

    await user.click(screen.getByRole("button", { name: "Request" }));
    await user.click(await screen.findByRole("button", { name: "Add Contact" }));
    await user.type(screen.getByLabelText("Email"), "ap@vendor.test");
    await user.click(screen.getByRole("button", { name: "Save Contact" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("shows resend state and the prior request timestamp", () => {
    render(<LienWaiverMissingNotice invoice={makeInvoice({
      waiverRequestedAt: "2026-07-14T12:30:00.000Z",
      waiverActions: waiverActions({
        request: { permitted: false, blockers: [{ code: "WAIVER_REQUEST_ALREADY_SENT", message: "A lien waiver request was already sent; use resend instead." }] },
        resend: { permitted: true, blockers: [] },
      }),
    })} />);

    expect(screen.getByRole("button", { name: "Resend" })).toBeInTheDocument();
    expect(screen.getByText(/Waiver requested/)).toBeInTheDocument();
  });

  it("sends an explicit resend request from the dedicated action", async () => {
    const user = userEvent.setup();
    render(<LienWaiverMissingNotice invoice={makeInvoice({
      waiverRequestedAt: "2026-07-14T12:30:00.000Z",
      waiverActions: waiverActions({
        request: { permitted: false, blockers: [{ code: "WAIVER_REQUEST_ALREADY_SENT", message: "A lien waiver request was already sent; use resend instead." }] },
        resend: { permitted: true, blockers: [] },
      }),
    })} />);

    await user.click(screen.getByRole("button", { name: "Resend" }));

    expect(mocks.request).toHaveBeenCalledWith({ invoiceId: "invoice-1", resend: true });
    expect(mocks.success).toHaveBeenCalledWith("Waiver request resent", expect.any(Object));
  });

  it("confirms before resending after a stale 409 response", async () => {
    const user = userEvent.setup();
    mocks.request
      .mockRejectedValueOnce({
        status: 409,
        message: "A waiver request was already sent 2026-07-14T12:30:00.000Z. Pass resend to send another.",
      })
      .mockResolvedValueOnce({
        success: true,
        sentTo: "vendor@example.com",
        requestedAt: "2026-07-14T13:00:00.000Z",
      });
    render(<LienWaiverMissingNotice invoice={makeInvoice()} />);

    await user.click(screen.getByRole("button", { name: "Request" }));

    expect(await screen.findByText(/already sent on Jul 14, 2026/)).toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Send Again" }));

    expect(mocks.request).toHaveBeenLastCalledWith({ invoiceId: "invoice-1", resend: true });
  });

  it("uses the server blocker when the source email is unavailable", () => {
    render(<LienWaiverMissingNotice invoice={makeInvoice({
      email: { from: "vendor@example.com", subject: "Invoice", receivedAt: "2026-07-14T12:00:00.000Z" },
      waiverActions: waiverActions({
        request: { permitted: false, blockers: [{ code: "WAIVER_SOURCE_EMAIL_MISSING", message: "No source email is available for this document." }] },
      }),
    })} />);

    expect(screen.getByRole("button", { name: "Request" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Attached" })).toBeInTheDocument();
  });
});
