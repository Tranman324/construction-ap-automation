import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FM = vi.hoisted(() => ({
  jobs: [
    { number: "25-401", description: "North Tower", address: "100 Main St", status: "active", pm: "PM" },
    { number: "24-010", description: "South Lobby", address: "200 Main St", status: "active", pm: "PM" },
  ],
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useJobSearch: () => ({ data: FM.jobs, isLoading: false }),
}));

import { InvoiceDashboardFilters } from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceDashboardFilters";

describe("InvoiceDashboardFilters", () => {
  beforeEach(() => {
    FM.jobs = [
      { number: "25-401", description: "North Tower", address: "100 Main St", status: "active", pm: "PM" },
      { number: "24-010", description: "South Lobby", address: "200 Main St", status: "active", pm: "PM" },
    ];
  });

  it("closes the job combobox after option selection", async () => {
    const user = userEvent.setup();
    const onJobChange = vi.fn();

    render(
      <InvoiceDashboardFilters
        job={undefined}
        onJobChange={onJobChange}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: /all jobs/i }));
    await user.click(screen.getByText(/25-401/));

    expect(onJobChange).toHaveBeenCalledWith("25-401");
    await waitFor(() => {
      expect(screen.queryByText(/North Tower/)).not.toBeInTheDocument();
    });
  });

  it("closes an open combobox on Escape", async () => {
    const user = userEvent.setup();

    render(
      <InvoiceDashboardFilters
        job={undefined}
        onJobChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: /all jobs/i }));
    expect(screen.getByText(/North Tower/)).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByText(/North Tower/)).not.toBeInTheDocument();
    });
  });

  it("clears a selected job from the combobox trigger", async () => {
    const user = userEvent.setup();
    const onJobChange = vi.fn();

    render(
      <InvoiceDashboardFilters
        job="25-401"
        onJobChange={onJobChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /clear selection/i }));

    expect(onJobChange).toHaveBeenCalledWith(undefined);
  });

  it("preserves server order and renders every job on one middle-dot line", async () => {
    const user = userEvent.setup();
    FM.jobs = [
      { number: "A", description: "Alpha", address: "1 Main St", status: "active", pm: "PM" },
      { number: "C", description: "Charlie", address: "3 Main St", status: "active", pm: "PM" },
      { number: "B", description: "Bravo", address: "2 Main St", status: "active", pm: "PM" },
    ];

    render(<InvoiceDashboardFilters job="C" onJobChange={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "C · Charlie" })).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "C · Charlie" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "All jobs", "A · Alpha", "C · Charlie", "B · Bravo",
    ]);
    expect(screen.queryByText("1 Main St")).not.toBeInTheDocument();
  });
});
