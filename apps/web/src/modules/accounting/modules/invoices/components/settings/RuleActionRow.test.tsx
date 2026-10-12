import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { RuleAction, RuleActionType } from "@/modules/accounting/modules/invoices/types/rules";

const CATALOGS = vi.hoisted(() => ({ classificationsError: false, costTypesError: false }));

vi.mock("@/modules/shared/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", async () => {
  const { SEEDED_RULE_OPTIONS } = await import("@/modules/accounting/modules/invoices/components/settings/ruleOptionsFixture");
  return {
  useRuleOptions: () => ({
    data: SEEDED_RULE_OPTIONS,
    isError: false,
    isLoading: false,
  }),
  useVendorSearch: () => ({
    data: [{ code: "VEN01", name: "Vendor One" }],
    isLoading: false,
  }),
  useJobSearch: () => ({
    data: [{ number: "26-401", description: "First Job", address: "1 Main St" }],
    isLoading: false,
  }),
  useJobByNumber: () => ({ data: null }),
  useClassifications: () => ({
    classifications: [
      { name: "invoice", label: "Invoice", status: "active" },
      { name: "pay-application", label: "Pay Application", status: "active" },
    ],
    isError: CATALOGS.classificationsError,
    isLoading: false,
  }),
  useCostTypes: () => ({ data: { costTypes: [{ value: "M", label: "M - Material" }] }, isError: CATALOGS.costTypesError, isLoading: false }),
  usePhaseCodes: () => ({
    data: {
      phase_codes: [{ phase_code: "09600", description: "Flooring", default_cost_type: "M" }],
      cost_types: ["M"],
    },
    isLoading: false,
  }),
  useGlAccounts: () => ({
    data: [{ code: "5300", description: "Materials Job Cost" }],
    isLoading: false,
    isError: false,
  }),
  useGlAccountByCode: (code?: string | null) => ({
    data: code === "5300" ? { code: "5300", description: "Materials Job Cost" } : null,
  }),
  useRoutingCodes: () => ({
    data: { routing_codes: [{ code: "JS", description: "John Smith" }], pm_to_routing: {} },
    isLoading: false,
  }),
  };
});

import { RuleActionRow } from "@/modules/accounting/modules/invoices/components/settings/RuleActionRow";

function renderRow(action: RuleAction, onChange = vi.fn()) {
  render(
    <RuleActionRow
      action={action}
      onChange={onChange}
      onRemove={vi.fn()}
      showRemove={false}
    />,
  );
  return onChange;
}

