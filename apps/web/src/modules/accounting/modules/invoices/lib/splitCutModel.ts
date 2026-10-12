import type { SplitSuggestion } from "@/modules/accounting/modules/invoices/types/api";
import { generateGroupId, type EditorGroup, type SplitEditorState } from "@/modules/accounting/modules/invoices/lib/splitLayout";
import { defaultSplitGroupName, normalizeSplitPages, orderedSplitPages } from "@/modules/accounting/modules/invoices/lib/splitPageModel";

export interface SplitCutSegment {
  group: EditorGroup;
  groupIndex: number;
  firstPage: number;
  lastPage: number;
  pages: number[];
}

function pageOverlapCount(group: EditorGroup, pages: number[]): number {
  const groupPages = new Set(group.pages);
  return pages.filter((page) => groupPages.has(page)).length;
}

function findBestExistingGroup(
  groups: EditorGroup[],
  pages: number[],
  usedGroupIds: Set<string>,
): EditorGroup | null {
  const firstPage = pages[0];
  const unusedGroups = groups.filter((group) => !usedGroupIds.has(group.id));
  const containingFirstPage = unusedGroups.find((group) => group.pages.includes(firstPage));
  if (containingFirstPage) return containingFirstPage;

  let bestGroup: EditorGroup | null = null;
  let bestOverlap = 0;
  for (const group of unusedGroups) {
    const overlap = pageOverlapCount(group, pages);
    if (overlap > bestOverlap) {
      bestGroup = group;
      bestOverlap = overlap;
    }
  }

  return bestGroup;
}

export function createSingleDocumentState(pageCount: number): SplitEditorState {
  const pages = orderedSplitPages(pageCount);
  return {
    groups: pages.length > 0 ? [{
      id: generateGroupId(),
      pages,
      docType: "invoice",
      displayName: defaultSplitGroupName(0),
    }] : [],
    discardedPages: [],
    selectedPages: new Set(),
  };
}

export function createStateFromSuggestion(suggestion: SplitSuggestion): SplitEditorState {
  const pageCount = Math.max(suggestion.pageCount, 0);
  const groups = suggestion.suggestedGroups
    .map((suggestedGroup, index): EditorGroup | null => {
      const pages = normalizeSplitPages(suggestedGroup.pages, pageCount);
      if (pages.length === 0) return null;
      const docType = suggestedGroup.docType.trim();
      return {
        id: generateGroupId(),
        pages,
        docType: docType.length > 0 ? docType : "invoice",
        displayName: suggestedGroup.invoiceNumber ?? defaultSplitGroupName(index),
      };
    })
    .filter((group): group is EditorGroup => group !== null);

  if (groups.length === 0) return createSingleDocumentState(pageCount);

  return {
    groups,
    discardedPages: [],
    selectedPages: new Set(),
  };
}

export function getActivePages(state: SplitEditorState, pageCount: number): number[] {
  const discarded = new Set(state.discardedPages);
  return orderedSplitPages(pageCount).filter((page) => !discarded.has(page));
}

export function getSplitCutPages(state: SplitEditorState, pageCount: number): number[] {
  const activePages = getActivePages(state, pageCount);
  const cutPages: number[] = [];

  for (let index = 1; index < activePages.length; index += 1) {
    const previousPage = activePages[index - 1];
    const page = activePages[index];
    if (page !== previousPage + 1) continue;

    const previousGroupIndex = state.groups.findIndex((group) => group.pages.includes(previousPage));
    const groupIndex = state.groups.findIndex((group) => group.pages.includes(page));
    if (previousGroupIndex !== groupIndex) cutPages.push(page);
  }

  return cutPages;
}

export function isCuttablePage(state: SplitEditorState, pageCount: number, page: number): boolean {
  if (page <= 1 || page > pageCount) return false;
  const discarded = new Set(state.discardedPages);
  return !discarded.has(page) && !discarded.has(page - 1);
}

export function rebuildStateFromCutPages(
  state: SplitEditorState,
  pageCount: number,
  cutPages: Iterable<number>,
): SplitEditorState {
  const cutSet = new Set(cutPages);
  const discarded = new Set(state.discardedPages);
  const segments: number[][] = [];

  for (const page of orderedSplitPages(pageCount)) {
    if (discarded.has(page)) continue;
    const startsSegment = segments.length === 0 || cutSet.has(page) || discarded.has(page - 1);
    if (startsSegment) {
      segments.push([page]);
    } else {
      segments[segments.length - 1].push(page);
    }
  }

  const usedGroupIds = new Set<string>();
  const groups = segments.map((pages, index): EditorGroup => {
    const existingGroup = findBestExistingGroup(state.groups, pages, usedGroupIds);
    if (existingGroup) usedGroupIds.add(existingGroup.id);

    return {
      id: existingGroup?.id ?? generateGroupId(),
      pages,
      docType: existingGroup?.docType ?? "invoice",
      displayName: existingGroup?.displayName.trim() || defaultSplitGroupName(index),
    };
  });

  const activePageSet = new Set(segments.flat());
  const selectedPages = new Set(Array.from(state.selectedPages).filter((page) => activePageSet.has(page)));

  return {
    groups,
    discardedPages: Array.from(discarded).sort((a, b) => a - b),
    selectedPages,
  };
}

export function toggleCutPage(
  state: SplitEditorState,
  pageCount: number,
  page: number,
): SplitEditorState {
  if (!isCuttablePage(state, pageCount, page)) return state;

  const cutPages = new Set(getSplitCutPages(state, pageCount));
  if (cutPages.has(page)) cutPages.delete(page);
  else cutPages.add(page);

  return rebuildStateFromCutPages(state, pageCount, cutPages);
}

export function setPageDiscarded(
  state: SplitEditorState,
  pageCount: number,
  page: number,
  discarded: boolean,
): SplitEditorState {
  const discardedPages = discarded
    ? Array.from(new Set([...state.discardedPages, page]))
    : state.discardedPages.filter((discardedPage) => discardedPage !== page);
  const cutPages = getSplitCutPages(state, pageCount).filter((cutPage) => cutPage !== page);
  return rebuildStateFromCutPages({ ...state, discardedPages }, pageCount, cutPages);
}

export function getSplitCutSegments(
  state: SplitEditorState,
  pageCount: number,
): SplitCutSegment[] {
  return state.groups
    .map((group, groupIndex): SplitCutSegment | null => {
      const pages = normalizeSplitPages(group.pages, pageCount);
      if (pages.length === 0) return null;
      return {
        group,
        groupIndex,
        firstPage: pages[0],
        lastPage: pages[pages.length - 1],
        pages,
      };
    })
    .filter((segment): segment is SplitCutSegment => segment !== null)
    .sort((a, b) => a.firstPage - b.firstPage);
}
