import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SplitReviewContent } from "@/modules/accounting/modules/invoices/components/splits/SplitReviewContent";
import { useSplitReviewEditor } from "@/modules/accounting/modules/invoices/components/splits/useSplitReviewEditor";
import { clearSplitPagePreviewCache } from "@/modules/accounting/modules/invoices/lib/splitPagePreviewCache";

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));

interface HarnessProps {
  onBuildManually: () => void;
  analyzePending?: boolean;
}

const docTypeOptions = [
  { value: "invoice", label: "Invoice" },
  { value: "coi", label: "COI" },
];

function Harness({ onBuildManually, analyzePending = false }: HarnessProps) {
  const editor = useSplitReviewEditor(2);

  return (
    <SplitReviewContent
      docId="split-1"
      fileName="batch.pdf"
      pageCount={2}
      editor={editor}
      docTypeOptions={docTypeOptions}
      analyzePending={analyzePending}
      analyzeError={analyzePending ? null : "Timed out"}
      isMutating={false}
      confirmPending={false}
      confirmError={null}
      onAnalyzeRetry={vi.fn()}
      onBuildManually={onBuildManually}
      onTreatAsSingleDocument={vi.fn()}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />
  );
}

describe("SplitReviewContent", () => {
  beforeEach(() => {
    clearSplitPagePreviewCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["preview"]), { status: 200 })));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:preview"),
    });
  });

  it("keeps manual build available while split analysis is unrecovered", async () => {
    const user = userEvent.setup();
    const onBuildManually = vi.fn();

    render(<Harness onBuildManually={onBuildManually} />);

    expect(screen.getByText("Analysis failed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Build manually" }));

    expect(onBuildManually).toHaveBeenCalledTimes(1);
  });

  it("shows a selected-viewer loading state while analysis is pending", () => {
    render(<Harness analyzePending onBuildManually={vi.fn()} />);

    expect(screen.getByRole("status", { name: "Loading selected page" })).toBeInTheDocument();
    expect(screen.getByText("Loading page preview")).toBeInTheDocument();
  });
});
