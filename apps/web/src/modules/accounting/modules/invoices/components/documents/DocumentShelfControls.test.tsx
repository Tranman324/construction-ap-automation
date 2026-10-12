import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DocumentShelfControls } from "@/modules/accounting/modules/invoices/components/documents/DocumentShelfControls";

describe("DocumentShelfControls", () => {
  it("keeps document status controls without duplicating shared classification filters", async () => {
    const user = userEvent.setup();
    const onParamChange = vi.fn();

    render(
      <DocumentShelfControls
        documentStatus="all"
        onParamChange={onParamChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reviewed" }));

    expect(onParamChange).toHaveBeenCalledWith("docStatus", "reviewed");
    expect(screen.queryByLabelText("Document panels")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
