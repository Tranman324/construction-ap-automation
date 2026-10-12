"use client";

import { useCallback, useMemo, useState } from "react";

import {
  createSingleDocumentState,
  createStateFromSuggestion,
  setPageDiscarded,
  toggleCutPage,
} from "@/modules/accounting/modules/invoices/lib/splitCutModel";
import {
  findPageGroup,
  generateGroupId,
  getUnassignedPages,
  getSplitDocTypeLabel,
  FALLBACK_SPLIT_DOC_TYPE_OPTIONS,
  validateLayout,
  type EditorGroup,
  type SplitDocTypeOption,
  type SplitEditorState,
} from "@/modules/accounting/modules/invoices/lib/splitLayout";
import type { SplitSuggestion } from "@/modules/accounting/modules/invoices/types/api";
import type { SplitSelectedPageGroup } from "@/modules/accounting/modules/invoices/components/splits/SplitSelectedPageViewer";

function nextPageAfterDiscard(state: SplitEditorState, pageCount: number, discardedPage: number): number {
  const discarded = new Set(state.discardedPages);
  for (let page = discardedPage + 1; page <= pageCount; page += 1) {
    if (!discarded.has(page)) return page;
  }
  for (let page = discardedPage - 1; page >= 1; page -= 1) {
    if (!discarded.has(page)) return page;
  }
  return 1;
}

function getValidation(state: SplitEditorState | null, pageCount: number) {
  if (!state || pageCount === 0) return { valid: false, errors: ["Loading pages"] };
  if (pageCount <= 1) return { valid: false, errors: ["Single-page documents cannot be split"] };
  const layoutValidation = validateLayout(state, pageCount);
  if (layoutValidation.valid && state.groups.length < 2) {
    return { valid: false, errors: ["Add at least one cut or cancel as a single document"] };
  }
  return layoutValidation;
}

export function useSplitReviewEditor(
  pageCount: number,
  docTypeOptions: readonly SplitDocTypeOption[] = FALLBACK_SPLIT_DOC_TYPE_OPTIONS,
) {
  const [state, setState] = useState<SplitEditorState | null>(null);
  const [selectedPage, setSelectedPage] = useState(1);
  const [hoveredGroupIndex, setHoveredGroupIndex] = useState<number | null>(null);
  const [lastClickedPage, setLastClickedPage] = useState<number | null>(null);

  const validation = useMemo(() => getValidation(state, pageCount), [pageCount, state]);
  const unassignedCount = useMemo(() => {
    if (!state || !pageCount) return 0;
    return getUnassignedPages(state, pageCount).length;
  }, [pageCount, state]);
  const selectedViewerGroup = useMemo<SplitSelectedPageGroup | null>(() => {
    if (!state) return null;
    const groupIndex = findPageGroup(state.groups, selectedPage);
    if (groupIndex < 0) return null;
    const group = state.groups[groupIndex];
    return {
      index: groupIndex,
      label: group.displayName || `Document ${groupIndex + 1}`,
      docTypeLabel: getSplitDocTypeLabel(group.docType, docTypeOptions),
    };
  }, [docTypeOptions, selectedPage, state]);

  const seedFromSuggestion = useCallback((suggestion: SplitSuggestion) => {
    setState(createStateFromSuggestion(suggestion));
    setSelectedPage(1);
  }, []);

  const startWithSingleDocument = useCallback(() => {
    setState(createSingleDocumentState(pageCount));
    setSelectedPage(1);
  }, [pageCount]);

  const handleTogglePage = useCallback((page: number, shiftKey: boolean) => {
    if (!state) return;
    const nextSelected = new Set(state.selectedPages);
    if (shiftKey && lastClickedPage !== null) {
      const from = Math.min(lastClickedPage, page);
      const to = Math.max(lastClickedPage, page);
      for (let currentPage = from; currentPage <= to; currentPage += 1) nextSelected.add(currentPage);
    } else if (nextSelected.has(page)) {
      nextSelected.delete(page);
    } else {
      nextSelected.add(page);
    }
    setLastClickedPage(page);
    setState({ ...state, selectedPages: nextSelected });
  }, [lastClickedPage, state]);

  const handleCreateGroup = useCallback(() => {
    if (!state || state.selectedPages.size === 0) return;
    const selectedPages = Array.from(state.selectedPages).sort((a, b) => a - b);
    const selectedSet = new Set(selectedPages);
    const groups = state.groups
      .map((group) => ({ ...group, pages: group.pages.filter((page) => !selectedSet.has(page)) }))
      .filter((group) => group.pages.length > 0);
    setState({
      groups: [...groups, {
        id: generateGroupId(),
        pages: selectedPages,
        docType: "invoice",
        displayName: `Document ${groups.length + 1}`,
      }],
      discardedPages: state.discardedPages.filter((page) => !selectedSet.has(page)),
      selectedPages: new Set(),
    });
  }, [state]);

  const handleUpdateGroupName = useCallback((groupId: string, name: string) => {
    if (!state) return;
    setState({
      ...state,
      groups: state.groups.map((group) => group.id === groupId ? { ...group, displayName: name } : group),
    });
  }, [state]);

  const handleUpdateGroupDocType = useCallback((groupId: string, docType: EditorGroup["docType"]) => {
    if (!state) return;
    setState({
      ...state,
      groups: state.groups.map((group) => group.id === groupId ? { ...group, docType } : group),
    });
  }, [state]);

  const handleToggleCut = useCallback((page: number) => {
    if (state) setState(toggleCutPage(state, pageCount, page));
  }, [pageCount, state]);

  const handleDiscardPage = useCallback((page: number) => {
    if (!state) return;
    const nextState = setPageDiscarded(state, pageCount, page, true);
    setState(nextState);
    if (selectedPage === page) setSelectedPage(nextPageAfterDiscard(nextState, pageCount, page));
  }, [pageCount, selectedPage, state]);

  const handleUndiscardPage = useCallback((page: number) => {
    if (!state) return;
    setState(setPageDiscarded(state, pageCount, page, false));
    setSelectedPage(page);
  }, [pageCount, state]);

  const handleDiscardSelected = useCallback(() => {
    if (!state) return;
    let nextState = state;
    for (const page of state.selectedPages) nextState = setPageDiscarded(nextState, pageCount, page, true);
    setState({ ...nextState, selectedPages: new Set() });
  }, [pageCount, state]);

  const handleSelectGroup = useCallback((groupId: string) => {
    const group = state?.groups.find((item) => item.id === groupId);
    if (group?.pages[0]) setSelectedPage([...group.pages].sort((a, b) => a - b)[0]);
  }, [state?.groups]);

  const handleClearSelection = useCallback(() => {
    if (state) setState({ ...state, selectedPages: new Set() });
  }, [state]);

  const handleSelectAllUnassigned = useCallback(() => {
    if (state) setState({ ...state, selectedPages: new Set(getUnassignedPages(state, pageCount)) });
  }, [pageCount, state]);

  return {
    state,
    selectedPage,
    hoveredGroupIndex,
    validation,
    unassignedCount,
    selectedViewerGroup,
    setSelectedPage,
    setHoveredGroupIndex,
    seedFromSuggestion,
    startWithSingleDocument,
    handleTogglePage,
    handleCreateGroup,
    handleUpdateGroupName,
    handleUpdateGroupDocType,
    handleToggleCut,
    handleDiscardPage,
    handleUndiscardPage,
    handleDiscardSelected,
    handleSelectGroup,
    handleClearSelection,
    handleSelectAllUnassigned,
  };
}
