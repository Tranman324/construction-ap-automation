import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SourceDocumentToolbar } from "@/modules/accounting/modules/invoices/components/documents/SourceDocumentToolbar";

describe("SourceDocumentToolbar", () => {
  it("shows document controls with safe disabled states", async () => {
    const user = userEvent.setup();
    const onNextPage = vi.fn();
    const onZoomIn = vi.fn();

    render(
      <SourceDocumentToolbar
        fileName="INV-100.pdf"
        fileHref="/api/backend/invoices/inv-1/file"
        downloadName="INV-100.pdf"
        canOpen={false}
        canDownload={false}
        page={1}
        pageCount={3}
        zoom={0.5}
        fitMode
        onPreviousPage={vi.fn()}
        onNextPage={onNextPage}
        onZoomOut={vi.fn()}
        onZoomIn={onZoomIn}
        onFitPage={vi.fn()}
      />,
    );

    expect(screen.getByText("INV-100.pdf")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("/ 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fit page" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Open full document" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download file" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download file" })).toHaveAttribute("title", expect.stringContaining("Download PDF •"));

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));

    expect(onNextPage).toHaveBeenCalledTimes(1);
    expect(onZoomIn).toHaveBeenCalledTimes(1);
  });

  it("shows the download shortcut on an enabled download link", () => {
    render(
      <SourceDocumentToolbar
        fileName="INV-100.pdf" fileHref="/file" downloadName="INV-100.pdf" canOpen canDownload
        page={1} pageCount={1} zoom={1} fitMode onPreviousPage={vi.fn()} onNextPage={vi.fn()}
        onZoomOut={vi.fn()} onZoomIn={vi.fn()} onFitPage={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: "Download file" })).toHaveAttribute("title", expect.stringContaining("Download PDF •"));
  });
});
