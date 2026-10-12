import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SourceDocumentViewer,
  type SourceDocumentRecord,
} from "@/modules/accounting/modules/invoices/components/documents/SourceDocumentViewer";

function makeRecord(overrides: Partial<SourceDocumentRecord> = {}): SourceDocumentRecord {
  return {
    id: "inv-1",
    classification: "invoice",
    file: "INV-100.pdf",
    splitSuggestion: null,
    ...overrides,
  };
}

function renderViewer(record: SourceDocumentRecord) {
  return render(
    <SourceDocumentViewer
      record={record}
      imageAlt="Invoice attachment"
      viewerTitle="Invoice document"
    />,
  );
}

describe("SourceDocumentViewer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders no-attachment state without probing the file endpoint", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderViewer(makeRecord({ classification: "no-attachment", file: null }));

    expect(screen.getByText("No attachment - email only")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders the email-only placeholder for a pipeline email-body record with an empty file name", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderViewer(makeRecord({ id: "doc-1790200957496-body", classification: "no-attachment", file: "" }));

    expect(screen.getByText("No attachment - email only")).toBeInTheDocument();
    expect(screen.queryByTitle("Invoice document")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download file" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("probes PDF availability and renders the embedded viewer without duplicate file chrome", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      status: 200,
      headers: { "content-type": "application/pdf" },
    })));

    renderViewer(makeRecord({ splitSuggestion: { pageCount: 3 } }));

    const frame = await screen.findByTitle("Invoice document");
    expect(frame).toHaveAttribute("src", "/api/backend/invoices/inv-1/file#page=1&view=FitH");
    expect(frame.parentElement?.className).toContain("w-full");
    expect(frame.parentElement?.className).not.toContain("min-w-[max(100%,1600px)]");
    expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zoom in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open full document" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download file" })).not.toBeInTheDocument();
  });

  it("offers download-only fallback for unsupported renderable types", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      status: 200,
      headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    })));

    renderViewer(makeRecord({ file: "contract.docx" }));

    await waitFor(() => expect(screen.getByText("No preview available")).toBeInTheDocument());
    const downloadLinks = screen.getAllByRole("link", { name: "Download file" });
    expect(downloadLinks).toHaveLength(1);
    expect(downloadLinks[0]).toHaveAttribute("href", "/api/backend/invoices/inv-1/file");
  });

  it("resets preview state when switching records", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      status: 200,
      headers: { "content-type": "image/png" },
    })));

    const { rerender } = renderViewer(makeRecord({ file: "bad.png" }));

    fireEvent.error(await screen.findByAltText("Invoice attachment"));
    expect(await screen.findByText("Image preview not available")).toBeInTheDocument();

    rerender(
      <SourceDocumentViewer
        record={makeRecord({ id: "inv-2", file: "next.png" })}
        imageAlt="Invoice attachment"
        viewerTitle="Invoice document"
      />,
    );

    await waitFor(() => expect(screen.queryByText("Image preview not available")).not.toBeInTheDocument());
    expect(await screen.findByAltText("Invoice attachment")).toBeInTheDocument();
  });

  it("resets the viewer viewport when switching records", async () => {
    const scrollToMock = vi.fn();
    const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollToMock,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      status: 200,
      headers: { "content-type": "application/pdf" },
    })));

    try {
      const { rerender } = renderViewer(makeRecord());

      expect(await screen.findByTitle("Invoice document")).toHaveAttribute(
        "src",
        "/api/backend/invoices/inv-1/file#page=1&view=FitH",
      );

      rerender(
        <SourceDocumentViewer
          record={makeRecord({ id: "inv-2", file: "INV-200.pdf" })}
          imageAlt="Invoice attachment"
          viewerTitle="Invoice document"
        />,
      );

      await waitFor(() => expect(screen.getByTitle("Invoice document")).toHaveAttribute(
        "src",
        "/api/backend/invoices/inv-2/file#page=1&view=FitH",
      ));
      expect(scrollToMock).toHaveBeenCalledWith({ left: 0, top: 0 });
    } finally {
      if (originalScrollTo) {
        Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
      }
    }
  });

  it("anchors toasts to the bottom-left corner of the document viewer", () => {
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 42,
      y: 90,
      width: 600,
      height: 410,
      top: 90,
      right: 642,
      bottom: 500,
      left: 42,
      toJSON: () => ({}),
    } as DOMRect);

    try {
      const { unmount } = renderViewer(makeRecord({ classification: "no-attachment", file: null }));

      expect(window.__toolboxDocumentToastAnchor).toEqual({
        left: 58,
        bottom: 316,
      });

      unmount();
      expect(window.__toolboxDocumentToastAnchor).toBeNull();
    } finally {
      rectSpy.mockRestore();
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      });
    }
  });
});
