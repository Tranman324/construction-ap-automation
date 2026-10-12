import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SplitReviewPage } from "@/modules/accounting/modules/invoices/components/splits/SplitReviewPage";
import { clearSplitPagePreviewCache } from "@/modules/accounting/modules/invoices/lib/splitPagePreviewCache";
import type { ClassificationInfo, SplitDoc } from "@/modules/accounting/modules/invoices/types/api";

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  refetchSplitDoc: vi.fn(),
  confirmMutate: vi.fn(),
  cancelMutate: vi.fn(),
  analyzeMutate: vi.fn(),
  splitDoc: null as SplitDoc | null,
  classifications: [] as ClassificationInfo[],
  splitDocError: null as Error | null,
  splitDocIsError: false,
  splitDocIsFetching: false,
  nextId: null as string | null,
  neighborFilters: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useClassifications: () => ({
    classifications: mocks.classifications,
    data: mocks.classifications,
    availableAssociations: [],
  }),
  useSplitDoc: () => ({
    data: mocks.splitDoc,
    error: mocks.splitDocError,
    isError: mocks.splitDocIsError,
    isFetching: mocks.splitDocIsFetching,
    isLoading: false,
    refetch: mocks.refetchSplitDoc,
  }),
  useInvoiceNeighbors: (_id: string, filters: unknown, options?: unknown) => {
    mocks.neighborFilters.push({ filters, options });
    return { data: { prev: null, next: mocks.nextId, position: 1, total: 2 } };
  },
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useConfirmSplit: () => ({ mutate: mocks.confirmMutate, isPending: false, isError: false, error: null }),
  useCancelSplit: () => ({ mutate: mocks.cancelMutate, isPending: false }),
  useAnalyzeSplit: () => ({ mutate: mocks.analyzeMutate, isPending: false, isError: false, error: null }),
}));

