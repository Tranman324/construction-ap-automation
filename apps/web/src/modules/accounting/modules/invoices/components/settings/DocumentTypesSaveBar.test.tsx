import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { DocumentTypesSaveBar } from "@/modules/accounting/modules/invoices/components/settings/DocumentTypesSaveBar";

describe("DocumentTypesSaveBar", () => {
  it("stays hidden while clean and idle", () => {
    const { container } = render(<DocumentTypesSaveBar dirtyCount={0} saveState="idle" pending={false} onCancel={vi.fn()} onSave={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows dirty count and triggers save/cancel actions", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onSave = vi.fn();
    render(<DocumentTypesSaveBar dirtyCount={2} saveState="idle" pending={false} onCancel={onCancel} onSave={onSave} />);

    expect(screen.getByText("2 unsaved changes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("auto-clears saved state after roughly three seconds", () => {
    vi.useFakeTimers();
    const onClearState = vi.fn();

    render(
      <DocumentTypesSaveBar
        dirtyCount={0}
        saveState="saved"
        pending={false}
        onCancel={vi.fn()}
        onClearState={onClearState}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText("All changes saved")).toBeInTheDocument();
    expect(onClearState).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(onClearState).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onClearState).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  it("disables save while validation errors are present", () => {
    render(
      <DocumentTypesSaveBar
        dirtyCount={1}
        saveState="idle"
        pending={false}
        saveDisabled
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
  });
});
