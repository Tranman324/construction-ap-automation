import { vi } from "vitest";

import type { SubmitResponse } from "@/modules/accounting/modules/invoices/types/api";
import type {
  SpectrumSubmitCandidate,
  SpectrumSubmitMode,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

interface ModalMocks {
  confetti: ReturnType<typeof vi.fn>;
  discardMutateAsync: ReturnType<typeof vi.fn>;
  discardPending: boolean;
  invoices: unknown[];
  isPending: boolean;
  mutateAsync: ReturnType<typeof vi.fn>;
  routerPush: ReturnType<typeof vi.fn>;
  toastError: ReturnType<typeof vi.fn>;
}

const MODAL_MOCKS = vi.hoisted((): ModalMocks => ({
  confetti: vi.fn(),
  discardMutateAsync: vi.fn(),
  discardPending: false,
  invoices: [],
  isPending: false,
  mutateAsync: vi.fn(),
  routerPush: vi.fn(),
  toastError: vi.fn(),
}));

export function getModalMocks(): ModalMocks {
  return MODAL_MOCKS;
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: MODAL_MOCKS.routerPush,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useInvoices: () => ({
    data: {
      invoices: MODAL_MOCKS.invoices,
      total: MODAL_MOCKS.invoices.length,
      page: 1,
      limit: 100,
      pages: 1,
    },
    isLoading: false,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useDiscardInvoice: () => ({
    isPending: MODAL_MOCKS.discardPending,
    mutateAsync: MODAL_MOCKS.discardMutateAsync,
  }),
  useSubmitToSpectrum: () => ({
    isPending: MODAL_MOCKS.isPending,
    mutateAsync: MODAL_MOCKS.mutateAsync,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitConfetti", () => ({
  fireSpectrumSubmitConfetti: MODAL_MOCKS.confetti,
}));

vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: {
    error: MODAL_MOCKS.toastError,
  },
}));

export function resetModalMocks(): void {
  MODAL_MOCKS.confetti.mockReset();
  MODAL_MOCKS.discardMutateAsync.mockReset();
  MODAL_MOCKS.discardMutateAsync.mockResolvedValue({});
  MODAL_MOCKS.discardPending = false;
  MODAL_MOCKS.invoices = [];
  MODAL_MOCKS.isPending = false;
  MODAL_MOCKS.mutateAsync.mockReset();
  MODAL_MOCKS.mutateAsync.mockResolvedValue(makeSubmitResponse());
  MODAL_MOCKS.routerPush.mockReset();
  MODAL_MOCKS.toastError.mockReset();
}

export function makeCandidate(
  id: string,
  overrides: Partial<SpectrumSubmitCandidate> = {},
): SpectrumSubmitCandidate {
  return {
    id,
    vendorName: "Acme Concrete",
    invoiceNumber: id,
    amount: 1250,
    jobNumber: "24-010",
    lienWaiverStatus: "attached",
    lienWaiverRequired: false,
    linkedLienWaiverId: "waiver-1",
    ...overrides,
  };
}

export function makeInvoice(id: string, overrides: Partial<Invoice> = {}): Invoice {
  return {
    id,
    classification: "invoice",
    confidence: 0.9,
    file: `${id}.pdf`,
    email: { from: "vendor@example.com", subject: "Invoice", receivedAt: "2026-01-01T00:00:00Z" },
    status: "approved",
    queuedAt: "2026-01-01T00:00:00Z",
    extracted: {
      vendorName: "Acme Concrete",
      vendorAddress: null,
      invoiceNumber: id,
      invoiceDate: null,
      dueDate: null,
      amount: 100,
      jobNumber: "24-010",
      projectName: null,
      description: null,
      lineItems: [],
    },
    matching: null,
    overallConfidence: 0.9,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    ...overrides,
  };
}

export function makeSubmitResponse(overrides: Partial<SubmitResponse> = {}): SubmitResponse {
  return {
    success: true,
    submitted: 1,
    message: "Submitted",
    ...overrides,
  };
}

export function makeDeferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: resolvePromise,
  };
}

export const selectedMode: SpectrumSubmitMode = {
  kind: "selected",
  invoices: [
    makeCandidate("inv-1"),
    makeCandidate("inv-2", {
      vendorName: "Beacon Electric",
      invoiceNumber: "B-200",
      amount: 800,
      jobNumber: "24-011",
    }),
  ],
};
