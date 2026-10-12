import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WaiverStatusActions } from "@/modules/accounting/modules/invoices/components/invoices/WaiverStatusActions";
import type { Invoice, WaiverActionState } from "@/modules/accounting/modules/invoices/types/invoice";

const mocks = vi.hoisted(() => ({
  setBypass: vi.fn(),
  revertBypass: vi.fn(),
  setOverride: vi.fn(),
  revertOverride: vi.fn(),
  setBypassError: null as Error | null,
  revertOverrideError: null as Error | null,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useSetWaiverBypass: () => ({ mutate: mocks.setBypass, isPending: false, error: mocks.setBypassError }),
  useRevertWaiverBypass: () => ({ mutate: mocks.revertBypass, isPending: false, error: null }),
  useSetWaiverOverride: () => ({ mutate: mocks.setOverride, isPending: false, error: null }),
  useRevertWaiverOverride: () => ({ mutate: mocks.revertOverride, isPending: false, error: mocks.revertOverrideError }),
}));
function actions(overrides: Partial<WaiverActionState> = {}): WaiverActionState {
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

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice-1", classification: "invoice", confidence: 1, file: "invoice.pdf", status: "pending", queuedAt: "2026-07-01T00:00:00.000Z",
    email: { messageId: "message-1", from: "vendor@example.com", subject: "Invoice", receivedAt: "2026-07-01T00:00:00.000Z" },
    extracted: null, matching: null, overallConfidence: 1, splitFrom: null, duplicateOf: null, reason: null, error: null, reclassifiedFrom: null, reclassifiedAt: null,
    lienWaiverRequired: true, waiverActions: actions(), ...overrides,
  };
}

