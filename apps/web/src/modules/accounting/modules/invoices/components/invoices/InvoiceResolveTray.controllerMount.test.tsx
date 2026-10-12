import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { F_TBX, makeInvoice } from "./duplicateCardFixtures.testUtils";
import { InvoiceResolveTray } from "./InvoiceResolveTray";
import type { InvoiceResolveRow } from "./invoiceResolveModel";

// Counts every render that mounts the duplicate bypass mutation (Adv-m1).
const bypass = vi.hoisted(() => ({ calls: 0, mutateAsync: vi.fn<(variables: { id: string }) => Promise<unknown>>(() => Promise.resolve({})) }));
vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useDuplicateBypass: () => { bypass.calls += 1; return { mutateAsync: bypass.mutateAsync, isPending: false }; },
}));
vi.mock("@/modules/shared/components/ui/toaster", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/shared/hooks/usePermissions", () => ({ usePermissions: () => ({ hasAnyPermission: () => true }) }));

const invoice = makeInvoice({ id: "invoice-1", duplicateOf: "orig-1" });
const closedPeriod: InvoiceResolveRow = {
  id: "closed-period:invoice-1", kind: "closed-period", label: "Invoice date in a closed period",
  recoveryAction: { invoiceId: "invoice-1", disabled: false, onUseSuggestedDate: vi.fn(), recovery: { invoiceDateMonth: "2026-07", currentMonth: "2026-08", suggestedInvoiceDate: "2026-08-01" } },
};
const duplicate: InvoiceResolveRow = { id: "duplicate:invoice-1", kind: "duplicate", label: "Possible duplicate" };
const tray = (rows: InvoiceResolveRow[]) => <InvoiceResolveTray invoice={invoice} rows={rows} duplicateStatus={F_TBX} discardPending={false} onDiscard={vi.fn()} />;

beforeEach(() => { bypass.calls = 0; bypass.mutateAsync.mockClear(); });

describe("duplicate controller mounts only with a duplicate row (Adv-m1)", () => {
  it("never mounts the bypass mutation for a tray without a duplicate row", () => {
    render(tray([closedPeriod]));
    expect(screen.getByTestId("invoice-resolve-tray")).toBeInTheDocument();
    expect(bypass.calls).toBe(0);
  });

  it("mounts it with a duplicate row, and releases it without remounting the tray when the row goes away", () => {
    const view = render(tray([duplicate, closedPeriod]));
    expect(screen.getByTestId("duplicate-resolution-card")).toBeInTheDocument();
    expect(bypass.calls).toBeGreaterThan(0);
    const aside = screen.getByTestId("invoice-resolve-tray");
    bypass.calls = 0;
    view.rerender(tray([closedPeriod]));
    expect(screen.queryByTestId("duplicate-resolution-card")).toBeNull();
    expect(screen.getByTestId("invoice-resolve-tray")).toBe(aside);
    expect(bypass.calls).toBe(0);
  });

  it("FIX65-2 Bypass reaches the new controller after the duplicate row goes away and comes back", async () => {
    const view = render(tray([duplicate, closedPeriod]));
    view.rerender(tray([closedPeriod]));
    view.rerender(tray([duplicate, closedPeriod]));
    fireEvent.click(screen.getByRole("button", { name: "Bypass" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm bypass" }));
    await act(async () => { await Promise.resolve(); });
    expect(bypass.mutateAsync).toHaveBeenCalledTimes(1);
    expect(bypass.mutateAsync).toHaveBeenCalledWith({ id: "invoice-1" });
  });
});
