import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DashboardPanelFilters, DASHBOARD_PANELS, getTrackEdges } from "@/modules/accounting/modules/invoices/components/dashboard/DashboardPanelFilters";
import type { ClassificationPanelMetadata } from "@/modules/accounting/modules/invoices/types/api";
import { expectDomOrder, expectNoPositiveTabIndex } from "../tabOrderAssertions";

describe("DashboardPanelFilters", () => {
  describe("dashboard filter tab order", () => {
    it("keeps panel tabs, search, and active filter controls left-to-right", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <DashboardPanelFilters
          value="receipt" onChange={vi.fn()} flaggedActive flaggedCount={2}
          search={{ value: "", open: false, onOpen: vi.fn(), onClose: vi.fn(), onChange: vi.fn() }}
        >
          <button type="button">Job 25-401</button>
        </DashboardPanelFilters>,
      );
      const order = [
        screen.getByRole("button", { name: "Flagged (2)" }),
        screen.getByRole("button", { name: "All types" }),
        screen.getByRole("button", { name: "Invoices" }),
        screen.getByRole("button", { name: "Receipts" }),
        screen.getByRole("button", { name: "Statements" }),
        screen.getByRole("button", { name: "COI" }),
        screen.getByRole("button", { name: "W-9" }),
        screen.getByRole("button", { name: "Lien Waivers" }),
        screen.getByRole("button", { name: "Other" }),
        screen.getByRole("button", { name: "Search" }),
        screen.getByRole("button", { name: "Job 25-401" }),
      ];
      expectDomOrder(order);
      expectNoPositiveTabIndex(container);
      order[0].focus();
      await user.tab();
      expect(document.activeElement).toBe(order[1]);
    });
  });

  function SearchHarness() {
    const [value, setValue] = useState("");
    const [open, setOpen] = useState(false);
    return <DashboardPanelFilters onChange={vi.fn()} search={{ value, open, onChange: setValue,
      onOpen: () => setOpen(true), onClose: () => { setValue(""); setOpen(false); } }}>
      <button role="combobox" aria-expanded="false" aria-controls="synthetic-jobs">All jobs</button>
    </DashboardPanelFilters>;
  }

  it.each(["button", "Escape"])("expands and focuses search; %s clears, collapses, and returns focus", async (method) => {
    const user = userEvent.setup();
    render(<SearchHarness />);
    expect(screen.getByRole("group", { name: "Document filters" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute("title", expect.stringContaining("Search •"));
    await user.click(screen.getByRole("button", { name: "Search" }));
    const input = screen.getByRole("textbox", { name: "Search vendor, invoice number, or job" });
    expect(input).toHaveFocus();
    expect(screen.queryByRole("button", { name: "All types" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flagged" })).toBeVisible();
    expect(screen.getByRole("combobox")).toBeVisible();
    await user.type(input, "invoice-123");
    if (method === "button") await user.click(screen.getByRole("button", { name: "Close search" }));
    else await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("never hides a supplied active query even when open is false", () => {
    render(<DashboardPanelFilters onChange={vi.fn()} search={{ value: "from-url", open: false, onChange: vi.fn(), onOpen: vi.fn(), onClose: vi.fn() }} />);
    expect(screen.getByRole("textbox")).toHaveValue("from-url");
    expect(screen.queryByRole("button", { name: "All types" })).not.toBeInTheDocument();
  });

  it("keeps the edge setter idempotent, including absent/non-overflowing tracks", () => {
    const none = { l: false, r: false };
    expect(getTrackEdges(none, null)).toBe(none);
    expect(getTrackEdges(none, { clientWidth: 600, scrollWidth: 600, scrollLeft: 0 })).toBe(none);
    const right = getTrackEdges(none, { clientWidth: 200, scrollWidth: 600, scrollLeft: 0 });
    expect(right).toEqual({ l: false, r: true });
    expect(getTrackEdges(right, { clientWidth: 200, scrollWidth: 600, scrollLeft: 0 })).toBe(right);
    expect(getTrackEdges(right, { clientWidth: 200, scrollWidth: 600, scrollLeft: 200 })).toEqual({ l: true, r: true });
    expect(getTrackEdges(right, { clientWidth: 200, scrollWidth: 600, scrollLeft: 400 })).toEqual({ l: true, r: false });
  });

  it("updates fades on scroll, every render, and window resize without observer callbacks", () => {
    const { container, rerender } = render(<DashboardPanelFilters onChange={vi.fn()} />);
    const track = container.querySelector(".tbx-rail__track")!;
    let width = 600;
    Object.defineProperties(track, { clientWidth: { get: () => width }, scrollWidth: { value: 600 }, scrollLeft: { value: 0, writable: true } });
    fireEvent.scroll(track);
    expect(track).not.toHaveClass("has-l", "has-r");
    width = 200;
    fireEvent(window, new Event("resize"));
    expect(track).toHaveClass("has-r");
    expect(track).not.toHaveClass("has-l");
    track.scrollLeft = 200;
    fireEvent.scroll(track);
    expect(track).toHaveClass("has-l", "has-r");
    track.scrollLeft = 400;
    fireEvent.scroll(track);
    expect(track).toHaveClass("has-l");
    expect(track).not.toHaveClass("has-r");
    width = 600;
    track.scrollLeft = 0;
    rerender(<DashboardPanelFilters onChange={vi.fn()} flaggedCount={10} />);
    expect(track).not.toHaveClass("has-l", "has-r");
    for (const nextWidth of [180, 600, 292, 600]) {
      width = nextWidth;
      act(() => { window.dispatchEvent(new Event("resize")); });
      expect(track.classList.contains("has-r")).toBe(nextWidth < 600);
    }
  });

  it("renders Flagged as an enabled red review chip", () => {
    render(<DashboardPanelFilters onChange={vi.fn()} flaggedActive />);
    const flagged = screen.getByRole("button", { name: "Flagged" });
    expect(flagged).not.toBeDisabled();
    expect(flagged).toHaveClass("rounded-full", "border-red-300", "bg-red-50", "text-red-700", "font-semibold");
    expect(flagged.querySelector("svg")).toHaveClass("text-red-500");
  });

  it("reconnects the observer when chips return and cleans up the resize listener", () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class { observe = observe; disconnect = disconnect; });
    const remove = vi.spyOn(window, "removeEventListener");
    try {
      const search = { value: "", open: false, onOpen: vi.fn(), onClose: vi.fn(), onChange: vi.fn() };
      const { rerender, unmount } = render(<DashboardPanelFilters onChange={vi.fn()} search={search} />);
      expect(observe).toHaveBeenCalledTimes(1);
      rerender(<DashboardPanelFilters onChange={vi.fn()} search={{ ...search, open: true }} />);
      expect(disconnect).toHaveBeenCalledTimes(1);
      rerender(<DashboardPanelFilters onChange={vi.fn()} search={search} />);
      expect(observe).toHaveBeenCalledTimes(2);
      unmount();
      expect(disconnect).toHaveBeenCalledTimes(2);
      expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    } finally {
      vi.unstubAllGlobals();
      remove.mockRestore();
    }
  });
  it("pill taxonomy parity: every served classification filterGroup maps to a rendered TYPE pill, in order", () => {
    // The TYPE pill list is UI presentation (label+color) over the fixed served
    // filterGroup taxonomy (ClassificationPanelMetadata.filterGroup). This guard
    // proves the TYPE pill values exactly equal the taxonomy so the server cannot
    // emit a filterGroup with no pill, and no type pill is dropped/reordered.
    // "Flagged" is a distinct prepended NON-type entry (a cross-status review
    // filter, the product owner-directed) and is deliberately NOT part of this taxonomy.
    const taxonomy: ReadonlyArray<ClassificationPanelMetadata["filterGroup"]> = [
      "invoice", "receipt", "statement", "coi", "w9", "lien-waiver", "other",
    ];
    expect(DASHBOARD_PANELS.map((p) => p.value)).toEqual(taxonomy);
    // The Flagged entry is not smuggled into the type taxonomy.
    expect(DASHBOARD_PANELS.map((p) => String(p.value))).not.toContain("flagged");
  });

  it("renders the Flagged pill first, then All Types and every type group, and delegates type changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onFlaggedSelect = vi.fn();

    render(
      <DashboardPanelFilters
        value="coi"
        onChange={onChange}
        flaggedCount={3}
        onFlaggedSelect={onFlaggedSelect}
      />,
    );

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Flagged3",
      "All types",
      "Invoices",
      "Receipts",
      "Statements",
      "COI",
      "W-9",
      "Lien Waivers",
      "Other",
    ]);
    expect(screen.getByRole("button", { name: "COI" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All types" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Flagged (3)" })).toHaveAttribute("aria-pressed", "false");

    const coi = screen.getByRole("button", { name: "COI" });
    expect(coi).toHaveClass("border-primary/50", "bg-primary/5", "text-primary", "font-semibold");
    await user.click(coi);
    await user.click(screen.getByRole("button", { name: "Statements" }));
    await user.click(screen.getByRole("button", { name: "All types" }));

    expect(onChange).toHaveBeenNthCalledWith(1, undefined);
    expect(onChange).toHaveBeenNthCalledWith(2, "statement");
    expect(onChange).toHaveBeenNthCalledWith(3, undefined);
    expect(onFlaggedSelect).not.toHaveBeenCalled();
  });

  it("marks Flagged and the selected type active independently", async () => {
    const user = userEvent.setup();
    const onFlaggedSelect = vi.fn();

    const { rerender } = render(
      <DashboardPanelFilters
        value="invoice"
        flaggedActive
        flaggedCount={2}
        onFlaggedSelect={onFlaggedSelect}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Flagged (2)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Invoices" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Invoices" })).toHaveClass("border-primary/50", "bg-primary/5", "text-primary", "font-semibold");
    expect(screen.getByRole("button", { name: "All types" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "Flagged (2)" }));
    expect(onFlaggedSelect).toHaveBeenCalledTimes(1);

    rerender(
      <DashboardPanelFilters
        flaggedActive
        flaggedCount={2}
        onFlaggedSelect={onFlaggedSelect}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "All types" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders the Flagged pill without a count when the count is 0 or undefined", () => {
    render(<DashboardPanelFilters onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Flagged" })).toBeInTheDocument();
  });
});