const classifications: ClassificationInfo[] = [
  { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
  { name: "coi", label: "COI", opensAs: "coi", action: "view-only", builtIn: true, status: "active" },
  { name: "building-permit", label: "Building Permit", opensAs: "other", action: "view-only", builtIn: false, status: "active" },
  { name: "disabled-type", label: "Disabled Type", opensAs: "other", action: "view-only", builtIn: false, status: "disabled" },
];

function makeSplitDoc(): SplitDoc {
  return {
    id: "split-1",
    status: "needs-split",
    fileName: "batch.pdf",
    pageCount: 2,
    email: {
      messageId: "message-1",
      from: "ap@example.com",
      subject: "June batch",
      receivedAt: "2026-06-26T12:00:00Z",
    },
    splitSuggestion: {
      pageCount: 2,
      generatedAt: "2026-06-26T12:00:00Z",
      pages: [],
      suggestedGroups: [
        { pages: [1], invoiceNumber: "INV-1", docType: "invoice" },
        { pages: [2], invoiceNumber: "PERMIT-1", docType: "building-permit" },
      ],
    },
    queuedAt: "2026-06-26T12:00:00Z",
  };
}

describe("SplitReviewPage", () => {
  beforeEach(() => {
    mocks.routerPush.mockReset();
    mocks.refetchSplitDoc.mockReset();
    mocks.confirmMutate.mockReset();
    mocks.cancelMutate.mockReset();
    mocks.analyzeMutate.mockReset();
    mocks.classifications = classifications;
    mocks.splitDoc = makeSplitDoc();
    mocks.splitDocError = null;
    mocks.splitDocIsError = false;
    mocks.splitDocIsFetching = false;
    mocks.nextId = null;
    mocks.neighborFilters = [];
    clearSplitPagePreviewCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["preview"]), { status: 200 })));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:page-preview"),
    });
  });

  it("confirms the split through the existing confirm mutation", async () => {
    const user = userEvent.setup();
    render(<SplitReviewPage id="split-1" />);

    await user.click(await screen.findByRole("button", { name: "Confirm Split (2)" }));

    expect(mocks.confirmMutate).toHaveBeenCalledWith(
      {
        id: "split-1",
        payload: {
          groups: [
            { pages: [1], docType: "invoice", displayName: "INV-1" },
            { pages: [2], docType: "building-permit", displayName: "PERMIT-1" },
          ],
          discardPages: [],
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("advances to the next queue document after confirming a split", async () => {
    const user = userEvent.setup();
    mocks.nextId = "next-pending";
    render(
      <SplitReviewPage
        id="split-1"
        returnTo="/accounting/invoices?status=pending"
        queueParams={{ from: "/accounting/invoices?status=pending", status: "pending", sort: "received", sortDir: "desc" }}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Confirm Split (2)" }));
    const options = mocks.confirmMutate.mock.calls[0]?.[1] as { onSuccess?: () => void };
    options.onSuccess?.();

    expect(mocks.routerPush).toHaveBeenCalledWith(
      "/accounting/invoices/next-pending?from=%2Faccounting%2Finvoices%3Fstatus%3Dpending&status=pending&sort=received&sortDir=desc",
    );
    expect(mocks.neighborFilters).toContainEqual(expect.objectContaining({
      filters: expect.objectContaining({
        status: "pending",
        sort: "received",
        sortDir: "desc",
        filed: false,
      }),
    }));
  });

  it("returns to the documents route when no canonical invoice queue context is present", async () => {
    const user = userEvent.setup();
    mocks.nextId = "wrong-default-neighbor";
    render(
      <SplitReviewPage
        id="split-1"
        returnTo="/accounting/invoices?status=documents"
        queueParams={{ from: "/accounting/invoices?status=documents" }}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Confirm Split (2)" }));
    const options = mocks.confirmMutate.mock.calls[0]?.[1] as { onSuccess?: () => void };
    options.onSuccess?.();

    expect(mocks.routerPush).toHaveBeenCalledWith("/accounting/invoices?status=documents");
    expect(mocks.neighborFilters).toContainEqual(expect.objectContaining({ options: { enabled: false } }));
  });

  it("returns to the dashboard queue after confirming the last split document", async () => {
    const user = userEvent.setup();
    render(<SplitReviewPage id="split-1" returnTo="/accounting/invoices?status=pending" />);

    await user.click(await screen.findByRole("button", { name: "Confirm Split (2)" }));
    const options = mocks.confirmMutate.mock.calls[0]?.[1] as { onSuccess?: () => void };
    options.onSuccess?.();

    expect(mocks.routerPush).toHaveBeenCalledWith("/accounting/invoices?status=pending");
  });

  it("routes Cancel back without reject or discard mutation", async () => {
    const user = userEvent.setup();
    render(<SplitReviewPage id="split-1" returnTo="/accounting/invoices/regular-doc" />);

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(mocks.routerPush).toHaveBeenCalledWith("/accounting/invoices/regular-doc");
    expect(mocks.cancelMutate).not.toHaveBeenCalled();
    expect(mocks.confirmMutate).not.toHaveBeenCalled();
  });

  it("keeps the cancel-as-single-doc flow wired to cancel mutation", async () => {
    const user = userEvent.setup();
    render(<SplitReviewPage id="split-1" />);

    await user.click(await screen.findByRole("button", { name: "Treat as single doc" }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));

    expect(mocks.cancelMutate).toHaveBeenCalledWith(
      { id: "split-1" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("opens the same document from the queue after treating it as a single document", async () => {
    const user = userEvent.setup();
    render(
      <SplitReviewPage
        id="split-1"
        queueParams={{ from: "/accounting/invoices?status=pending", status: "pending", search: "batch" }}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Treat as single doc" }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    const options = mocks.cancelMutate.mock.calls[0]?.[1] as { onSuccess?: () => void };
    options.onSuccess?.();

    expect(mocks.routerPush).toHaveBeenCalledWith(
      "/accounting/invoices/split-1?from=%2Faccounting%2Finvoices%3Fstatus%3Dpending&status=pending&search=batch",
    );
  });

  it("returns to the preserved queue URL from the header back action", async () => {
    const user = userEvent.setup();
    render(<SplitReviewPage id="split-1" returnTo="/accounting/invoices?status=needs-split" />);

    await user.click(await screen.findByRole("button", { name: "Back" }));

    expect(mocks.routerPush).toHaveBeenCalledWith("/accounting/invoices?status=needs-split");
  });

  it("renders recovery controls when the split document query fails", async () => {
    const user = userEvent.setup();
    mocks.splitDoc = null;
    mocks.splitDocError = new Error("Split endpoint unavailable");
    mocks.splitDocIsError = true;

    render(<SplitReviewPage id="split-1" returnTo="/accounting/invoices?status=needs-split" />);

    expect(await screen.findByText("Split document could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("Split endpoint unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Build manually")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await user.click(screen.getByRole("button", { name: "Back to queue" }));

    expect(mocks.refetchSplitDoc).toHaveBeenCalledTimes(1);
    expect(mocks.routerPush).toHaveBeenCalledWith("/accounting/invoices?status=needs-split");
  });

  it("renders missing-document recovery instead of a skeleton-only state", async () => {
    mocks.splitDoc = null;

    render(<SplitReviewPage id="split-1" />);

    expect(await screen.findByText("Split document not found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Build manually")).not.toBeInTheDocument();
  });
});
