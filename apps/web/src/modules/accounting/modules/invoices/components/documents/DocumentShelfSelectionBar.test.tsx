import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ACTION_MOCKS = vi.hoisted(() => ({
  bulkMutate: vi.fn(),
  deleteMutate: vi.fn(),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useBulkAction: () => ({ mutate: ACTION_MOCKS.bulkMutate, isPending: false }),
  useDeleteInvoice: () => ({ mutate: ACTION_MOCKS.deleteMutate, isPending: false }),
}));

import { DocumentShelfSelectionBar } from "@/modules/accounting/modules/invoices/components/documents/DocumentShelfSelectionBar";

describe("DocumentShelfSelectionBar", () => {
  beforeEach(() => {
    ACTION_MOCKS.bulkMutate.mockReset();
    ACTION_MOCKS.deleteMutate.mockReset();
  });

  it("preserves shelf, discard, and permanent delete actions", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<DocumentShelfSelectionBar selectedIds={["doc-1", "doc-2"]} onClear={onClear} />);

    await user.click(screen.getByRole("button", { name: "Shelve" }));
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(ACTION_MOCKS.bulkMutate).toHaveBeenNthCalledWith(
      1,
      { ids: ["doc-1", "doc-2"], action: "file" },
      expect.objectContaining({ onSuccess: onClear }),
    );
    expect(ACTION_MOCKS.bulkMutate).toHaveBeenNthCalledWith(
      2,
      { ids: ["doc-1", "doc-2"], action: "discard" },
      expect.objectContaining({ onSuccess: onClear }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("cannot be undone");

    await user.click(screen.getByRole("button", { name: "Delete permanently" }));
    expect(ACTION_MOCKS.deleteMutate).toHaveBeenCalledWith(
      { id: "doc-1" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
