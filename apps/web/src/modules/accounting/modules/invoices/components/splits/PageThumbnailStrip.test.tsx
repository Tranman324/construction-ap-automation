import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PageThumbnailStrip } from "@/modules/accounting/modules/invoices/components/splits/PageThumbnailStrip";
import { createSingleDocumentState } from "@/modules/accounting/modules/invoices/lib/splitCutModel";

describe("PageThumbnailStrip", () => {
  it("renders a horizontal page strip and triggers scissors cuts", async () => {
    const user = userEvent.setup();
    const onToggleCut = vi.fn();
    const state = createSingleDocumentState(3);

    render(
      <PageThumbnailStrip
        docId="split-1"
        pageCount={3}
        state={state}
        selectedPage={1}
        highlightedGroupIndex={null}
        onSelectPage={vi.fn()}
        onTogglePage={vi.fn()}
        onToggleCut={onToggleCut}
        onDiscardPage={vi.fn()}
        onUndiscardPage={vi.fn()}
      />,
    );

    expect(screen.getByRole("list", { name: "Split pages" })).toBeInTheDocument();
    expect(screen.getByAltText("Page 1")).toBeInTheDocument();
    expect(screen.getByAltText("Page 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Split before page 2" }));

    expect(onToggleCut).toHaveBeenCalledWith(2);
  });
});
