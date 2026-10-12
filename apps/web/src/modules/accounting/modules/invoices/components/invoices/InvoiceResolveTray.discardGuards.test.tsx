import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolveCarouselActionHandler } from "../documents/resolveCardModel";
import { F_TBX, makeInvoice } from "./duplicateCardFixtures.testUtils";
import { InvoiceResolveTray } from "./InvoiceResolveTray";
import { getInvoiceResolveRows } from "./invoiceResolveModel";

// Every rendered Discard control is disabled while `discardPending` is true, so no click can reach the tray's guard.
// The carousel seam is captured instead, to call the tray's action handler the way a stale caller would.
const seam = vi.hoisted(() => ({ onAction: undefined as ResolveCarouselActionHandler | undefined, bypass: vi.fn<(variables: { id: string }) => Promise<unknown>>(() => Promise.resolve({})) }));
vi.mock("../documents/ResolveCarousel", () => ({
  ResolveCarousel: ({ onAction }: { onAction?: ResolveCarouselActionHandler }) => { seam.onAction = onAction; return null; },
}));
vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({ useDuplicateBypass: () => ({ mutateAsync: seam.bypass, isPending: false }) }));
vi.mock("@/modules/shared/components/ui/toaster", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const invoice = makeInvoice({ id: "invoice-1", duplicateOf: "orig-1" });
const tray = (discardPending: boolean, onDiscard: () => Promise<boolean>) => (
  <InvoiceResolveTray invoice={invoice} rows={getInvoiceResolveRows(invoice, null, F_TBX)} duplicateStatus={F_TBX} discardPending={discardPending} onDiscard={onDiscard} />
);

beforeEach(() => { seam.onAction = undefined; seam.bypass.mockClear(); });

describe("tray discard guards (Adv-m2)", () => {
  it("does not start a discard while the page reports one pending (discardPending guard)", async () => {
    const onDiscard = vi.fn().mockResolvedValue(true);
    render(tray(true, onDiscard));
    await act(async () => {
      seam.onAction?.("duplicate", "discard");
      // Same render, same handler: a reachable controller proves the no-op above came from the guard, not a null ref.
      seam.onAction?.("duplicate", "bypass");
    });
    expect(seam.bypass).toHaveBeenCalledWith({ id: "invoice-1" });
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("FIX65-1 fires the page discard once for two same-tick calls while the first is in flight (inFlight guard)", async () => {
    let finish!: (confirmed: boolean) => void;
    const onDiscard = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    render(tray(false, onDiscard));
    act(() => {
      seam.onAction?.("duplicate", "discard");
      seam.onAction?.("duplicate", "discard");
    });
    expect(onDiscard).toHaveBeenCalledTimes(1);
    await act(async () => { finish(false); });
  });

  it("fires the page discard once for two awaited calls after the first completed (completed guard)", async () => {
    const onDiscard = vi.fn().mockResolvedValue(true);
    render(tray(false, onDiscard));
    await act(async () => { seam.onAction?.("duplicate", "discard"); });
    await act(async () => { seam.onAction?.("duplicate", "discard"); });
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
