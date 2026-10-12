import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DuplicateStatusResponse } from "@/modules/accounting/modules/invoices/types/api";
import { APPR, DEL, F_SPEC, F_STALE, F_TBX, makeInvoice } from "./duplicateCardFixtures.testUtils";
import { InvoiceResolveTray } from "./InvoiceResolveTray";
import { getInvoiceResolveRows } from "./invoiceResolveModel";
import { buildDuplicateCardModel } from "./duplicateCardModel";
import { useDuplicateCardActions } from "./useDuplicateCardActions";

const mocks = vi.hoisted(() => ({ bypassMutate: vi.fn<(variables: { id: string }) => Promise<unknown>>(() => Promise.resolve({ duplicateBypassed: true })), bypassPending: false, granted: new Set<string>() }));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useDuplicateBypass: () => ({ mutateAsync: mocks.bypassMutate, isPending: mocks.bypassPending }),
}));
vi.mock("@/modules/shared/components/ui/toaster", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasAnyPermission: (keys: string[]) => keys.some((key) => mocks.granted.has(key)) }),
}));

const invoice = makeInvoice({ id: "invoice-1", duplicateOf: "orig-1" });

interface TrayProps { status?: DuplicateStatusResponse | null; discardPending?: boolean; onDiscard?: () => boolean | Promise<boolean>; onDiscarded?: () => void }
const tray = ({ status, discardPending = false, onDiscard = vi.fn(), onDiscarded }: TrayProps) => (
  <InvoiceResolveTray invoice={invoice} rows={getInvoiceResolveRows(invoice, null, status)} duplicateStatus={status} discardPending={discardPending} onDiscard={onDiscard} onDiscarded={onDiscarded} />
);
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const buttons = () => screen.queryAllByRole("button").map((b) => b.textContent?.trim()).filter((t) => t && !/issue|tray/i.test(t));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bypassPending = false;
  mocks.granted = new Set([DEL, APPR]);
});
afterEach(() => vi.useRealTimers());