describe("RuleActionRow", () => {
  beforeEach(() => {
    CATALOGS.classificationsError = false;
    CATALOGS.costTypesError = false;
  });
  it("searches the alphabetized action selector", async () => {
    const user = userEvent.setup();
    const onChange = renderRow({ type: "add_note", value: "Remember this" });

    await user.click(screen.getByRole("combobox", { name: "Add note" }));
    await user.type(screen.getByPlaceholderText("Search actions…"), "routing");

    expect(screen.getByRole("option", { name: /Set routing code/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Set vendor/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /Set routing code/ }));
    expect(onChange).toHaveBeenCalledWith({ type: "set_routing_code", value: "" });
  });

  it.each([
    ["set_vendor", "Select vendor…", "Search vendors…", "VEN01 — Vendor One", "VEN01"],
    ["set_job", "Select job…", "Search jobs…", "26-401 — First Job", "26-401"],
    ["set_classification", "Select document type…", "Search document types…", "Pay Application", "pay-application"],
    ["set_phase_code", "Select phase code…", "Search phase codes…", "09600 - Flooring", "09600"],
    ["set_gl_account", "Select GL account…", "Search GL accounts…", "5300 - Materials Job Cost", "5300"],
    ["set_cost_type", "Select cost type…", "Search cost types…", "M - Material", "M"],
    ["set_routing_code", "Select routing code…", "Search routing codes…", "JS - John Smith", "JS"],
  ] as const)("uses a searchable data-backed picker for %s", async (type, placeholder, searchPlaceholder, optionLabel, stableValue) => {
    const user = userEvent.setup();
    const onChange = renderRow({ type: type as RuleActionType, value: "" });

    await user.click(screen.getByRole("combobox", { name: placeholder }));
    const search = screen.getByPlaceholderText(searchPlaceholder);
    await user.type(search, optionLabel.split(/[ -]/)[0]);
    await user.click(screen.getByRole("option", { name: new RegExp(optionLabel) }));

    expect(onChange).toHaveBeenCalledWith({ type, value: stableValue });
  });

  it.each([
    ["set_vendor", "VEN01 — Vendor One", "Search vendors…"],
    ["set_job", "26-401 — First Job", "Search jobs…"],
    ["set_phase_code", "09600 - Flooring", "Search phase codes…"],
    ["set_gl_account", "5300 - Materials Job Cost", "Search GL accounts…"],
    ["set_cost_type", "M - Material", "Search cost types…"],
    ["set_routing_code", "JS - John Smith", "Search routing codes…"],
  ] as const)("searches and selects Clear value for %s", async (type, currentLabel, searchPlaceholder) => {
    const user = userEvent.setup();
    const currentValue = type === "set_vendor" ? "VEN01"
      : type === "set_job" ? "26-401"
        : type === "set_phase_code" ? "09600"
          : type === "set_gl_account" ? "5300"
            : type === "set_cost_type" ? "M" : "JS";
    const onChange = renderRow({ type, value: currentValue });

    await user.click(screen.getByRole("combobox", { name: currentLabel }));
    await user.type(screen.getByPlaceholderText(searchPlaceholder), "clear");
    await user.click(screen.getByRole("option", { name: "Clear value" }));

    expect(onChange).toHaveBeenCalledWith({ type, clear: true });
  });

  it("removes clear state when a normal value is selected", async () => {
    const user = userEvent.setup();
    const onChange = renderRow({ type: "set_phase_code", clear: true });

    await user.click(screen.getByRole("combobox", { name: "Clear value" }));
    await user.type(screen.getByPlaceholderText("Search phase codes…"), "flooring");
    await user.click(screen.getByRole("option", { name: "09600 - Flooring" }));

    expect(onChange).toHaveBeenCalledWith({ type: "set_phase_code", value: "09600" });
  });

  it("does not leak clear or value state when changing action type", async () => {
    const user = userEvent.setup();
    const onChange = renderRow({ type: "set_phase_code", clear: true });

    await user.click(screen.getByRole("combobox", { name: "Set phase code" }));
    await user.type(screen.getByPlaceholderText("Search actions…"), "routing");
    await user.click(screen.getByRole("option", { name: "Set routing code" }));

    expect(onChange).toHaveBeenCalledWith({ type: "set_routing_code", value: "" });
  });

  it("does not offer Clear value for document classification", async () => {
    const user = userEvent.setup();
    renderRow({ type: "set_classification", value: "invoice" });

    await user.click(screen.getByRole("combobox", { name: "Invoice" }));
    await user.type(screen.getByPlaceholderText("Search document types…"), "clear");

    expect(screen.queryByRole("option", { name: "Clear value" })).not.toBeInTheDocument();
  });

  it("keeps reviewer and note actions as text inputs", () => {
    renderRow({ type: "assign_reviewer", value: "Dana" });
    expect(screen.getByDisplayValue("Dana")).toHaveAttribute("placeholder", "Reviewer name or user ID");
  });

  it("shows an unavailable state instead of local cost-type labels when the catalog fails", () => {
    CATALOGS.costTypesError = true;
    renderRow({ type: "set_cost_type", value: "M" });

    expect(screen.getByText("Cost type options unavailable")).toBeInTheDocument();
    expect(screen.queryByText("M - Material")).not.toBeInTheDocument();
  });

  it("shows an unavailable state instead of an empty classification picker when the catalog fails", () => {
    CATALOGS.classificationsError = true;
    renderRow({ type: "set_classification", value: "invoice" });

    expect(screen.getByText("Classification options unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Select document type…" })).not.toBeInTheDocument();
  });
});
