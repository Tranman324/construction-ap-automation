import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocumentHeaderFileLink } from "@/modules/accounting/modules/invoices/components/documents/DocumentHeaderFileLink";

describe("DocumentHeaderFileLink", () => {
  it("shows the file name with a new-tab link for attached documents", () => {
    render(
      <DocumentHeaderFileLink
        record={{ id: "inv-1", classification: "invoice", file: "Ferrotek Pay App 2-RET.pdf" }}
      />,
    );

    expect(screen.getByText("Ferrotek Pay App 2-RET.pdf")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Ferrotek Pay App 2-RET.pdf in a new tab" }))
      .toHaveAttribute("href", "/api/backend/invoices/inv-1/file");
  });

  it("disables the new-tab action when no attachment exists", () => {
    render(
      <DocumentHeaderFileLink
        record={{ id: "doc-1", classification: "no-attachment", file: null }}
      />,
    );

    expect(screen.getByText("No file")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open file in a new tab" })).toBeDisabled();
  });
});
