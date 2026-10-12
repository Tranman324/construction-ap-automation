import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SourceDocumentPlaceholder } from "@/modules/accounting/modules/invoices/components/documents/SourceDocumentPlaceholder";

describe("SourceDocumentPlaceholder", () => {
  it("renders document fallback messaging and optional actions", () => {
    render(
      <SourceDocumentPlaceholder
        icon="download"
        title="No preview available"
        detail="This file type cannot be displayed in the browser."
        fileName="contract.docx"
        action={<a href="/download">Download file</a>}
      />,
    );

    expect(screen.getByText("No preview available")).toBeInTheDocument();
    expect(screen.getByText("contract.docx")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download file" })).toHaveAttribute("href", "/download");
  });
});
