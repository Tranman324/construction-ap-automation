import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResolveCard } from "./ResolveCard";
import { ResolveCardEvidence } from "./ResolveCardEvidence";
import type { CompareRow, Evidence, ResolveCardModel } from "./resolveCardModel";

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasAnyPermission: () => true }),
}));

const amountRow = (a: number, b: number, differs?: boolean): CompareRow => ({
  label: "Amount", a: { kind: "money", value: a }, b: { kind: "money", value: b }, differs, testid: "duplicate-amounts",
});

function compareCard(rows: readonly CompareRow[], columns: readonly [string, string] = ["This invoice", "Original · Approved"]): ResolveCardModel {
  return { id: "duplicate", tone: "blocking", title: "Possible duplicate", evidence: { layout: "compare", columns, rows } };
}

const toolboxRows: CompareRow[] = [
  { label: "Invoice #", a: { kind: "mono", value: "53-477", note: "→ 53477" }, b: { kind: "mono", value: "53477" } },
  amountRow(74877, 74787, true),
  { label: "File", a: null, b: { kind: "mono", value: "VANT01_53477.pdf" } },
];

describe("ResolveCardEvidence compare layout", () => {
  it("CARD-03 renders the evidence table with headers, values, differs tag and mismatch cell", () => {
    render(<ResolveCard model={compareCard(toolboxRows)} />);
    const table = screen.getByRole("table", { name: "Evidence" });
    for (const text of ["This invoice", "Original · Approved", "53-477", "→ 53477", "53477", "$74,877.00", "$74,787.00", "—", "VANT01_53477.pdf"]) {
      expect(within(table).getByText(text)).toBeInTheDocument();
    }
    const mine = screen.getByTestId("duplicate-amounts");
    expect(mine).toHaveAttribute("data-mismatch", "true");
    expect(mine).toHaveTextContent("$74,877.00");
    const theirs = mine.nextElementSibling;
    expect(theirs).toHaveTextContent("$74,787.00");
    expect(within(theirs as HTMLElement).getByText("differs")).toBeInTheDocument();
    expect(theirs).toHaveClass("bg-rc-wash", "font-bold", "text-rc-icon");
  });

  it("CARD-03b the compare grid is valid ARIA: rows own header, rowheader and cell roles (M6)", () => {
    render(<ResolveCard model={compareCard(toolboxRows)} />);
    const table = screen.getByRole("table", { name: "Evidence" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.parentElement === table && row.classList.contains("contents"))).toBe(true);
    expect(within(rows[0]).getAllByRole("columnheader", { hidden: true }).map((h) => h.textContent)).toEqual(["", "This invoice", "Original · Approved"]);
    expect(within(rows[2]).getByRole("rowheader")).toHaveTextContent("Amount");
    expect(within(rows[2]).getAllByRole("cell").map((c) => c.textContent)).toEqual(["$74,877.00", "$74,787.00differs"]);
    expect(within(rows[2]).getAllByRole("cell")[0]).toBe(screen.getByTestId("duplicate-amounts"));
    expect(within(rows[3]).getAllByRole("cell")[0]).toHaveTextContent("—");
  });

  it("CARD-04 equal amounts are not marked as a mismatch", () => {
    render(<ResolveCard model={compareCard([amountRow(9642, 9642)])} />);
    expect(screen.getByTestId("duplicate-amounts")).toHaveAttribute("data-mismatch", "false");
    expect(screen.queryByText("differs")).toBeNull();
  });

  it("CARD-05 renders money and a null counterpart as an em dash", () => {
    const row: CompareRow = { label: "Amount", a: { kind: "money", value: 10929 }, b: null, differs: true };
    render(<ResolveCard model={compareCard([row], ["Statement", "In AP"])} />);
    const table = screen.getByRole("table", { name: "Evidence" });
    expect(within(table).getByText("$10,929.00")).toBeInTheDocument();
    expect(within(table).getByText("—")).toHaveClass("text-muted-foreground");
  });

  it("omits data-mismatch on rows without a test id", () => {
    render(<ResolveCard model={compareCard(toolboxRows)} />);
    expect(screen.getByText("53-477").closest("[data-mismatch]")).toBeNull();
  });

  it("uses the design grid, header and cell classes", () => {
    render(<ResolveCard model={compareCard(toolboxRows)} />);
    expect(screen.getByRole("table")).toHaveClass(
      "grid-cols-[minmax(76px,max-content)_minmax(0,1fr)_minmax(0,1fr)]", "rounded-[8px]", "border-rc-line", "bg-card", "text-xs",
    );
    expect(screen.getByText("This invoice")).toHaveClass("text-[9.5px]", "font-bold", "uppercase", "tracking-[.06em]", "px-2.5", "py-[5px]");
    expect(screen.getByText("Invoice #")).toHaveClass("px-2.5", "py-1.5", "font-medium", "text-muted-foreground");
    expect(screen.getByText("differs")).toHaveClass("text-[9.5px]", "font-bold", "uppercase", "tracking-[.04em]", "text-rc-ink", "bg-rc-tint", "border-rc-line", "rounded-full");
    expect(screen.getByText("53-477")).toHaveClass("font-mono", "tabular-nums");
    expect(screen.getByText("→ 53477")).toHaveClass("text-muted-foreground");
  });
});

describe("ResolveCardEvidence facts layout", () => {
  const closedPeriodEvidence: Evidence = {
    layout: "facts",
    rows: [
      { label: "Invoice date", value: { kind: "date", value: "2026-09-28" }, bad: true },
      { label: "Open period", value: "Oct 2026" },
    ],
  };
  const closedPeriod: ResolveCardModel = { id: "closed-period", tone: "blocking", title: "Closed period", evidence: closedPeriodEvidence };

  it("CARD-06 marks only the bad fact", () => {
    const { container } = render(<ResolveCard model={closedPeriod} />);
    expect(container.querySelectorAll("dt")).toHaveLength(2);
    expect(screen.getByText("Invoice date").tagName).toBe("DT");
    const bad = screen.getByText("Sep 28, 2026").closest("dd");
    const ok = screen.getByText("Oct 2026").closest("dd");
    expect(bad).toHaveClass("text-rc-icon", "font-bold");
    expect(ok).not.toHaveClass("text-rc-icon");
    expect(ok).not.toHaveClass("font-bold");
  });

  it("CARD-07 renders every required field row", () => {
    const rows = ["Vendor name", "Vendor type", "Tax classification", "Tax ID"].map((label) => ({ label, value: "Required", bad: true }));
    const { container } = render(
      <ResolveCard model={{ id: "w9-required", tone: "blocking", title: "4 required fields", context: "vendor identity", evidence: { layout: "facts", rows } }} />,
    );
    expect(screen.getByText("4 required fields")).toBeInTheDocument();
    expect(screen.getByText("· vendor identity")).toBeInTheDocument();
    expect(container.querySelectorAll("dt")).toHaveLength(4);
    expect(screen.getAllByText("Required")).toHaveLength(4);
  });

  it("uses the design facts grid and removes the top rule on the first row", () => {
    const { container } = render(<ResolveCardEvidence evidence={closedPeriodEvidence} />);
    expect(container.querySelector("dl")).toHaveClass("grid-cols-[max-content_minmax(0,1fr)]", "rounded-[8px]", "border-rc-line", "bg-card", "text-xs");
    const keys = container.querySelectorAll("dt");
    expect(keys[0]).toHaveClass("border-t-0", "px-2.5", "py-[5px]");
    expect(keys[1]).not.toHaveClass("border-t-0");
  });
});
