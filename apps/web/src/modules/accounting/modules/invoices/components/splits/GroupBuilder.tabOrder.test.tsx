import { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SplitReviewContent } from "./SplitReviewContent";
import { useSplitReviewEditor } from "./useSplitReviewEditor";
import { expectDomOrder, expectNoPositiveTabIndex } from "../tabOrderAssertions";

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasAnyPermission: () => true, hasAllPermissions: () => true }),
}));

function ProductionSplitHarness() {
  const editor = useSplitReviewEditor(2, [{ value: "invoice", label: "Invoice" }, { value: "coi", label: "COI" }]);
  const { startWithSingleDocument } = editor;
  useEffect(() => startWithSingleDocument(), [startWithSingleDocument]);

  return (
    <SplitReviewContent
      docId="split-tab-order"
      fileName="batch.pdf"
      pageCount={2}
      editor={editor}
      docTypeOptions={[{ value: "invoice", label: "Invoice" }, { value: "coi", label: "COI" }]}
      analyzePending={false}
      analyzeError={null}
      isMutating={false}
      confirmPending={false}
      confirmError={null}
      onAnalyzeRetry={vi.fn()}
      onBuildManually={vi.fn()}
      onTreatAsSingleDocument={vi.fn()}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />
  );
}

describe("SplitReviewContent tab order", () => {
  it("keeps viewer, page strip, group fields, and footer controls in production DOM order", async () => {
    const { container } = render(<ProductionSplitHarness />);
    await screen.findByRole("button", { name: "Next page" });
    const order = [
      screen.getByRole("button", { name: "Next page" }),
      screen.getByRole("button", { name: "Zoom out" }),
      screen.getByRole("button", { name: "Zoom in" }),
      screen.getByRole("button", { name: "Fit page" }),
      screen.getByRole("button", { name: /^Page 1p1/ }),
      screen.getAllByRole("button", { name: "Select" })[0],
      screen.getByRole("button", { name: "Discard page 1" }),
      screen.getByRole("button", { name: "Split before page 2" }),
      screen.getByRole("button", { name: /^Page 2p2/ }),
      screen.getAllByRole("button", { name: "Select" })[1],
      screen.getByRole("button", { name: "Discard page 2" }),
      screen.getByRole("button", { name: /^Doc 1/ }),
      screen.getByRole("textbox"),
      screen.getByRole("combobox"),
      screen.getByRole("button", { name: "Treat as single doc" }),
      screen.getByRole("button", { name: "Cancel" }),
      screen.getByRole("separator", { name: "Resize split review panels" }),
    ];
    expectDomOrder(order);
    expectNoPositiveTabIndex(container);
    expect(screen.getByRole("button", { name: /Confirm Split/ })).toBeDisabled();
    expect(screen.queryByRole("textbox", { name: /Amount|Job|Description/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Row/ })).not.toBeInTheDocument();
  });
});
