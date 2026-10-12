import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InvoiceResolveRow } from "./invoiceResolveModel";
import { APPR, DEL, makeInvoice } from "./duplicateCardFixtures.testUtils";
const requestWaiver = vi.hoisted(() => vi.fn());
const granted = vi.hoisted(() => new Set<string>());

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useDuplicateBypass: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/modules/shared/components/ui/toaster", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasAnyPermission: (keys: string[]) => keys.some((key) => granted.has(key)) }),
}));

vi.mock("./LienWaiverMissingNotice", () => ({
  LienWaiverMissingNotice: () => (
    <div>
      <button type="button" onClick={requestWaiver}>Request</button>
      <button type="button">Resend</button>
      <button type="button">Attached</button>
      <button type="button">Bypass</button>
    </div>
  ),
}));

import { InvoiceResolveTray } from "./InvoiceResolveTray";

const invoice = makeInvoice({ id: "invoice-1" });
/** The duplicate card is the real model-driven card: Discard is a two-step action. */
const discardDuplicate = () => {
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm discard" }));
};
const rows: InvoiceResolveRow[] = [
  { id: "duplicate:invoice-1", kind: "duplicate", label: "Possible duplicate" },
  { id: "waiver:invoice-1", kind: "waiver", label: "Lien waiver", waiting: true },
];

beforeEach(() => {
  granted.clear();
  granted.add(DEL);
  granted.add(APPR);
});

