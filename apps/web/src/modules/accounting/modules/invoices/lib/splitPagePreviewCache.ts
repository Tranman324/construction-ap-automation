export interface SplitPagePreviewEntry {
  originalSrc: string;
  previewSrc: string;
}

const splitPagePreviewCache = new Map<string, Promise<SplitPagePreviewEntry> | SplitPagePreviewEntry>();

export function buildSplitPagePreviewHref(docId: string, page: number, width = 1400): string {
  return `/api/backend/splits/${docId}/page/${page}/preview?width=${width}`;
}

function isLoadedEntry(
  entry: Promise<SplitPagePreviewEntry> | SplitPagePreviewEntry,
): entry is SplitPagePreviewEntry {
  return "previewSrc" in entry;
}

function createPreviewSrc(blob: Blob, fallbackSrc: string): string {
  return typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob) : fallbackSrc;
}

export async function loadSplitPagePreview(src: string): Promise<SplitPagePreviewEntry> {
  const cached = splitPagePreviewCache.get(src);
  if (cached) return cached;

  const pending = fetch(src)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Page preview failed with ${response.status}`);
      const blob = await response.blob();
      return {
        originalSrc: src,
        previewSrc: createPreviewSrc(blob, src),
      };
    })
    .then((entry) => {
      splitPagePreviewCache.set(src, entry);
      return entry;
    })
    .catch((error: unknown) => {
      splitPagePreviewCache.delete(src);
      throw error;
    });

  splitPagePreviewCache.set(src, pending);
  return pending;
}

export function prefetchSplitPagePreview(src: string): void {
  void loadSplitPagePreview(src).catch(() => {
    splitPagePreviewCache.delete(src);
  });
}

export function getCachedSplitPagePreview(src: string): SplitPagePreviewEntry | null {
  const cached = splitPagePreviewCache.get(src);
  return cached && isLoadedEntry(cached) ? cached : null;
}

export function clearSplitPagePreviewCache(): void {
  splitPagePreviewCache.clear();
}