describe("WaiverStatusActions", () => {
  afterEach(() => {
    mocks.setBypass.mockClear();
    mocks.revertBypass.mockClear();
    mocks.setOverride.mockClear();
    mocks.revertOverride.mockClear();
    mocks.setBypassError = null;
    mocks.revertOverrideError = null;
  });

  it("uses all six concise action strings in tooltips", async () => {
    const user = userEvent.setup();
    const expectTooltip = async (value: Invoice, buttonName: string, description: string) => {
      cleanup();
      render(<WaiverStatusActions invoice={value} requestPending={false} recipientPending={false} onRequest={vi.fn()} />);

      await user.hover(screen.getByRole("button", { name: buttonName }));
      expect((await screen.findAllByText(description)).length).toBeGreaterThan(0);
    };
    const resolvedActions = actions({
      request: { permitted: false, blockers: [] },
      resend: { permitted: true, blockers: [] },
      markOnDocument: { permitted: false, blockers: [] },
      clearOnDocument: { permitted: true, blockers: [] },
      bypass: { permitted: false, blockers: [] },
      revertBypass: { permitted: true, blockers: [] },
    });

    await expectTooltip(invoice(), "Request", "Send a lien waiver request email to the vendor");
    await expectTooltip(invoice(), "Attached", "Mark that the waiver is already inside this PDF");
    await expectTooltip(invoice(), "Bypass", "Record that no lien waiver is required");
    await expectTooltip(invoice({ waiverRequestedAt: "2026-08-03T12:00:00.000Z", waiverActions: resolvedActions }), "Resend", "Resend the lien waiver request email");
    await expectTooltip(invoice({ waiverOnDocument: true, waiverActions: resolvedActions }), "Clear", "Remove the waiver-on-document marker");
    await expectTooltip(invoice({ lienWaiverRequired: false, waiverActions: resolvedActions }), "Undo Bypass", "Restore the lien waiver requirement");
  });

  it("uses the shared amber warning button variant when a waiver is missing", () => {
    render(<WaiverStatusActions invoice={invoice()} requestPending={false} recipientPending={false} onRequest={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Request" })).toHaveAttribute("data-variant", "warning");
    expect(screen.getByRole("button", { name: "Attached" })).toHaveAttribute("data-variant", "warning");
    expect(screen.getByRole("button", { name: "Bypass" })).toHaveAttribute("data-variant", "warning");
  });

  it("renders the server-provided vendor bypass hint with exact count copy", () => {
    render(<WaiverStatusActions invoice={invoice({
      waiverActions: actions({ bypassHint: { count: 3, show: true } }),
    })} requestPending={false} recipientPending={false} onRequest={vi.fn()} />);

    expect(screen.getByText("This vendor has been bypassed 3× since their last attached waiver — consider requesting a waiver instead.")).toBeInTheDocument();
  });

  it("does not render the hint when show is false, even when count is nonzero", () => {
    render(<WaiverStatusActions invoice={invoice({
      waiverActions: actions({ bypassHint: { count: 4, show: false } }),
    })} requestPending={false} recipientPending={false} onRequest={vi.fn()} />);

    expect(screen.queryByText(/This vendor has been bypassed/)).not.toBeInTheDocument();
  });

  it("does not render a hint when waiver actions are absent", () => {
    render(<WaiverStatusActions invoice={invoice({ waiverActions: undefined })} requestPending={false} recipientPending={false} onRequest={vi.fn()} />);

    expect(screen.queryByText(/This vendor has been bypassed/)).not.toBeInTheDocument();
  });

  it("keeps Bypass enabled and dispatches its existing mutation when the hint is shown", async () => {
    const user = userEvent.setup();
    render(<WaiverStatusActions invoice={invoice({
      waiverActions: actions({ bypassHint: { count: 2, show: true } }),
    })} requestPending={false} recipientPending={false} onRequest={vi.fn()} />);

    const bypassButton = screen.getByRole("button", { name: "Bypass" });
    expect(bypassButton).toBeEnabled();
    await user.click(bypassButton);
    expect(mocks.setBypass).toHaveBeenCalledWith({ invoiceId: "invoice-1" });
  });

  it("uses the reversible bypass mutation and keeps undo visible from canonical state", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<WaiverStatusActions invoice={invoice()} requestPending={false} recipientPending={false} onRequest={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Bypass" }));
    expect(mocks.setBypass).toHaveBeenCalledWith({ invoiceId: "invoice-1" });

    rerender(<WaiverStatusActions invoice={invoice({
      lienWaiverRequired: false,
      waiverActions: actions({
        bypass: { permitted: false, blockers: [{ code: "WAIVER_NOT_REQUIRED", message: "A lien waiver is not currently required for this document." }] },
        revertBypass: { permitted: true, blockers: [] },
      }),
    })} requestPending={false} recipientPending={false} onRequest={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Undo Bypass" }));
    expect(mocks.revertBypass).toHaveBeenCalledWith({ invoiceId: "invoice-1" });
  });

  it("does not infer Revert from a non-required legacy field", async () => {
    const user = userEvent.setup();
    render(<WaiverStatusActions invoice={invoice({
      lienWaiverRequired: false,
      waiverBypassed: false,
      waiverActions: actions(),
    })} requestPending={false} recipientPending={false} onRequest={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Bypass" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo Bypass" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Bypass" }));
    expect(mocks.setBypass).toHaveBeenCalledWith({ invoiceId: "invoice-1" });
    expect(mocks.revertBypass).not.toHaveBeenCalled();
  });

  it("keeps canonical blockers readable in the DOM and described by disabled actions", () => {
    render(<WaiverStatusActions invoice={invoice({
      waiverActions: actions({
        request: { permitted: false, blockers: [{ code: "WAIVER_REQUEST_FORBIDDEN", message: "You do not have permission to request a lien waiver." }] },
        markOnDocument: { permitted: false, blockers: [{ code: "WAIVER_APPROVAL_FORBIDDEN", message: "You do not have permission to mark a waiver on this document." }] },
        bypass: { permitted: false, blockers: [{ code: "WAIVER_APPROVAL_FORBIDDEN", message: "You do not have permission to bypass the lien waiver requirement." }] },
        bypassHint: { count: 7, show: true },
      }),
    })} requestPending={false} recipientPending={false} onRequest={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Request" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Attached" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bypass" })).toBeDisabled();
    expect(screen.getByText("You do not have permission to request a lien waiver.")).toBeInTheDocument();
    expect(screen.getByText("You do not have permission to mark a waiver on this document.")).toBeInTheDocument();
    expect(screen.getByText("You do not have permission to bypass the lien waiver requirement.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request" })).toHaveAttribute("aria-describedby");
    expect(screen.getByRole("button", { name: "Attached" })).toHaveAttribute("aria-describedby");
    expect(screen.getByRole("button", { name: "Bypass" })).toHaveAttribute("aria-describedby");
  });

  it("keeps a failed Clear error readable and described only by Clear", () => {
    mocks.revertOverrideError = new Error("The canonical waiver state changed.");
    render(<WaiverStatusActions invoice={invoice({
      waiverOnDocument: true,
      waiverActions: actions({
        markOnDocument: { permitted: false, blockers: [] },
        clearOnDocument: { permitted: true, blockers: [] },
      }),
    })} requestPending={false} recipientPending={false} onRequest={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("The canonical waiver state changed.");
    expect([
      screen.getByRole("button", { name: "Request" }).getAttribute("aria-describedby"),
      screen.getByRole("button", { name: "Bypass" }).getAttribute("aria-describedby"),
    ]).toEqual([null, null]);
    expect(screen.getByRole("button", { name: "Clear" })).toHaveAttribute("aria-describedby", "waiver-document-action-error");
  });

  it("keeps a failed Bypass error readable and described only by Bypass", () => {
    mocks.setBypassError = new Error("The canonical waiver requirement changed.");
    render(<WaiverStatusActions invoice={invoice()} requestPending={false} recipientPending={false} onRequest={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("The canonical waiver requirement changed.");
    expect([
      screen.getByRole("button", { name: "Request" }).getAttribute("aria-describedby"),
      screen.getByRole("button", { name: "Attached" }).getAttribute("aria-describedby"),
    ]).toEqual([null, null]);
    expect(screen.getByRole("button", { name: "Bypass" })).toHaveAttribute("aria-describedby", "waiver-bypass-action-error");
  });

  it("wraps action controls instead of forcing narrow panels to overflow", () => {
    render(<WaiverStatusActions invoice={invoice()} requestPending={false} recipientPending={false} onRequest={vi.fn()} />);

    expect(screen.getByText("Lien Waiver Missing").parentElement).toHaveClass("flex-wrap");
  });

  it("uses the canonical resend capability after the request cache is replaced", async () => {
    const user = userEvent.setup();
    const onRequest = vi.fn();
    const { rerender } = render(<WaiverStatusActions invoice={invoice()} requestPending={false} recipientPending={false} onRequest={onRequest} />);

    rerender(<WaiverStatusActions invoice={invoice({
      waiverRequestedAt: "2026-08-03T12:00:00.000Z",
      waiverActions: actions({
        request: { permitted: false, blockers: [{ code: "WAIVER_REQUEST_ALREADY_SENT", message: "A lien waiver request was already sent; use resend instead." }] },
        resend: { permitted: true, blockers: [] },
      }),
    })} requestPending={false} recipientPending={false} onRequest={onRequest} />);

    await user.click(screen.getByRole("button", { name: "Resend" }));
    expect(onRequest).toHaveBeenCalledWith(true);
  });

  it("keeps clear and undo controls available from canonical state", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<WaiverStatusActions invoice={invoice({
      waiverOnDocument: true,
      waiverActions: actions({
        markOnDocument: { permitted: false, blockers: [{ code: "WAIVER_ALREADY_ON_DOCUMENT", message: "A waiver is already marked as present on this document." }] },
        clearOnDocument: { permitted: true, blockers: [] },
      }),
    })} requestPending={false} recipientPending={false} onRequest={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(mocks.revertOverride).toHaveBeenCalledWith({ invoiceId: "invoice-1" });

    rerender(<WaiverStatusActions invoice={invoice({
      lienWaiverRequired: false,
      waiverActions: actions({
        bypass: { permitted: false, blockers: [{ code: "WAIVER_NOT_REQUIRED", message: "A lien waiver is not currently required for this document." }] },
        revertBypass: { permitted: true, blockers: [] },
      }),
    })} requestPending={false} recipientPending={false} onRequest={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Undo Bypass" }));
    expect(mocks.revertBypass).toHaveBeenCalledWith({ invoiceId: "invoice-1" });
  });
});
