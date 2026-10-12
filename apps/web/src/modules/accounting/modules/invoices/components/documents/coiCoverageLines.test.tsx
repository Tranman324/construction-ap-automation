import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CoiCoverageLines } from "@/modules/accounting/modules/invoices/components/documents/coiCoverageLines";
import { PanelNoticeObserver, PanelNoticeOutlet, PanelNoticeProvider } from "./PanelNotice";

describe("CoiCoverageLines", () => {
  it("keeps transported evidence distinguishable for two coverages with identical limit labels", () => {
    const coverages = [{ id: "gl", label: "General Liability" }, { id: "auto", label: "Automobile Liability" }];
    render(<PanelNoticeProvider documentId="coi-2">
      <CoiCoverageLines coverageLines={coverages.map((line) => ({ ...line, carrier: "Synthetic", policyNumber: line.id, expirationDate: null, limits: [] }))}
        coverageFailures={coverages.map((line) => ({ coverageId: line.id, coverageLabel: line.label, limitLabel: "Each occurrence", value: 100, minimum: 200 }))}
        coverageExceptions={coverages.map((line) => ({ coverageId: line.id, coverageLabel: line.label, limitLabel: "Medical", value: null, minimum: 50 }))}
        expandedCoverage={{}} onToggle={vi.fn()} />
      <PanelNoticeOutlet />
    </PanelNoticeProvider>);
    const outlet = within(screen.getByTestId("panel-notice-outlet"));
    for (const { label } of coverages) {
      const failure = within(outlet.getByRole("group", { name: `${label} coverage minimums` }));
      expect(failure.getByText(label)).toBeVisible();
      expect(failure.getByText("Each occurrence: server minimum $200.00")).toBeVisible();
      const information = within(outlet.getByRole("group", { name: `${label} informational limits` }));
      expect(information.getByText(label)).toBeVisible();
      expect(information.getByText("Not enforced — informational: Medical: reference minimum $50.00")).toBeVisible();
    }
  });
  it("portals failure and exception evidence while raw policy data stays inline", () => {
    const onChange = vi.fn();
    render(<PanelNoticeProvider documentId="coi-1"><div data-testid="inline-coverage">
      <CoiCoverageLines coverageLines={[{ id: "gl", label: "General Liability", carrier: "Synthetic", policyNumber: "GL-1", expirationDate: null, limits: [{ label: "Each occurrence", value: 100 }] }]}
        coverageFailures={[{ coverageId: "gl", coverageLabel: "General Liability", limitLabel: "Each occurrence", value: 100, minimum: 200 }]}
        coverageExceptions={[{ coverageId: "other", coverageLabel: "Other Coverage", limitLabel: "Medical", value: null, minimum: 50 }]}
        expandedCoverage={{}} onToggle={vi.fn()} />
    </div><PanelNoticeOutlet /><PanelNoticeObserver onChange={onChange} /></PanelNoticeProvider>);
    const inline = screen.getByTestId("inline-coverage");
    const outlet = screen.getByTestId("panel-notice-outlet");
    expect(inline).toContainElement(screen.getByText(/GL-1 - Synthetic/));
    expect(inline).toContainElement(screen.getByText("$100.00"));
    expect(outlet).toContainElement(screen.getByText("Each occurrence: server minimum $200.00"));
    expect(outlet).toContainElement(screen.getByText("Not enforced — informational: Medical: not reported; reference minimum $50.00"));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "coi-coverage-failure-gl", tabId: "coverage", resolved: false }),
      expect.objectContaining({ id: "coi-coverage-exception-other-Medical", tabId: "coverage", resolved: true }),
    ]);
  });
  it("renders raw limits and server-reported coverage failures without comparing values", () => {
    render(<CoiCoverageLines coverageLines={[{ id: "gl", label: "General Liability", carrier: "Travelers", policyNumber: "GL-1", expirationDate: "2027-06-30", limits: [{ label: "Each occurrence", value: 1000000 }] }]} coverageFailures={[{ coverageId: "gl", coverageLabel: "General Liability", limitLabel: "Each occurrence", value: 1000000, minimum: 2000000 }]} coverageExceptions={[]} expandedCoverage={{}} onToggle={vi.fn()} />);
    expect(screen.getAllByText("General Liability")).toHaveLength(2);
    expect(screen.getByText("Each occurrence: server minimum $2,000,000.00")).toBeInTheDocument();
  });

  it("renders an alias-matched server failure that has no raw extracted coverage-line match", () => {
    render(<CoiCoverageLines coverageLines={[{ id: "cgl", label: "CGL", carrier: "Travelers", policyNumber: "GL-1", expirationDate: "2027-06-30", limits: [] }]} coverageFailures={[{ coverageId: "general-liability", coverageLabel: "General Liability", limitLabel: "Each occurrence", value: 1000000, minimum: 2000000 }]} coverageExceptions={[]} expandedCoverage={{}} onToggle={vi.fn()} />);

    expect(screen.getByText("General Liability")).toBeInTheDocument();
    expect(screen.getByText("Each occurrence: $1,000,000.00; server minimum $2,000,000.00")).toBeInTheDocument();
  });

  it("renders server exception rows as informational rather than failures", () => {
    render(<CoiCoverageLines coverageLines={[]} coverageFailures={[]} coverageExceptions={[{ coverageId: "general-liability", coverageLabel: "General Liability", limitLabel: "Medical Expense", value: null, minimum: 5000 }]} expandedCoverage={{}} onToggle={vi.fn()} />);
    expect(screen.getByText("Not enforced — informational: Medical Expense: not reported; reference minimum $5,000.00")).toBeInTheDocument();
  });
});
