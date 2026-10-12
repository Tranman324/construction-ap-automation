import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PaginationBar } from "@/modules/accounting/modules/invoices/components/invoices/PaginationBar";

describe("PaginationBar", () => {
  it("renders the current range and calls previous and next handlers", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    render(
      <PaginationBar
        page={2}
        pages={4}
        total={80}
        limit={25}
        onPageChange={onPageChange}
        onLimitChange={vi.fn()}
      />,
    );

    expect(screen.getByText("26-50 of 80")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous page" }));
    await user.click(screen.getByRole("button", { name: "Next page" }));

    expect(onPageChange).toHaveBeenCalledWith(1);
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("renders selected-count context when selections span pages", () => {
    render(
      <PaginationBar
        page={2}
        pages={4}
        total={80}
        limit={25}
        selectedCount={3}
        onPageChange={vi.fn()}
        onLimitChange={vi.fn()}
      />,
    );

    expect(screen.getByText("26-50 of 80")).toBeInTheDocument();
    expect(screen.getByText("3 selected across all pages")).toBeInTheDocument();
  });

  it("disables previous and next controls at the bounds", () => {
    const { rerender } = render(
      <PaginationBar
        page={1}
        pages={3}
        total={60}
        limit={25}
        onPageChange={vi.fn()}
        onLimitChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    rerender(
      <PaginationBar
        page={3}
        pages={3}
        total={60}
        limit={25}
        onPageChange={vi.fn()}
        onLimitChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });
});
