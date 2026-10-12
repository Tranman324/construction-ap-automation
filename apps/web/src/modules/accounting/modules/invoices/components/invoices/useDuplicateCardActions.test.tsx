import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildDuplicateCardModel, buildSpectrumConfirmEvidence } from "./duplicateCardModel";
import { F_SPEC, F_TBX, makeInvoice } from "./duplicateCardFixtures.testUtils";
import { SpectrumConfirmDialog } from "./SpectrumConfirmDialog";
import { useDuplicateCardActions } from "./useDuplicateCardActions";

const mocks = vi.hoisted(() => ({
  bypassMutate: vi.fn<(variables: { id: string }) => Promise<unknown>>(() => Promise.resolve({ duplicateBypassed: true })),
  success: vi.fn(),
  error: vi.fn(),
  push: vi.fn(),
}));

// Only the bypass hook exists on the mocked module: importing any discard hook would be undefined and throw (I2).
vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useDuplicateBypass: () => ({ mutateAsync: mocks.bypassMutate, isPending: false }),
}));
vi.mock("@/modules/shared/components/ui/toaster", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

const onDiscard = vi.fn();

function modelFor(status: typeof F_SPEC) {
  return buildDuplicateCardModel({ invoice: makeInvoice(), status, discardPending: false, bypassPending: false });
}

/** Renders the controller's return value: one button per action id and the real dialog. */
function Harness({ status }: { status: typeof F_SPEC }) {
  const actions = useDuplicateCardActions({ invoiceId: "copy-2", model: modelFor(status), onDiscard });
  return (
    <>
      {["discard", "bypass", "view", "unknown"].map((id) => (
        <button key={id} type="button" onClick={() => actions.onAction(id)}>{`fire ${id}`}</button>
      ))}
      <SpectrumConfirmDialog
        open={actions.dialog.open}
        onOpenChange={actions.dialog.onOpenChange}
        evidence={buildSpectrumConfirmEvidence(F_SPEC)}
        onDiscard={actions.dialog.onConfirm}
      />
    </>
  );
}

const fire = (id: string) => fireEvent.click(screen.getByRole("button", { name: `fire ${id}` }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useDuplicateCardActions", () => {
  it("opens the dialog for a dialog-kind Discard and discards once on confirm (CTL-01)", () => {
    render(<Harness status={F_SPEC} />);
    fire("discard");
    expect(screen.getByText("Confirm it's in Spectrum")).toBeInTheDocument();
    expect(onDiscard).toHaveBeenCalledTimes(0);
    fireEvent.click(screen.getByRole("button", { name: "Discard duplicate" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(mocks.bypassMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("discards directly for a two-step Discard without opening the dialog (CTL-02)", () => {
    render(<Harness status={F_TBX} />);
    fire("discard");
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("bypass mutates once with only the invoice id; the outcome rides on the returned promise (CTL-03, fix-6.2)", async () => {
    render(<Harness status={F_TBX} />);
    fire("bypass");
    await act(async () => { await Promise.resolve(); });
    expect(mocks.bypassMutate).toHaveBeenCalledTimes(1);
    expect(mocks.bypassMutate.mock.calls[0]).toEqual([{ id: "copy-2" }]);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("toasts the success and error copy from the legacy card (CTL-04)", async () => {
    render(<Harness status={F_TBX} />);
    fire("bypass");
    await act(async () => { await Promise.resolve(); });
    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(mocks.success).toHaveBeenCalledWith("Duplicate flag bypassed");
    mocks.bypassMutate.mockRejectedValueOnce(new Error("boom"));
    fire("bypass");
    await act(async () => { await Promise.resolve(); });
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(mocks.error).toHaveBeenCalledWith("Could not bypass duplicate flag", { description: "boom" });
  });

  it("passes an empty error message through without inventing a fallback (CTL-05)", async () => {
    mocks.bypassMutate.mockRejectedValueOnce(new Error(""));
    render(<Harness status={F_TBX} />);
    fire("bypass");
    await act(async () => { await Promise.resolve(); });
    expect(mocks.error).toHaveBeenCalledWith("Could not bypass duplicate flag", { description: "" });
  });

  it("treats view and unknown ids as no-ops: links never reach the controller (CTL-06)", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<Harness status={F_TBX} />);
    fire("view");
    fire("unknown");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(mocks.bypassMutate).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    open.mockRestore();
  });
});
