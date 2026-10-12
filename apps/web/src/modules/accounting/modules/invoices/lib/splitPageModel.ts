export function orderedSplitPages(pageCount: number): number[] {
  return Array.from({ length: Math.max(pageCount, 0) }, (_, index) => index + 1);
}

export function normalizeSplitPages(pages: number[], pageCount: number): number[] {
  const pageSet = new Set(
    pages.filter((page) => Number.isInteger(page) && page >= 1 && page <= pageCount),
  );
  return Array.from(pageSet).sort((a, b) => a - b);
}

export function defaultSplitGroupName(index: number): string {
  return `Document ${index + 1}`;
}

export function splitPageRangeLabel(pages: number[]): string {
  const normalized = [...pages].sort((a, b) => a - b);
  if (normalized.length === 0) return "No pages";
  if (normalized.length === 1) return `p${normalized[0]}`;
  return `p${normalized[0]}-${normalized[normalized.length - 1]}`;
}
