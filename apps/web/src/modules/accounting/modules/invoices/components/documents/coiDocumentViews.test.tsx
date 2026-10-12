import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CoiComplianceChecks, CoiComplianceHeader, CoiStatusBanner } from "@/modules/accounting/modules/invoices/components/documents/coiDocumentViews";
import type { CoiComplianceResult } from "@/modules/accounting/modules/invoices/types/api";
import { PanelNoticeObserver, PanelNoticeOutlet, PanelNoticeProvider } from "./PanelNotice";

const compliance: CoiComplianceResult = { verdict: "non-compliant", evaluatedAt: "2026-07-30T12:00:00.000Z", configVersion: "2026-07-30", configVersionId: "v1", checks: [{ id: "additional-insured", label: "Additional insured", rawStatus: "fail", effectiveStatus: "fail", provenance: "computed", detail: "Missing endorsement.", required: true }], coverageFailures: [], coverageExceptions: [], expiration: { value: { state: "unknown", expirationDate: null, daysRemaining: null }, provenance: "extracted", permittedActions: [], blockers: [] }, vendorCode: { value: null, provenance: "extracted", permittedActions: [], blockers: [] }, blockers: [{ code: "COI_BLOCKED", message: "Additional insured is required." }], uploadReady: false };

describe("COI document views", () => {
  it("counts only non-passing checks with stable ids and tab metadata", () => {
    const onChange = vi.fn();
    const view = (cleared: boolean) => <PanelNoticeProvider documentId="coi-1">
      <CoiComplianceChecks compliance={{ ...compliance, checks: [
        { ...compliance.checks[0], effectiveStatus: cleared ? "pass" : "fail" },
        { ...compliance.checks[0], id: "coverage-limits", label: "Coverage limits", effectiveStatus: cleared ? "pass" : "warn" },
        { ...compliance.checks[0], id: "passed", label: "Passing record", effectiveStatus: "pass" },
      ] }} onApprove={vi.fn()} />
      <PanelNoticeOutlet /><PanelNoticeObserver onChange={onChange} />
    </PanelNoticeProvider>;
    const { rerender } = render(view(false));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "coi-check-additional-insured", tabId: "details", resolved: false }),
      expect.objectContaining({ id: "coi-check-coverage-limits", tabId: "coverage", resolved: false }),
    ]);
    expect(screen.getByTestId("panel-notice-outlet")).not.toContainElement(screen.getByText("Passing record"));
    rerender(view(true));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByTestId("panel-notice-outlet")).toBeEmptyDOMElement();
    expect(screen.getByText("Additional insured")).toBeInTheDocument();
  });
  it("presents the server verdict, config, blockers, and effective statuses unchanged", () => {
    const { container } = render(<div><CoiComplianceHeader compliance={compliance} /><CoiStatusBanner compliance={compliance} /><CoiComplianceChecks compliance={compliance} onApprove={vi.fn()} canOverride /></div>);
    expect(screen.getAllByText("Non-Compliant").length).toBeGreaterThan(0);
    expect(screen.getByText(/Config 2026-07-30/)).toBeInTheDocument();
    expect(screen.getAllByText("Additional insured is required.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.queryByText("Required")).not.toBeInTheDocument();
    expect(screen.queryByText("Blocking")).not.toBeInTheDocument();
    expect(container.querySelector(".sm\\:flex-row")).toBeInTheDocument();
  });
});
