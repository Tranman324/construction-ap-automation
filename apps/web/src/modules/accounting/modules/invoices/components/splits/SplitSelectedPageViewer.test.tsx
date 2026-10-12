import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SplitSelectedPageViewer } from "@/modules/accounting/modules/invoices/components/splits/SplitSelectedPageViewer";
import { clearSplitPagePreviewCache } from "@/modules/accounting/modules/invoices/lib/splitPagePreviewCache";

function mockPreviewFetch(status = 200) {
  const fetchMock = vi.fn(async (url: string) => {
    const href = String(url);
    if (href.length === 0) throw new Error("missing preview URL");
    return new Response(new Blob(["preview"]), { status });
  });
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => `blob:preview-${fetchMock.mock.calls.length}`),
  });
  return fetchMock;
}

function renderViewer(selectedPage: number, onSelectedPageChange = vi.fn()) {
  return render(
    <SplitSelectedPageViewer
      docId="split-1"
      fileName="batch.pdf"
      pageCount={4}
      selectedPage={selectedPage}
      group={{ index: 0, label: "Document 1", docTypeLabel: "Invoice" }}
      onSelectedPageChange={onSelectedPageChange}
    />,
  );
}

function countFetchesForPage(fetchMock: ReturnType<typeof mockPreviewFetch>, page: number) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes(`/page/${page}/preview`)).length;
}

describe("SplitSelectedPageViewer", () => {
  beforeEach(() => {
    clearSplitPagePreviewCache();
    vi.restoreAllMocks();
  });

  it("syncs toolbar page navigation to the selected page callback", async () => {
    const user = userEvent.setup();
    mockPreviewFetch();
    const onSelectedPageChange = vi.fn();

    renderViewer(2, onSelectedPageChange);

    expect(await screen.findByAltText("Selected page 2")).toBeInTheDocument();
    expect(screen.getByText("Document 1")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open full document" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download file" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next page" }));

    expect(onSelectedPageChange).toHaveBeenCalledWith(3);
  });

  it("keeps zoom controls active beside the document indicator", async () => {
    const user = userEvent.setup();
    mockPreviewFetch();

    renderViewer(1);

    expect(await screen.findByAltText("Selected page 1")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Zoom in" }));

    expect(screen.getByText("110%")).toBeInTheDocument();
  });

  it("prefetches adjacent selected-page previews after the current preview renders", async () => {
    const fetchMock = mockPreviewFetch();

    renderViewer(2);

    const image = await screen.findByAltText("Selected page 2");
    expect(countFetchesForPage(fetchMock, 2)).toBe(1);

    fireEvent.load(image);

    await waitFor(() => {
      expect(countFetchesForPage(fetchMock, 1)).toBe(1);
      expect(countFetchesForPage(fetchMock, 3)).toBe(1);
    });
  });

  it("uses cached selected-page previews on revisit instead of refetching", async () => {
    const fetchMock = mockPreviewFetch();
    const { rerender } = render(
      <SplitSelectedPageViewer
        docId="split-1"
        fileName="batch.pdf"
        pageCount={4}
        selectedPage={1}
        group={{ index: 0, label: "Document 1", docTypeLabel: "Invoice" }}
        onSelectedPageChange={vi.fn()}
      />,
    );

    const firstImage = await screen.findByAltText("Selected page 1");
    fireEvent.load(firstImage);
    await waitFor(() => expect(countFetchesForPage(fetchMock, 2)).toBe(1));

    rerender(
      <SplitSelectedPageViewer
        docId="split-1"
        fileName="batch.pdf"
        pageCount={4}
        selectedPage={2}
        group={{ index: 0, label: "Document 1", docTypeLabel: "Invoice" }}
        onSelectedPageChange={vi.fn()}
      />,
    );
    expect(await screen.findByAltText("Selected page 2")).toBeInTheDocument();

    rerender(
      <SplitSelectedPageViewer
        docId="split-1"
        fileName="batch.pdf"
        pageCount={4}
        selectedPage={1}
        group={{ index: 0, label: "Document 1", docTypeLabel: "Invoice" }}
        onSelectedPageChange={vi.fn()}
      />,
    );
    expect(await screen.findByAltText("Selected page 1")).toBeInTheDocument();

    expect(countFetchesForPage(fetchMock, 1)).toBe(1);
    expect(countFetchesForPage(fetchMock, 2)).toBe(1);
  });

  it("keeps the failed-page placeholder when the selected preview cannot be fetched", async () => {
    mockPreviewFetch(500);

    renderViewer(3);

    expect(await screen.findByText("Page preview not available")).toBeInTheDocument();
    expect(screen.getByText("The preview for page 3 could not be rendered.")).toBeInTheDocument();
  });
});
