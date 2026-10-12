import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", async () => {
  const { SEEDED_RULE_OPTIONS } = await import("@/modules/accounting/modules/invoices/components/settings/ruleOptionsFixture");
  return {
    useRuleOptions: () => ({ data: SEEDED_RULE_OPTIONS, isError: false, isLoading: false }),
  };
});

import {
  RuleActionList,
  RuleActionSummary,
  RuleActiveSwitch,
  RuleCriteriaChips,
} from "@/modules/accounting/modules/invoices/components/settings/RuleWorkspaceAtoms";

describe("RuleWorkspaceAtoms", () => {
  it("renders criteria chips, action lists, summaries, and stats", () => {
    render(
      <div>
        <RuleCriteriaChips
          criteria={[
            { field: "vendor_name", operator: "contains", values: ["ACME"] },
            { field: "job_number", operator: "equals", values: ["24-001"] },
          ]}
        />
        <RuleActionList
          actions={[{ type: "set_job", value: "24-001" }, { type: "flag" }]}
          stopOnMatch
        />
        <RuleActionSummary actions={[{ type: "auto_file" }, { type: "add_note", value: "Needs review" }]} stopOnMatch={false} />
        <RuleActionSummary actions={[{ type: "set_phase_code", clear: true }]} stopOnMatch={false} />
      </div>,
    );

    expect(screen.getByText("Vendor Name contains")).toBeInTheDocument();
    expect(screen.getAllByText("24-001")).toHaveLength(2);
    expect(screen.getByText("Set job number")).toBeInTheDocument();
    expect(screen.getByText("Stop processing further rules")).toBeInTheDocument();
    expect(screen.getByText("File it")).toBeInTheDocument();
    expect(screen.getByText("Clear phase code")).toBeInTheDocument();
  });

  it("calls the active switch change handler", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(
      <RuleActiveSwitch
        checked={false}
        label="ACME invoices active"
        onCheckedChange={onCheckedChange}
      />,
    );

    await user.click(screen.getByRole("switch", { name: "ACME invoices active" }));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("shows compact sender addresses as complete local and domain pieces", () => {
    const sender = "accounts-payable@very-long-vendor.example";
    render(
      <RuleCriteriaChips
        compact
        criteria={[{ field: "email_from", operator: "equals", values: [sender] }]}
      />,
    );

    const address = screen.getByLabelText(sender);
    expect(address).not.toHaveClass("truncate");
    expect(address).toHaveTextContent("accounts-payable");
    expect(address).toHaveTextContent("@very-long-vendor.example");
  });
});
