import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ColumnToggleDropdown,
  DEFAULT_COLUMN_ORDER,
  TOGGLEABLE_COLUMNS,
} from "@/modules/accounting/modules/invoices/components/invoices/ColumnToggleDropdown";

describe("ColumnToggleDropdown", () => {
  it("matches the prototype's eight fixed column choices", async () => {
    const user = userEvent.setup();
    const ids = TOGGLEABLE_COLUMNS.map((column) => column.id);

    expect(ids).toEqual(["status", "jobNumber", "classification", "waiver", "emailFrom", "emailSubject", "amount", "queuedAt"]);
    expect(DEFAULT_COLUMN_ORDER).toEqual([
      "status",
      "activityMarker",
      "vendorName",
      "jobNumber",
      "classification",
      "waiver",
      "amount",
      "queuedAt",
      "emailFrom",
      "emailSubject",
    ]);

    render(
      <ColumnToggleDropdown
        columnVisibility={{}}
        columnOrder={DEFAULT_COLUMN_ORDER}
        onVisibilityChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Columns" }));

    expect(screen.getByText("Show columns")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitemcheckbox").map((item) => item.textContent)).toEqual([
      "Status", "Job", "Type", "Waiver", "Sender", "Subject", "Amount", "Received",
    ]);
    expect(screen.queryByText("Show all")).not.toBeInTheDocument();
    expect(screen.queryByText("Toggle columns")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitemcheckbox", { name: "Activity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitemcheckbox", { name: "Vendor / Invoice" })).not.toBeInTheDocument();
  });

  it("allows Type to be hidden and marks a customized configuration", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    const onVisibilityChange = vi.fn();
    render(
      <ColumnToggleDropdown
        columnVisibility={{}}
        columnOrder={DEFAULT_COLUMN_ORDER}
        onVisibilityChange={onVisibilityChange}
        onReset={onReset}
      />,
    );

    expect(screen.getByRole("button", { name: "Columns" }).querySelector(".absolute")).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Reset to default" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Type" }));
    expect(onVisibilityChange).toHaveBeenCalledWith({ classification: false });
    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(screen.getByRole("menuitem", { name: "Reset to default" }));
    expect(onReset).toHaveBeenCalledOnce();

    const { rerender } = render(
      <ColumnToggleDropdown
        columnVisibility={{ emailFrom: true, emailSubject: false }}
        columnOrder={DEFAULT_COLUMN_ORDER}
        onVisibilityChange={onVisibilityChange}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Columns" }).at(-1)?.querySelector(".absolute")).not.toBeNull();
    rerender(
      <ColumnToggleDropdown
        columnVisibility={{ emailFrom: false, emailSubject: false }}
        columnOrder={DEFAULT_COLUMN_ORDER}
        onVisibilityChange={onVisibilityChange}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Columns" }).at(-1)?.querySelector(".absolute")).toBeNull();
  });
});
