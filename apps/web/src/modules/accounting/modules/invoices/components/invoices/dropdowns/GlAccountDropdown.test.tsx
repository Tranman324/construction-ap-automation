import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GlAccountDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/GlAccountDropdown";
import { Field } from "@/modules/shared/components/patterns/Field";
import { getInvoiceFieldState } from "@/modules/shared/components/patterns/invoiceFieldState";

type GlAccount = { code: string; description: string };

const M = vi.hoisted(() => ({
  results: [] as GlAccount[],
  byCode: null as GlAccount | null,
  isError: false,
  searchTerms: [] as (string | undefined)[],
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useGlAccounts: (search?: string) => {
    M.searchTerms.push(search);
    return { data: M.results, isLoading: false, isError: M.isError };
  },
  useGlAccountByCode: (code?: string | null) => ({
    data: code && M.byCode?.code === code ? M.byCode : null,
  }),
}));

beforeEach(() => {
  M.results = [];
  M.byCode = null;
  M.isError = false;
  M.searchTerms = [];
});

describe("GlAccountDropdown (server-search GL typeahead)", () => {
  it("puts the shared invoice field accent on the actual GL trigger", () => {
    render(<Field label="GL Account" htmlFor="gl" invoiceState={getInvoiceFieldState({ value: "5450", baseline: "5300", required: true })}>
      <GlAccountDropdown id="gl" value="5450" onChange={vi.fn()} />
    </Field>);
    expect(screen.getByRole("combobox")).toHaveClass("border-l-tone-violet", "dark:border-l-tone-violet", "border-l-[3px]");
  });
  it("issues the typed term to the search hook and renders the returned accounts", async () => {
    const user = userEvent.setup();
    M.results = [
      { code: "5450", description: "Subcontract Job Cost" },
      { code: "5300", description: "Materials Job Cost" },
    ];
    const onChange = vi.fn();
    render(<GlAccountDropdown value={null} onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "Select GL account…" }));
    await user.type(screen.getByPlaceholderText("Search GL accounts…"), "5450");

    // The typed text reaches the hook — search is server-side, not a client filter.
    expect(M.searchTerms).toContain("5450");
    // The server's returned accounts render as selectable options.
    const option = screen.getByRole("option", { name: /5450 - Subcontract Job Cost/ });
    expect(option).toBeInTheDocument();
    await user.click(option);
    expect(onChange).toHaveBeenCalledWith("5450");
  });

  it("keeps the SELECTED account label even when it is not on the active search page (load-bearing)", () => {
    // The active page does NOT contain the selected 5450 (e.g. empty/other search)...
    M.results = [{ code: "5300", description: "Materials Job Cost" }];
    // ...but the by-code resolver supplies its label so a pre-filled 5450 never
    // collapses to a bare code.
    M.byCode = { code: "5450", description: "Subcontract Job Cost" };

    render(<GlAccountDropdown value="5450" onChange={vi.fn()} />);

    expect(
      screen.getByRole("combobox", { name: "5450 - Subcontract Job Cost" }),
    ).toBeInTheDocument();
  });

  it("renders an unavailable hint when the GL fetch errors (not merely empty results)", () => {
    M.isError = true;
    render(<GlAccountDropdown value={null} onChange={vi.fn()} />);
    expect(screen.getByText(/GL accounts unavailable/i)).toBeInTheDocument();
  });
});
