import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DocumentTypesAddForm } from "@/modules/accounting/modules/invoices/components/settings/DocumentTypesAddForm";
import type { ClassificationAssociation, ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";

const associations: ClassificationAssociation[] = [
  { key: "invoice", label: "Invoice Workflow", description: "Approval and Spectrum workflow." },
  { key: "other", label: "Generic Panel", description: "Fallback document review." },
];

const rows: ClassificationInfo[] = [
  { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
];

describe("DocumentTypesAddForm", () => {
  it("shows validation messages before submit", async () => {
    const user = userEvent.setup();
    render(<DocumentTypesAddForm associations={associations} existingRows={rows} pending={false} onCancel={vi.fn()} onSubmit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Create Type" }));

    expect(screen.getByText("Name is required.")).toBeInTheDocument();
    expect(screen.getByText("Label is required.")).toBeInTheDocument();
    expect(screen.getByText("Choose a destination.")).toBeInTheDocument();
  });

  it("submits a valid draft with an association selected", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<DocumentTypesAddForm associations={associations} existingRows={rows} pending={false} onCancel={vi.fn()} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Document type name"), "custom-doc");
    await user.type(screen.getByLabelText("Document type label"), "Custom Doc");
    await user.click(screen.getByRole("combobox", { name: "New type opens as" }));
    expect(screen.getByText("Fallback document review.")).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /Generic Panel/ }));
    await user.click(screen.getByRole("button", { name: "Create Type" }));

    expect(onSubmit).toHaveBeenCalledWith({ name: "custom-doc", label: "Custom Doc", opensAs: "other" });
  });
});
