import { describe, expect, it } from "vitest";

import {
  createSingleDocumentState,
  createStateFromSuggestion,
  getSplitCutPages,
  getSplitCutSegments,
  setPageDiscarded,
  toggleCutPage,
} from "@/modules/accounting/modules/invoices/lib/splitCutModel";
import type { SplitSuggestion } from "@/modules/accounting/modules/invoices/types/api";

describe("splitCutModel", () => {
  it("seeds contiguous groups from the split suggestion", () => {
    const suggestion: SplitSuggestion = {
      pageCount: 4,
      generatedAt: "2026-06-26T12:00:00Z",
      pages: [],
      suggestedGroups: [
        { pages: [1, 2], invoiceNumber: "INV-1", docType: "invoice" },
        { pages: [3, 4], invoiceNumber: "COI-1", docType: "coi" },
      ],
    };

    const state = createStateFromSuggestion(suggestion);

    expect(state.groups).toHaveLength(2);
    expect(state.groups[0]).toMatchObject({ pages: [1, 2], docType: "invoice", displayName: "INV-1" });
    expect(state.groups[1]).toMatchObject({ pages: [3, 4], docType: "coi", displayName: "COI-1" });
    expect(getSplitCutPages(state, 4)).toEqual([3]);
  });

  it("preserves custom active classification values from split suggestions", () => {
    const suggestion: SplitSuggestion = {
      pageCount: 2,
      generatedAt: "2026-06-26T12:00:00Z",
      pages: [],
      suggestedGroups: [
        { pages: [1], invoiceNumber: "PERMIT-1", docType: "building-permit" },
        { pages: [2], invoiceNumber: "SUB-1", docType: "subcontract" },
      ],
    };

    const state = createStateFromSuggestion(suggestion);

    expect(state.groups.map((group) => group.docType)).toEqual(["building-permit", "subcontract"]);
  });

  it("toggles scissors cuts into deterministic page groups", () => {
    const initialState = createSingleDocumentState(5);

    const splitOnce = toggleCutPage(initialState, 5, 3);
    expect(splitOnce.groups.map((group) => group.pages)).toEqual([[1, 2], [3, 4, 5]]);
    expect(getSplitCutPages(splitOnce, 5)).toEqual([3]);

    const splitTwice = toggleCutPage(splitOnce, 5, 5);
    expect(splitTwice.groups.map((group) => group.pages)).toEqual([[1, 2], [3, 4], [5]]);
    expect(getSplitCutSegments(splitTwice, 5).map((segment) => segment.firstPage)).toEqual([1, 3, 5]);

    const merged = toggleCutPage(splitTwice, 5, 3);
    expect(merged.groups.map((group) => group.pages)).toEqual([[1, 2, 3, 4], [5]]);
  });

  it("rebuilds around discarded and restored pages", () => {
    const splitState = toggleCutPage(createSingleDocumentState(4), 4, 3);

    const discarded = setPageDiscarded(splitState, 4, 2, true);
    expect(discarded.discardedPages).toEqual([2]);
    expect(discarded.groups.map((group) => group.pages)).toEqual([[1], [3, 4]]);

    const restored = setPageDiscarded(discarded, 4, 2, false);
    expect(restored.discardedPages).toEqual([]);
    expect(restored.groups.map((group) => group.pages)).toEqual([[1, 2, 3, 4]]);
  });
});