describe("InvoiceResolveTray", () => {
  it("lets the dock grow with its content instead of creating an inner scrollbox", () => {
    render(<InvoiceResolveTray invoice={invoice} rows={rows} discardPending={false} onDiscard={vi.fn()} />);

    const tray = screen.getByTestId("invoice-resolve-tray");
    // 0461e840 moved the tray into FloatingResolveRegion's overlay (the region owns max-h/scroll), so the aside is no longer a flex child needing shrink-0.
    expect(tray).toBeVisible();
    expect(tray).not.toHaveClass("max-h-[45%]");
    expect(tray).not.toHaveClass("overflow-y-auto");
  });

  it("browses to waiver controls and back during a pending discard without resolving either card", async () => {
    let finish!: (confirmed: boolean) => void;
    const onDiscard = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const onDiscarded = vi.fn();
    render(<InvoiceResolveTray invoice={invoice} rows={rows} discardPending={false} onDiscard={onDiscard} onDiscarded={onDiscarded} />);
    discardDuplicate();
    fireEvent.click(screen.getByRole("button", { name: "Next issue" }));
    expect(screen.getByRole("button", { name: "Request" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    expect(requestWaiver).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("resolve-tray-count")).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: "Previous issue" }));
    expect(screen.getByRole("button", { name: /Discarding/ })).toBeVisible();
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onDiscarded).not.toHaveBeenCalled();
    await act(async () => { finish(false); });
    expect(onDiscarded).not.toHaveBeenCalled();
    expect(screen.getByTestId("resolve-tray-count")).toHaveTextContent("2");
  });
  it("renders an amber actionable recovery without discard animation or navigation", () => {
    const onUseSuggestedDate = vi.fn();
    const onDiscarded = vi.fn();
    const onDiscard = vi.fn();
    const recoveryRow: InvoiceResolveRow = {
      id: "closed-period:invoice-1", kind: "closed-period", label: "Closed period",
      recoveryAction: { invoiceId: "invoice-1", recovery: { invoiceDateMonth: "2026-07", currentMonth: "2026-08", suggestedInvoiceDate: "2026-08-01" }, disabled: false, onUseSuggestedDate },
    };
    const { rerender } = render(<InvoiceResolveTray invoice={invoice} rows={[recoveryRow, ...rows]} discardPending={false} onDiscard={onDiscard} onDiscarded={onDiscarded} />);
    fireEvent.click(screen.getByRole("button", { name: "Use 2026-08-01" }));
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next issue" }));
    expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
    expect(onUseSuggestedDate).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onDiscarded).not.toHaveBeenCalled();
    expect(screen.getByTestId("resolve-tray-count")).toHaveTextContent("3");
    rerender(<InvoiceResolveTray invoice={invoice} rows={rows} discardPending={false} onDiscard={onDiscard} onDiscarded={onDiscarded} />);
    expect(screen.queryByRole("button", { name: "Use 2026-08-01" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
    expect(onDiscarded).not.toHaveBeenCalled();
  });
  afterEach(() => vi.useRealTimers());

  it("collapses presentation without resolving rows and resets for a different invoice", () => {
    const onDiscard = vi.fn();
    const view = render(<InvoiceResolveTray invoice={invoice} rows={rows} discardPending={false} onDiscard={onDiscard} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse tray" }));
    expect(screen.getByRole("button", { name: "Expand tray" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("resolve-tray-count")).toHaveTextContent("2");
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
    expect(onDiscard).not.toHaveBeenCalled();
    view.rerender(<InvoiceResolveTray invoice={{ ...invoice }} rows={[...rows]} discardPending={false} onDiscard={onDiscard} />);
    expect(screen.getByRole("button", { name: "Expand tray" })).toBeInTheDocument();
    view.rerender(<InvoiceResolveTray invoice={{ ...invoice, id: "invoice-2" }} rows={rows} discardPending={false} onDiscard={onDiscard} />);
    expect(screen.getByRole("button", { name: "Collapse tray" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("keeps the waiting waiver counted and exposes controls only on the front card", () => {
    render(<InvoiceResolveTray invoice={invoice} rows={rows} discardPending={false} onDiscard={vi.fn()} />);

    expect(screen.getByTestId("resolve-tray-header")).toHaveTextContent("To resolve 2");
    expect(screen.getByText("1 waiting")).toBeVisible();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request" })).not.toBeInTheDocument();
  });

  it("does not dismiss a card when the domain discard fails", async () => {
    const onDiscard = vi.fn().mockResolvedValue(false);
    render(<InvoiceResolveTray invoice={invoice} rows={rows} discardPending={false} onDiscard={onDiscard} />);

    discardDuplicate();
    await waitFor(() => expect(onDiscard).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("resolve-tray-count")).toHaveTextContent("2");
  });

  it("hands confirmed resolution to the caller exactly once before the caller removes the row", async () => {
    vi.useFakeTimers();
    const onDiscarded = vi.fn();
    let finishDiscard!: (confirmed: boolean) => void;
    const onDiscard = vi.fn(() => new Promise<boolean>((resolve) => { finishDiscard = resolve; }));
    const view = render(<InvoiceResolveTray invoice={invoice} rows={rows} discardPending={false} onDiscard={onDiscard} onDiscarded={onDiscarded} />);

    const card = screen.getByTestId("duplicate-resolution-card");
    const discardButton = screen.getByRole("button", { name: "Discard" });
    discardDuplicate();
    fireEvent.click(screen.getByRole("button", { name: "Collapse tray" }));
    expect(discardButton).toBeInTheDocument();
    expect(discardButton).not.toBeVisible();
    expect(onDiscarded).not.toHaveBeenCalled();
    await act(async () => { finishDiscard(true); });
    fireEvent.click(screen.getByRole("button", { name: "Expand tray" }));
    expect(screen.getByTestId("duplicate-resolution-card")).toBe(card);
    expect(screen.getByRole("button", { name: "Discard" })).toBe(discardButton);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(450); });
    expect(onDiscarded).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onDiscarded).toHaveBeenCalledTimes(1);

    view.rerender(<InvoiceResolveTray invoice={invoice} rows={[rows[1]]} discardPending={false} onDiscard={onDiscard} onDiscarded={onDiscarded} />);
    expect(screen.getByTestId("resolve-tray-count")).toHaveTextContent("1");
  });
});
