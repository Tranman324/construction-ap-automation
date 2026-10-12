import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

const TM = vi.hoisted(() => ({
  permissions: [] as string[],
  restoreReturn: {
    mutate: vi.fn(),
    isPending: false,
  },
  permanentDeleteReturn: {
    mutate: vi.fn(),
    isPending: false,
  },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: (keys: string[]) =>
      keys.some((key) => TM.permissions.includes("*") || TM.permissions.includes(key)),
    hasAllPermissions: (keys: string[]) =>
      keys.every((key) => TM.permissions.includes("*") || TM.permissions.includes(key)),
    role: null,
    isAdmin: TM.permissions.includes("*"),
    permissions: TM.permissions,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useRestoreInvoice: () => TM.restoreReturn,
  usePermanentDelete: () => TM.permanentDeleteReturn,
}));

vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: { success: TM.toastSuccess, error: TM.toastError },
}));

import { TrashActions } from "@/modules/accounting/modules/invoices/components/trash/TrashActions";

const invoice = {
  id: "inv-1",
  file: "invoice.pdf",
  extracted: {
    invoiceNumber: "INV-001",
  },
} as Invoice;

describe("TrashActions permission gating", () => {
  beforeEach(() => {
    TM.permissions = [];
    TM.restoreReturn.mutate.mockReset();
    TM.restoreReturn.isPending = false;
    TM.permanentDeleteReturn.mutate.mockReset();
    TM.permanentDeleteReturn.isPending = false;
    TM.toastSuccess.mockReset();
    TM.toastError.mockReset();
  });

  it("renders restore and permanent delete when accounting.invoices.delete is present", () => {
    TM.permissions = ["accounting.invoices.delete"];

    render(<TrashActions invoice={invoice} />);

    expect(screen.getByRole("button", { name: /restore/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /restore/i })).toHaveAttribute("data-variant", "outline");
    expect(screen.getByRole("button", { name: /delete permanently/i })).toBeInTheDocument();
  });

  it("hides restore and permanent delete when accounting.invoices.delete is missing", () => {
    TM.permissions = [];

    render(<TrashActions invoice={invoice} />);

    expect(screen.queryByRole("button", { name: /restore/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete permanently/i })).not.toBeInTheDocument();
  });

  it("keeps manual restores immediate and confirms filtered restores before the unchanged mutation", async () => {
    const user = userEvent.setup();
    TM.permissions = ["accounting.invoices.delete"];

    render(<TrashActions invoice={invoice} />);
    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(TM.restoreReturn.mutate).toHaveBeenCalledWith(
      { id: invoice.id },
      expect.any(Object),
    );

    TM.restoreReturn.mutate.mockReset();
    TM.restoreReturn.mutate.mockImplementation((_variables, callbacks) => {
      callbacks.onSuccess({ status: "pending" });
    });
    const filteredInvoice = { ...invoice, discardSource: "junk-hash" } as Invoice;
    render(<TrashActions invoice={filteredInvoice} />);
    await user.click(screen.getAllByRole("button", { name: "Restore" })[1]);

    expect(TM.restoreReturn.mutate).not.toHaveBeenCalled();
    expect(screen.getByText("This file was auto-filtered as junk. Restoring removes it from the junk list — future copies of this file will be processed normally.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(TM.restoreReturn.mutate).toHaveBeenCalledWith(
      { id: filteredInvoice.id },
      expect.any(Object),
    );
    expect(TM.toastSuccess).toHaveBeenCalledWith(
      "Invoice restored",
      { description: "INV-001 restored to pending." },
    );
  });

  it("keeps the filtered restore confirmation open and pending until the restore succeeds", async () => {
    const user = userEvent.setup();
    TM.permissions = ["accounting.invoices.delete"];
    let callbacks: { onSuccess: (result: { status: string }) => void } | undefined;
    TM.restoreReturn.mutate.mockImplementation((_variables, restoreCallbacks) => {
      callbacks = restoreCallbacks;
    });

    render(<TrashActions invoice={{ ...invoice, discardSource: "auto-ai" } as Invoice} />);

    await user.click(screen.getByRole("button", { name: "Restore" }));
    await user.click(screen.getByRole("button", { name: "Restore" }));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restoring…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await act(async () => {
      callbacks?.onSuccess({ status: "pending" });
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("clears filtered restore pending state after an error and allows retry", async () => {
    const user = userEvent.setup();
    TM.permissions = ["accounting.invoices.delete"];
    let callbacks: { onError: (error: Error) => void } | undefined;
    TM.restoreReturn.mutate.mockImplementation((_variables, restoreCallbacks) => {
      callbacks = restoreCallbacks;
    });

    render(<TrashActions invoice={{ ...invoice, discardSource: "rule-filter" } as Invoice} />);

    await user.click(screen.getByRole("button", { name: "Restore" }));
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await act(async () => {
      callbacks?.onError(new Error("Restore failed"));
    });

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("requires confirmation for permanent deletion and cancellation never mutates", async () => {
    const user = userEvent.setup();
    TM.permissions = ["accounting.invoices.delete"];

    render(<TrashActions invoice={invoice} />);

    await user.click(screen.getByRole("button", { name: "Delete Permanently" }));
    expect(TM.permanentDeleteReturn.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("This action cannot be undone.");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(TM.permanentDeleteReturn.mutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete Permanently" }));
    const confirmDelete = screen.getAllByRole("button", { name: "Delete Permanently" }).at(-1);
    expect(confirmDelete).toBeDefined();
    await user.click(confirmDelete!);
    expect(TM.permanentDeleteReturn.mutate).toHaveBeenCalledWith(
      { id: invoice.id },
      expect.any(Object),
    );
  });
});
