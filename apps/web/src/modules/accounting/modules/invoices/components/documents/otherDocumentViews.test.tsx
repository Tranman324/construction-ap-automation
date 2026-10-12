import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OtherClassificationField, OtherNoteField } from "@/modules/accounting/modules/invoices/components/documents/otherDocumentViews";
import type { ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";

const reclassifyOptions: ClassificationInfo[] = [
  { name: "receipt", label: "Receipt", opensAs: "receipt", action: "view-only", builtIn: true, status: "active" },
  { name: "w9", label: "W-9", opensAs: "w9", action: "view-only", builtIn: true, status: "active" },
];

describe("Other document fields", () => {
  it("renders the optional classification field and reports a selected target", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <OtherClassificationField classifications={reclassifyOptions} value="" onChange={onChange} />,
    );

    await user.selectOptions(screen.getByLabelText(/^Reclassify as/), "w9");
    expect(onChange).toHaveBeenCalledWith("w9");
    expect(screen.getByText("OPTIONAL")).toBeInTheDocument();
  });

  it("marks a changed note as edited and keeps the narrow layout full width", () => {
    const onChange = vi.fn();
    render(
      <OtherNoteField value="Needs routing" baseline="" onChange={onChange} />,
    );

    expect(screen.getByText("EDITED")).toBeInTheDocument();
    const note = screen.getByLabelText(/^Note/);
    expect(note).toHaveClass("w-full");
    fireEvent.change(note, { target: { value: "Updated context" } });
    expect(onChange).toHaveBeenCalledWith("Updated context");
  });
});
