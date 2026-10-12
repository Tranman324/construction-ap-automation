import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DuplicateStatusResponse } from "@/modules/accounting/modules/invoices/types/api";
import { ResolveCard } from "../documents/ResolveCard";
import { buildDuplicateCardModel, buildSpectrumConfirmEvidence } from "./duplicateCardModel";
import { APPR, DEL, F_SPEC, F_STALE, F_SUB, F_TBX, makeInvoice } from "./duplicateCardFixtures.testUtils";
import { SpectrumConfirmDialog } from "./SpectrumConfirmDialog";
import { useDuplicateCardActions } from "./useDuplicateCardActions";

const mocks = vi.hoisted(() => ({ bypassMutate: vi.fn<(variables: { id: string }) => Promise<unknown>>(() => Promise.resolve({ duplicateBypassed: true })), granted: new Set<string>() }));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useDuplicateBypass: () => ({ mutateAsync: mocks.bypassMutate, isPending: false }),
}));
vi.mock("@/modules/shared/components/ui/toaster", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasAnyPermission: (keys: string[]) => keys.some((key) => mocks.granted.has(key)) }),
}));

const onDiscard = vi.fn();
const BYPASS_WARNING = "Clears the duplicate flag. Recorded under your name; restorable from Details.";
const DISCARD_WARNING = "Discards this invoice. The original is not changed.";

/** The builder, the real ResolveCard and the real controller and dialog, wired the way the tray will wire them. */
function Wired({ status, discardPending = false }: { status: DuplicateStatusResponse; discardPending?: boolean }) {
  const invoice = makeInvoice();
  const model = buildDuplicateCardModel({ invoice, status, discardPending, bypassPending: false });
  const actions = useDuplicateCardActions({ invoiceId: invoice.id, model, onDiscard });
  if (!model) return null;
  return (
    <>
      <ResolveCard model={model} onAction={actions.onAction} />
      <SpectrumConfirmDialog
        open={actions.dialog.open}
        onOpenChange={actions.dialog.onOpenChange}
        evidence={buildSpectrumConfirmEvidence(F_SPEC)}
        onDiscard={actions.dialog.onConfirm}
      />
    </>
  );
}

const buttonNames = () => screen.queryAllByRole("button").map((b) => b.textContent?.trim());
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.granted = new Set([DEL, APPR]);
});
afterEach(() => vi.useRealTimers());

describe("duplicate card through ResolveCard", () => {
  it("approve-only spectrum shows Bypass alone (INT-01)", () => {
    mocks.granted = new Set([APPR]);
    render(<Wired status={F_SPEC} />);
    expect(buttonNames()).toEqual(["Bypass"]);
    expect(screen.queryByText("Needs an approver")).toBeNull();
  });

  it("delete-only toolbox shows the View duplicate link and Discard (INT-02)", () => {
    mocks.granted = new Set([DEL]);
    render(<Wired status={F_TBX} />);
    expect(buttonNames()).toEqual(["Discard"]);
    expect(screen.getByRole("link", { name: "View duplicate" })).toHaveAttribute("href", "/accounting/invoices/orig-1");
  });

  it("stale never offers Discard or View and falls back without the approve key (INT-03)", () => {
    mocks.granted = new Set([DEL]);
    const first = render(<Wired status={F_STALE} />);
    expect(buttonNames()).toEqual([]);
    expect(screen.getByText("Needs an approver")).toBeInTheDocument();
    first.unmount();
    for (const granted of [[APPR], [DEL, APPR]]) {
      mocks.granted = new Set(granted);
      const view = render(<Wired status={F_STALE} />);
      expect(buttonNames()).toEqual(["Bypass"]);
      expect(screen.queryByText("Needs an approver")).toBeNull();
      view.unmount();
    }
  });

  it("arms one action at a time with its own warning and disarms after 3 seconds (INT-04)", () => {
    vi.useFakeTimers();
    render(<Wired status={F_TBX} />);
    click("Bypass");
    expect(screen.getByText(BYPASS_WARNING)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm bypass" })).toBeInTheDocument();
    expect(mocks.bypassMutate).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByRole("button", { name: "Bypass" })).toBeInTheDocument();
    expect(screen.queryByText(BYPASS_WARNING)).toBeNull();
    click("Bypass");
    click("Discard");
    expect(screen.getByText(DISCARD_WARNING)).toBeInTheDocument();
    expect(screen.queryByText(BYPASS_WARNING)).toBeNull();
    expect(screen.getByRole("button", { name: "Bypass" })).toBeInTheDocument();
  });

  it("fires the bypass once on the second click and re-arms on the third (INT-05)", () => {
    render(<Wired status={F_TBX} />);
    click("Bypass");
    click("Confirm bypass");
    expect(mocks.bypassMutate).toHaveBeenCalledTimes(1);
    click("Bypass");
    expect(mocks.bypassMutate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Confirm bypass" })).toBeInTheDocument();
  });

  it("disables a pending Discard and ignores clicks (INT-06)", () => {
    render(<Wired status={F_TBX} discardPending />);
    const pending = screen.getByRole("button", { name: /Discarding/ });
    expect(pending).toBeDisabled();
    expect(screen.getByLabelText("Discarding")).toBeInTheDocument();
    fireEvent.click(pending);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.queryByText(DISCARD_WARNING)).toBeNull();
  });

  it("keeps the card test id for all four states (INT-07)", () => {
    for (const status of [F_SPEC, F_SUB, F_TBX, F_STALE]) {
      const view = render(<Wired status={status} />);
      expect(screen.getByTestId("duplicate-resolution-card")).toBeInTheDocument();
      view.unmount();
    }
  });

  it("opens the Spectrum dialog from Discard, with no inline confirm step (INT-08)", () => {
    render(<Wired status={F_SPEC} />);
    click("Discard");
    expect(screen.getByText("Confirm it's in Spectrum")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm discard/i })).toBeNull();
    expect(onDiscard).not.toHaveBeenCalled();
    click("Discard duplicate");
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