describe("live tray renders the duplicate model card", () => {
  it("puts the kind and test id on the card root and no legacy state attribute (CUT-05)", () => {
    const { container } = render(tray({ status: F_TBX }));
    const card = screen.getByTestId("duplicate-resolution-card");
    expect(card).toHaveAttribute("data-resolve-kind", "duplicate");
    const legacyAttributes = [...container.querySelectorAll("*")].flatMap((el) => el.getAttributeNames()).filter((name) => name.startsWith("data-duplicate-"));
    expect(legacyAttributes).toEqual([]);
    expect(screen.getByText("Possible duplicate")).toBeInTheDocument();
    expect(screen.getByText("· of 53477 in Toolbox")).toBeInTheDocument();
  });

  it("FIX5-4 the invoice duplicate tray header still reads To resolve", () => {
    render(tray({ status: F_TBX }));
    expect(screen.getByTestId("resolve-tray-header")).toHaveTextContent(/^To resolve 1$/);
  });

  it("links View duplicate to the original document and keeps two-step Discard (toolbox)", () => {
    const onDiscard = vi.fn();
    render(tray({ status: F_TBX, onDiscard }));
    expect(screen.getByRole("link", { name: "View duplicate" })).toHaveAttribute("href", "/accounting/invoices/orig-1");
    click("Discard");
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    click("Confirm discard");
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("falls back to the served flag while the status is loading (toolbox, link to duplicateOf)", () => {
    render(tray({ status: undefined }));
    expect(screen.getByText("· in Toolbox")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View duplicate" })).toHaveAttribute("href", "/accounting/invoices/orig-1");
  });

  it("flags an amount mismatch and not a match", () => {
    const first = render(tray({ status: F_TBX }));
    expect(screen.getByTestId("duplicate-amounts")).toHaveAttribute("data-mismatch", "true");
    expect(screen.getByText("differs")).toBeInTheDocument();
    first.unmount();
    render(tray({ status: { ...F_TBX, original: { ...F_TBX.original!, amount: 74877 } } }));
    expect(screen.getByTestId("duplicate-amounts")).toHaveAttribute("data-mismatch", "false");
    expect(screen.queryByText("differs")).toBeNull();
  });

  it("stale: cites the discard date, offers Bypass only, never a link or Discard", () => {
    render(tray({ status: F_STALE }));
    expect(screen.getByText(/discarded on Sep 14, 2026/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(buttons()).toEqual(["Bypass"]);
  });

  it("hides Discard and Bypass without their permissions but keeps the link", () => {
    mocks.granted = new Set();
    render(tray({ status: F_TBX }));
    expect(buttons()).toEqual([]);
    expect(screen.getByRole("link", { name: "View duplicate" })).toBeInTheDocument();
  });

  it("renders no card when the model is null for a duplicate row", () => {
    const approved = makeInvoice({ id: "invoice-1", status: "approved" });
    const rows = getInvoiceResolveRows(makeInvoice({ id: "invoice-1" }), null, F_TBX);
    render(<InvoiceResolveTray invoice={approved} rows={rows} duplicateStatus={F_TBX} discardPending={false} onDiscard={vi.fn()} />);
    expect(screen.queryByTestId("duplicate-resolution-card")).toBeNull();
  });

  it("disarms the inline Discard after three seconds", () => {
    vi.useFakeTimers();
    render(tray({ status: F_TBX }));
    click("Discard");
    expect(screen.getByRole("button", { name: "Confirm discard" })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("shows Discarding and Bypassing while those mutations are pending", () => {
    const first = render(tray({ status: F_TBX, discardPending: true }));
    expect(screen.getByRole("button", { name: /Discarding/ })).toBeDisabled();
    first.unmount();
    mocks.bypassPending = true;
    render(tray({ status: F_TBX }));
    expect(screen.getByRole("button", { name: /Bypassing/ })).toBeDisabled();
  });
});

describe("Spectrum state through the live tray", () => {
  it("bypass is a two-step with the Spectrum warning and the bypass mutation", () => {
    render(tray({ status: F_SPEC }));
    expect(screen.getByText("Already posted in Spectrum — unpaid (open items). Confirm it there, then discard.")).toBeInTheDocument();
    click("Bypass");
    expect(screen.getByText(/^Already posted in Spectrum as #25-907 — unpaid \(open items\), \$9,642\.00\. Bypassing lets it be approved/)).toBeInTheDocument();
    expect(mocks.bypassMutate).not.toHaveBeenCalled();
    click("Confirm bypass");
    expect(mocks.bypassMutate).toHaveBeenCalledWith({ id: "invoice-1" });
  });

  it("Discard opens the Spectrum dialog with the facts; its confirm discards once", () => {
    const onDiscard = vi.fn();
    render(tray({ status: F_SPEC, onDiscard }));
    click("Discard");
    expect(onDiscard).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Confirm it's in Spectrum");
    expect(dialog).toHaveTextContent("ZCON92");
    expect(dialog).toHaveTextContent("25-907");
    fireEvent.click(screen.getByRole("button", { name: "Discard duplicate" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("does not reopen the dialog after the status flips spectrum → none → spectrum (TG-M1)", () => {
    const onDiscard = vi.fn();
    const view = render(tray({ status: F_SPEC, onDiscard }));
    click("Discard");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    view.rerender(tray({ status: { ...F_SPEC, state: "none", spectrum: null }, onDiscard }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    view.rerender(tray({ status: F_SPEC, onDiscard }));
    expect(screen.getByTestId("duplicate-resolution-card")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onDiscard).not.toHaveBeenCalled();
  });
});

describe("Spectrum dialog reset with the duplicate row kept (F2, fix-6.3)", () => {
  it("FIX63-1 spectrum → toolbox → spectrum: the dialog does not reopen", () => {
    const view = render(tray({ status: F_SPEC }));
    click("Discard");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    view.rerender(tray({ status: F_TBX }));
    expect(screen.getByTestId("duplicate-resolution-card")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    view.rerender(tray({ status: F_SPEC }));
    expect(screen.getByTestId("duplicate-resolution-card")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("FIX63-2 spectrum → toolbox while the dialog is open closes it (tray and controller state)", () => {
    const view = render(tray({ status: F_SPEC }));
    click("Discard");
    view.rerender(tray({ status: F_TBX }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // The toolbox tray never renders the dialog, so also check the controller's own open state, which only the reset clears.
    const model = (status: DuplicateStatusResponse) => buildDuplicateCardModel({ invoice, status, discardPending: false, bypassPending: false });
    const hook = renderHook(({ status }) => useDuplicateCardActions({ invoiceId: invoice.id, model: model(status), onDiscard: vi.fn() }), { initialProps: { status: F_SPEC } });
    act(() => hook.result.current.onAction("discard"));
    expect(hook.result.current.dialog.open).toBe(true);
    hook.rerender({ status: F_TBX });
    expect(hook.result.current.dialog.open).toBe(false);
  });

  it("FIX63-3 toolbox → spectrum while inline Discard is armed: it disarms and the next Discard opens the dialog", () => {
    const onDiscard = vi.fn();
    const view = render(tray({ status: F_TBX, onDiscard }));
    click("Discard");
    expect(screen.getByRole("button", { name: "Confirm discard" })).toBeInTheDocument();
    view.rerender(tray({ status: F_SPEC, onDiscard }));
    expect(screen.queryByRole("button", { name: "Confirm discard" })).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    click("Discard");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Confirm it's in Spectrum");
    expect(onDiscard).not.toHaveBeenCalled();
  });
});

describe("one guarded discard (CUT-01, M2)", () => {
  const pendingDiscard = () => {
    let finish!: (confirmed: boolean) => void;
    const onDiscard = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    return { onDiscard, finish: (confirmed: boolean) => finish(confirmed) };
  };

  it("calls the page discard once for a double click on the armed Confirm discard", () => {
    const { onDiscard } = pendingDiscard();
    render(tray({ status: F_TBX, onDiscard }));
    click("Discard");
    const confirm = screen.getByRole("button", { name: "Confirm discard" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("calls the page discard once when the real Spectrum dialog's Discard duplicate is clicked twice in the same tick", () => {
    const { onDiscard } = pendingDiscard();
    render(tray({ status: F_SPEC, onDiscard }));
    click("Discard");
    const confirm = screen.getByRole("button", { name: "Discard duplicate" });
    act(() => { confirm.click(); confirm.click(); });
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("disables the dialog's Discard duplicate while a discard is pending", () => {
    const view = render(tray({ status: F_SPEC }));
    click("Discard");
    expect(screen.getByRole("button", { name: "Discard duplicate" })).toBeEnabled();
    view.rerender(tray({ status: F_SPEC, discardPending: true }));
    expect(screen.getByRole("button", { name: "Discard duplicate" })).toBeDisabled();
  });

  it("does not report a discard that settles after the tray unmounted", async () => {
    const { onDiscard, finish } = pendingDiscard();
    const onDiscarded = vi.fn();
    const view = render(tray({ status: F_TBX, onDiscard, onDiscarded }));
    click("Discard");
    click("Confirm discard");
    view.unmount();
    await act(async () => { finish(true); });
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onDiscarded).not.toHaveBeenCalled();
  });

  it("ignores a second discard after one completed: the page discard fires once (Adv-m2, completed guard)", async () => {
    const onDiscard = vi.fn().mockResolvedValue(true);
    const onDiscarded = vi.fn();
    render(tray({ status: F_TBX, onDiscard, onDiscarded }));
    click("Discard");
    await act(async () => { click("Confirm discard"); });
    expect(onDiscard).toHaveBeenCalledTimes(1);
    click("Discard");
    await act(async () => { click("Confirm discard"); });
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onDiscarded).toHaveBeenCalledTimes(1);
  });

  it("reports a confirmed discard once while mounted", async () => {
    const { onDiscard, finish } = pendingDiscard();
    const onDiscarded = vi.fn();
    render(tray({ status: F_TBX, onDiscard, onDiscarded }));
    click("Discard");
    click("Confirm discard");
    await act(async () => { finish(true); });
    expect(onDiscarded).toHaveBeenCalledTimes(1);
  });
});
