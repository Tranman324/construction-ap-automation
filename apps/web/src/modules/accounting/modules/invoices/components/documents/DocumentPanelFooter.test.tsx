import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Archive, FolderOpen } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { DocumentPanelFooter } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanelFooter";

describe("DocumentPanelFooter", () => {
  it("renders the standardized footer contract in order", () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    const onUndo = vi.fn();
    const onSkip = vi.fn();
    const onDiscard = vi.fn();

    const { container } = render(
      <DocumentPanelFooter
        note="1 item left"
        navigation={{ canSkip: true, onSkip, onDiscard }}
        secondaryActions={[
          { id: "file", label: "File to Project", icon: FolderOpen, onClick: onSecondary },
        ]}
        undoControl={{
          disabled: false,
          tooltip: "Undo: Filed document",
          onUndo,
        }}
        primaryAction={{ id: "file-to-shelf", label: "Shelve", icon: Archive, onClick: onPrimary }}
      />,
    );

    expect(container.firstElementChild?.textContent).toBe("Discard1 item leftSkipUndoShelve");
    expect(container.firstElementChild).toHaveClass("bg-card", "px-4");
    expect(screen.queryByRole("button", { name: "File to Project" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("button", { name: "Confirm Discard" })).toBeInTheDocument();
    expect(onDiscard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Shelve" }));

    expect(screen.getByText("1 item left")).toBeInTheDocument();
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSecondary).not.toHaveBeenCalled();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it("disables undo with a tooltip when there is nothing to undo", async () => {
    const user = userEvent.setup();

    render(
      <DocumentPanelFooter
        undoControl={{
          disabled: true,
          tooltip: "There is nothing to undo.",
          onUndo: vi.fn(),
        }}
      />,
    );

    const undo = screen.getByRole("button", { name: "Undo" });
    const trigger = screen.getByText("Undo").closest("span");

    expect(undo).toBeDisabled();
    expect(trigger).toBeInstanceOf(HTMLElement);

    await user.hover(trigger as HTMLElement);

    expect(await screen.findAllByText("There is nothing to undo.")).not.toHaveLength(0);
  });

  it("disables pending primary actions", () => {
    render(
      <DocumentPanelFooter
        primaryAction={{ id: "review", label: "Saving", pending: true, onClick: vi.fn() }}
      />,
    );

    expect(screen.getByRole("button", { name: "Saving" })).toBeDisabled();
  });

  it("registers the primary action for keyboard shortcuts", () => {
    const onPrimary = vi.fn();
    const onPrimaryActionChange = vi.fn();

    render(
      <DocumentPanelFooter
        onPrimaryActionChange={onPrimaryActionChange}
        primaryAction={{ id: "file-to-shelf", label: "Shelve", icon: Archive, onClick: onPrimary }}
      />,
    );

    const registered = onPrimaryActionChange.mock.calls.at(-1)?.[0];
    expect(registered).toEqual(expect.objectContaining({
      label: "Shelve",
      disabled: false,
      run: onPrimary,
    }));
  });

  it("shows shortcut hints for enabled primary actions", async () => {
    const user = userEvent.setup();

    render(
      <DocumentPanelFooter
        primaryAction={{ id: "file-to-shelf", label: "Shelve", icon: Archive, onClick: vi.fn() }}
      />,
    );

    await user.hover(screen.getByRole("button", { name: "Shelve" }));

    expect(await screen.findAllByText(/Shelve • (Ctrl|⌘) Enter/)).not.toHaveLength(0);
  });

  it("disables pending discard navigation", () => {
    const onDiscard = vi.fn();

    render(
      <DocumentPanelFooter
        navigation={{ onDiscard, discardPending: true }}
      />,
    );

    const discard = screen.getByRole("button", { name: "Discarding..." });
    expect(discard).toBeDisabled();

    fireEvent.click(discard);
    expect(onDiscard).not.toHaveBeenCalled();
  });
});
