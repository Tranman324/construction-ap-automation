import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentAction } from "@/modules/accounting/modules/invoices/types/documentSpec";
import { CommentPopoverHost } from "./CommentPopoverHost";

const commentHook = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  useCreateComment: vi.fn(() => ({ isPending: false, mutateAsync: vi.fn() })),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useCreateComment: commentHook.useCreateComment,
}));

vi.mock("@/modules/accounting/modules/invoices/components/documents/DocumentActionsDropdown", () => ({
  DocumentActionsDropdown: ({ actions }: { actions: readonly DocumentAction[] }) => (
    <button type="button" onClick={() => void actions.find((action) => action.id === "add-comment")?.onClick()}>
      Actions
    </button>
  ),
}));

describe("CommentPopoverHost", () => {
  beforeEach(() => {
    commentHook.useCreateComment.mockClear();
  });

  it("does not mount the comment mutation while the popover is closed", () => {
    render(<CommentPopoverHost documentId="doc-1" routeFamily="invoice" actions={[]} canComment />);

    expect(commentHook.useCreateComment).not.toHaveBeenCalled();
  });

  it("closes on Escape during capture even when the textarea stops propagation", () => {
    render(<CommentPopoverHost documentId="doc-1" routeFamily="invoice" actions={[]} canComment />);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    const input = screen.getByRole("textbox", { name: "Add a comment" });
    input.addEventListener("keydown", (event) => event.stopPropagation());

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Add comment" })).not.toBeInTheDocument();
    expect(commentHook.useCreateComment).toHaveBeenCalledTimes(1);
  });
});
