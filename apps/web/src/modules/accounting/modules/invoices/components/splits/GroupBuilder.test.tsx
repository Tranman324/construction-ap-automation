import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GroupBuilder } from "@/modules/accounting/modules/invoices/components/splits/GroupBuilder";
import type { SplitDocTypeOption, SplitEditorState } from "@/modules/accounting/modules/invoices/lib/splitLayout";
import { TooltipProvider } from "@/modules/shared/components/ui/tooltip";

const docTypeOptions: SplitDocTypeOption[] = [
  { value: "building-permit", label: "Building Permit" },
  { value: "receipt", label: "Receipt" },
  { value: "w9", label: "W-9" },
  { value: "subcontract", label: "Subcontract" },
  { value: "warranty", label: "Warranty" },
  { value: "invoice", label: "Invoice" },
  { value: "lien-waiver", label: "Lien Waiver" },
  { value: "coi", label: "COI" },
  { value: "statement", label: "Statement" },
  { value: "other", label: "Other" },
];

function makeState(): SplitEditorState {
  return {
    groups: [
      { id: "group-1", pages: [1, 2], docType: "invoice", displayName: "INV-100" },
      { id: "group-2", pages: [3], docType: "statement", displayName: "Statement" },
    ],
    discardedPages: [],
    selectedPages: new Set(),
  };
}

describe("GroupBuilder", () => {
  it("updates document classification from the per-group selector", async () => {
    const user = userEvent.setup();
    const onUpdateGroupDocType = vi.fn();

    render(
      <GroupBuilder
        state={makeState()}
        pageCount={3}
        selectedPage={1}
        docTypeOptions={docTypeOptions}
        onCreateGroup={vi.fn()}
        onUpdateGroupName={vi.fn()}
        onUpdateGroupDocType={onUpdateGroupDocType}
        onDiscardSelected={vi.fn()}
        onClearSelection={vi.fn()}
        onSelectAllUnassigned={vi.fn()}
        onSelectGroup={vi.fn()}
        onHoverGroup={vi.fn()}
      />,
    );

    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(await screen.findByRole("option", { name: "COI" }));

    expect(onUpdateGroupDocType).toHaveBeenCalledWith("group-1", "coi");
  });

  it("renders active classification options supplied by the classifications API", async () => {
    const user = userEvent.setup();

    render(
      <GroupBuilder
        state={makeState()}
        pageCount={3}
        selectedPage={1}
        docTypeOptions={docTypeOptions}
        onCreateGroup={vi.fn()}
        onUpdateGroupName={vi.fn()}
        onUpdateGroupDocType={vi.fn()}
        onDiscardSelected={vi.fn()}
        onClearSelection={vi.fn()}
        onSelectAllUnassigned={vi.fn()}
        onSelectGroup={vi.fn()}
        onHoverGroup={vi.fn()}
      />,
    );

    await user.click(screen.getAllByRole("combobox")[0]);

    for (const label of ["Building Permit", "Receipt", "W-9", "Subcontract", "Warranty", "Invoice", "Lien Waiver", "COI", "Statement", "Other"]) {
      expect(await screen.findByRole("option", { name: label })).toBeInTheDocument();
    }
  });

  it("shows select-all only for larger PDFs with unassigned pages and exposes the tooltip", async () => {
    const user = userEvent.setup();
    const onSelectAllUnassigned = vi.fn();
    const state: SplitEditorState = {
      groups: [{ id: "group-1", pages: [1], docType: "invoice", displayName: "Invoice" }],
      discardedPages: [],
      selectedPages: new Set(),
    };

    render(
      <TooltipProvider>
      <GroupBuilder
        state={state}
        pageCount={6}
        selectedPage={1}
        docTypeOptions={docTypeOptions}
        onCreateGroup={vi.fn()}
        onUpdateGroupName={vi.fn()}
        onUpdateGroupDocType={vi.fn()}
        onDiscardSelected={vi.fn()}
        onClearSelection={vi.fn()}
        onSelectAllUnassigned={onSelectAllUnassigned}
        onSelectGroup={vi.fn()}
        onHoverGroup={vi.fn()}
      />
      </TooltipProvider>,
    );

    const selectAll = screen.getByRole("button", { name: "Select all unassigned pages" });
    await user.hover(selectAll);
    expect(await screen.findAllByText("Select all unassigned pages")).not.toHaveLength(0);

    await user.click(selectAll);
    expect(onSelectAllUnassigned).toHaveBeenCalledTimes(1);
  });

  it("hides select-all for small PDFs even when pages are unassigned", () => {
    const state: SplitEditorState = {
      groups: [{ id: "group-1", pages: [1], docType: "invoice", displayName: "Invoice" }],
      discardedPages: [],
      selectedPages: new Set(),
    };

    render(
      <GroupBuilder
        state={state}
        pageCount={5}
        selectedPage={1}
        docTypeOptions={docTypeOptions}
        onCreateGroup={vi.fn()}
        onUpdateGroupName={vi.fn()}
        onUpdateGroupDocType={vi.fn()}
        onDiscardSelected={vi.fn()}
        onClearSelection={vi.fn()}
        onSelectAllUnassigned={vi.fn()}
        onSelectGroup={vi.fn()}
        onHoverGroup={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Select all unassigned pages" })).not.toBeInTheDocument();
    expect(screen.getByText("4 unassigned pages")).toBeInTheDocument();
  });
});
