import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSplitPagePreviewHref,
  clearSplitPagePreviewCache,
  getCachedSplitPagePreview,
  loadSplitPagePreview,
  prefetchSplitPagePreview,
} from "@/modules/accounting/modules/invoices/lib/splitPagePreviewCache";

function stubPreviewFetch() {
  const fetchMock = vi.fn(async () => new Response(new Blob(["preview"]), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:cached-preview"),
  });
  return fetchMock;
}

describe("splitPagePreviewCache", () => {
  beforeEach(() => {
    clearSplitPagePreviewCache();
    vi.restoreAllMocks();
  });

  it("builds the selected page preview endpoint", () => {
    expect(buildSplitPagePreviewHref("split-1", 3)).toBe("/api/backend/splits/split-1/page/3/preview?width=1400");
  });

  it("caches loaded previews by original URL", async () => {
    const fetchMock = stubPreviewFetch();
    const src = buildSplitPagePreviewHref("split-1", 1);

    await loadSplitPagePreview(src);
    await loadSplitPagePreview(src);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getCachedSplitPagePreview(src)).toMatchObject({
      originalSrc: src,
      previewSrc: "blob:cached-preview",
    });
  });

  it("prefetches without throwing to callers", async () => {
    const fetchMock = stubPreviewFetch();
    const src = buildSplitPagePreviewHref("split-1", 2);

    prefetchSplitPagePreview(src);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(src));
  });
});
