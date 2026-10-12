import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { JobDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/JobDropdown";

import type { Job } from "@/modules/accounting/modules/invoices/types/api";

const M = vi.hoisted(() => ({
  jobs: [] as Job[],
  lookedUpJob: null as Job | null,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useJobSearch: () => ({ data: M.jobs, isLoading: false }),
  useJobByNumber: () => ({ data: M.lookedUpJob }),
}));

const selectedJob: Job = {
  number: "26-434",
  description: "Brightwater",
  address: "555 Example Commons Parkway, Brookfield, ST 00004",
  status: "active",
  pm: "Pat Manager",
};

const anotherJob: Job = {
  number: "26-450",
  description: "Rooftop Repair",
  address: "2300 Example Ridge Parkway, Atlanta, GA 30339",
  status: "active",
  pm: "Pat Manager",
};

beforeEach(() => {
  M.jobs = [];
  M.lookedUpJob = null;
});

describe("JobDropdown", () => {
  it("shows the selected job address beneath the closed picker", () => {
    M.jobs = [selectedJob];

    render(<JobDropdown value={selectedJob.number} onChange={vi.fn()} />);

    expect(screen.getByText(selectedJob.address)).toBeInTheDocument();
  });

  it("pins the selected job first and keeps its address when the picker opens", async () => {
    const user = userEvent.setup();
    M.jobs = [anotherJob, selectedJob];

    render(<JobDropdown value={selectedJob.number} onChange={vi.fn()} />);
    await user.click(screen.getByRole("combobox", { name: "26-434 — Brightwater" }));

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      expect.stringContaining("26-434 — Brightwater"),
      expect.stringContaining("26-450 — Rooftop Repair"),
    ]);
    expect(screen.getAllByRole("option")[0]).toHaveTextContent(selectedJob.address);
  });

  it("uses the dedicated selected-job lookup when the current search page omits it", async () => {
    const user = userEvent.setup();
    M.jobs = [anotherJob];
    M.lookedUpJob = selectedJob;

    render(<JobDropdown value={selectedJob.number} onChange={vi.fn()} />);

    expect(screen.getByText(selectedJob.address)).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "26-434 — Brightwater" }));

    expect(screen.getAllByRole("option")[0]).toHaveTextContent("26-434 — Brightwater");
    expect(screen.getAllByRole("option")[0]).toHaveTextContent(selectedJob.address);
  });

  it("preserves the selected and cleared values passed to the parent", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    M.jobs = [selectedJob];

    render(
      <JobDropdown
        value={selectedJob.number}
        clearOptionLabel="Clear job"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "26-434 — Brightwater" }));
    await user.click(screen.getByRole("option", { name: /26-434 — Brightwater/ }));
    expect(onChange).toHaveBeenLastCalledWith(selectedJob.number);

    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
