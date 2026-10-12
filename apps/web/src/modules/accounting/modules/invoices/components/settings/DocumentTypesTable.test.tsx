import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { DocumentTypesTable } from "@/modules/accounting/modules/invoices/components/settings/DocumentTypesTable";
import type { ClassificationAssociation, ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";

const associations: ClassificationAssociation[] = [
  { key: "invoice", label: "Invoice Workflow", description: "Approval and Spectrum workflow." },
  { key: "receipt", label: "Receipt Panel", description: "Receipt review destination." },
  { key: "other", label: "Generic Panel", description: "Fallback review destination." },
];

const rows: ClassificationInfo[] = [
  { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
  { name: "receipt", label: "Receipt", opensAs: "receipt", action: "extract-match", builtIn: true, status: "active" },
  { name: "custom-doc", label: "Custom Doc", opensAs: "other", action: "view-only", builtIn: false, status: "active" },
  { name: "unmapped-doc", label: "Unmapped Doc", opensAs: null, action: "view-only", builtIn: false, status: "active" },
];

function renderTable(overrides?: Partial<ComponentProps<typeof DocumentTypesTable>>) {
  return render(
    <DocumentTypesTable
      rows={rows}
      baselineRows={rows}
      associations={associations}
      pending={false}
      onLabelChange={vi.fn()}
      onOpensAsChange={vi.fn()}
      onToggleStatus={vi.fn()}
      {...overrides}
    />,
  );
}

describe("DocumentTypesTable", () => {
  it("locks invoice while keeping non-invoice built-in destinations assignable", () => {
    renderTable();

    expect(screen.getByRole("button", { name: "Invoice opens as" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Receipt opens as" })).toHaveTextContent("Receipt Panel");
    expect(screen.getAllByText("Built-in")).toHaveLength(2);
    expect(screen.queryByRole("textbox", { name: "invoice label" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "receipt label" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "custom-doc label" })).toHaveValue("Custom Doc");
    expect(screen.queryByRole("columnheader", { name: "Actions" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
  });

  it("renders null opensAs rows as Needs Input with a placeholder", () => {
    renderTable();

    expect(screen.getByText("Needs Input")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Unmapped Doc opens as" })).toHaveTextContent("Choose destination...");
  });

  it("renders association labels and descriptions from the dropdown", async () => {
    const user = userEvent.setup();
    const onOpensAsChange = vi.fn();
    renderTable({ onOpensAsChange });

    await user.click(screen.getByRole("combobox", { name: "Custom Doc opens as" }));
    expect(screen.getByRole("option", { name: /Receipt Panel/ })).toBeInTheDocument();
    expect(screen.getByText("Receipt review destination.")).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /Receipt Panel/ }));

    expect(onOpensAsChange).toHaveBeenCalledWith("custom-doc", "receipt");
  });

  it("updates editable custom labels and shows label validation errors", async () => {
    const user = userEvent.setup();
    const onLabelChange = vi.fn();
    renderTable({
      labelErrors: { "custom-doc": "Label is required." },
      onLabelChange,
    });

    const labelInput = screen.getByRole("textbox", { name: "custom-doc label" });
    await user.clear(labelInput);

    expect(onLabelChange).toHaveBeenCalledWith("custom-doc", "");
    expect(screen.getByText("Label is required.")).toBeInTheDocument();
  });

  it("highlights dirty rows without adding an amber rail to the table row", () => {
    const baselineRows = rows.map((row) => row.name === "custom-doc" ? { ...row, opensAs: "receipt" } : row);

    renderTable({ baselineRows });

    const dirtyRow = screen.getByRole("row", { name: /Custom Doc/ });
    expect(dirtyRow).not.toHaveClass("bg-amber-500/10");
    expect(dirtyRow).toHaveClass("[&>td]:bg-amber-500/10");
  });
});
