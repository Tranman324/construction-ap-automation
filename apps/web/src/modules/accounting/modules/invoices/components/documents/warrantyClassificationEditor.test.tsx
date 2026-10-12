import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WarrantyClassificationEditor } from "@/modules/accounting/modules/invoices/components/documents/warrantyClassificationEditor";

const computed = { value: "Vendor", provenance: "computed" as const, permittedActions: [], blockers: [] };

describe("WarrantyClassificationEditor", () => {
  it("leaves populated system values unmarked, then marks and submits a manual correction", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <WarrantyClassificationEditor
        providerKind={computed}
        warrantyType={{ ...computed, value: "Warranty certificate" }}
        canEdit
        pending={false}
        error={null}
        onSave={onSave}
      />,
    );

    expect(screen.getByDisplayValue("Vendor")).toBeInTheDocument();
    expect(screen.queryByTestId("invoice-field-marker")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Provider kind"));
    await user.type(screen.getByLabelText("Provider kind"), "Subcontractor");
    expect(screen.getByText("EDITED")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save classification" }));
    expect(onSave).toHaveBeenCalledWith({ providerKind: "Subcontractor" });
  });

  it("submits only the dirty warranty type", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <WarrantyClassificationEditor
        providerKind={computed}
        warrantyType={{ ...computed, value: "Warranty certificate" }}
        canEdit
        pending={false}
        error={null}
        onSave={onSave}
      />,
    );

    await user.clear(screen.getByLabelText("Warranty type"));
    await user.type(screen.getByLabelText("Warranty type"), "Extended warranty");
    await user.click(screen.getByRole("button", { name: "Save classification" }));
    expect(onSave).toHaveBeenCalledWith({ warrantyType: "Extended warranty" });
  });

  it("does not offer a save when neither field is dirty", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <WarrantyClassificationEditor
        providerKind={computed}
        warrantyType={{ ...computed, value: "Warranty certificate" }}
        canEdit
        pending={false}
        error={null}
        onSave={onSave}
      />,
    );

    expect(screen.queryByRole("button", { name: "Save classification" })).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("treats whitespace-only provider and warranty edits as clean", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <WarrantyClassificationEditor
        providerKind={computed}
        warrantyType={{ ...computed, value: "Warranty certificate" }}
        canEdit
        pending={false}
        error={null}
        onSave={onSave}
      />,
    );

    await user.clear(screen.getByLabelText("Provider kind"));
    await user.type(screen.getByLabelText("Provider kind"), "  Vendor  ");
    expect(screen.queryByRole("button", { name: "Save classification" })).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Warranty type"));
    await user.type(screen.getByLabelText("Warranty type"), "  Warranty certificate  ");
    expect(screen.queryByRole("button", { name: "Save classification" })).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows required markers for missing editable values and stacks responsively", () => {
    render(
      <WarrantyClassificationEditor
        providerKind={null}
        warrantyType={null}
        canEdit
        pending={false}
        error={null}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getAllByText("REQUIRED")).toHaveLength(2);
    expect(screen.getByLabelText("Provider kind")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Warranty type")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Provider kind").closest(".grid")).toHaveClass("sm:grid-cols-2");
  });

  it("keeps controls disabled without approval permission and shows the verbatim error", () => {
    render(
      <WarrantyClassificationEditor
        providerKind={computed}
        warrantyType={null}
        canEdit={false}
        pending={false}
        error="The canonical blocker message"
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Provider kind")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save classification" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The canonical blocker message");
  });

  it("clears a manual slot through the canonical mutation", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <WarrantyClassificationEditor
        providerKind={{ ...computed, provenance: "manual", value: "Subcontractor" }}
        warrantyType={{ ...computed, provenance: "manual", value: "Extended warranty" }}
        canEdit
        pending={false}
        error={null}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Clear manual provider kind" }));
    expect(onSave).toHaveBeenCalledWith({ providerKind: null });

    await user.click(screen.getByRole("button", { name: "Clear manual warranty type" }));
    expect(onSave).toHaveBeenLastCalledWith({ warrantyType: null });
  });

  it("preserves both manual values when a clear mutation is refused", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error("refused"));
    render(
      <WarrantyClassificationEditor
        providerKind={{ ...computed, provenance: "manual", value: "Subcontractor" }}
        warrantyType={{ ...computed, provenance: "manual", value: "Extended warranty" }}
        canEdit
        pending={false}
        error="The canonical refusal"
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Clear manual provider kind" }));
    expect(screen.getByLabelText("Provider kind")).toHaveValue("Subcontractor");
    expect(screen.getByLabelText("Warranty type")).toHaveValue("Extended warranty");
    await user.click(screen.getByRole("button", { name: "Clear manual warranty type" }));
    expect(screen.getByLabelText("Provider kind")).toHaveValue("Subcontractor");
    expect(screen.getByLabelText("Warranty type")).toHaveValue("Extended warranty");
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toHaveTextContent("The canonical refusal");
  });
});
