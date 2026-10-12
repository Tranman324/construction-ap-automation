import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canAttachFile,
  DocumentAttachmentDropZone,
} from "@/modules/accounting/modules/invoices/components/documents/DocumentAttachmentDropZone";
import type { AttachFileResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

const TM = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useAttachFile: () => ({ mutateAsync: TM.mutateAsync, isPending: false }),
}));

vi.mock("@/modules/shared/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/modules/shared/components/ui/toaster", () => ({ toast: TM.toast }));

function makeRecord(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "doc-link-only",
    classification: "no-attachment",
    confidence: 0.5,
    file: "",
    email: {
      from: "billing@example.com",
      subject: "Download your invoice",
      receivedAt: "2026-07-15T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-07-15T12:00:00.000Z",
    extracted: null,
    matching: null,
    overallConfidence: 0.5,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    ...overrides,
  };
}

const successResponse: AttachFileResponse = {
  success: true,
  documentId: "doc-link-only",
  classification: "invoice",
  flagged: false,
  notes: null,
  emailAttached: true,
  extracted: { vendorName: "Spot On Plumbing" },
  matching: null,
};

beforeEach(() => {
  TM.mutateAsync.mockReset();
  TM.toast.error.mockReset();
  TM.toast.success.mockReset();
  TM.toast.warning.mockReset();
});

describe("DocumentAttachmentDropZone", () => {
  it("renders for editable records without a file regardless of classification", () => {
    const eligible = makeRecord();
    expect(canAttachFile(eligible)).toBe(true);
    expect(canAttachFile(makeRecord({ classification: "error", status: "modified" }))).toBe(true);
    expect(canAttachFile(makeRecord({ classification: "unsupported" }))).toBe(true);
    expect(canAttachFile(makeRecord({ classification: "invoice" }))).toBe(true);
    const { rerender } = render(<DocumentAttachmentDropZone record={eligible} />);
    expect(screen.getByRole("button", { name: "Attach document file" })).toBeEnabled();
    expect(document.querySelector('input[type="file"]')).toHaveAttribute(
      "accept",
      "application/pdf,image/*",
    );

    rerender(<DocumentAttachmentDropZone record={makeRecord({ file: "invoice.pdf" })} />);
    expect(screen.queryByRole("button", { name: "Attach document file" })).not.toBeInTheDocument();
    rerender(<DocumentAttachmentDropZone record={makeRecord({ status: "submitted" })} />);
    expect(screen.queryByRole("button", { name: "Attach document file" })).not.toBeInTheDocument();
  });

  it("rejects wrong-type and oversized files before mutation", () => {
    render(<DocumentAttachmentDropZone record={makeRecord()} />);
    const zone = screen.getByRole("button", { name: "Attach document file" });
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["text"], "invoice.txt", { type: "text/plain" })] },
    });
    fireEvent.drop(zone, {
      dataTransfer: {
        files: [new File([new Uint8Array(25 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" })],
      },
    });

    expect(TM.mutateAsync).not.toHaveBeenCalled();
    expect(TM.toast.error).toHaveBeenCalledWith("Upload failed", {
      description: "Choose a PDF or image file.",
    });
    expect(TM.toast.error).toHaveBeenCalledWith("Upload failed", {
      description: "File too large. The maximum size is 25 MB.",
    });
  });

  it("uploads one file, shows processing, and reports success", async () => {
    let resolveUpload: (value: AttachFileResponse) => void = () => undefined;
    TM.mutateAsync.mockImplementationOnce(() => new Promise((resolve) => { resolveUpload = resolve; }));
    render(<DocumentAttachmentDropZone record={makeRecord()} />);
    const zone = screen.getByRole("button", { name: "Attach document file" });
    const file = new File(["pdf"], "invoice.pdf", { type: "application/pdf" });

    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    expect(TM.mutateAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Processing document…")).toBeInTheDocument();
    await act(async () => resolveUpload(successResponse));
    await waitFor(() => expect(TM.toast.success).toHaveBeenCalledWith(
      "Document processed — Spot On Plumbing",
    ));
  });

  it("shows a 422 server message and returns to idle", async () => {
    TM.mutateAsync.mockRejectedValueOnce({
      status: 422,
      message: "This looks like a tiny email signature image.",
    });
    render(<DocumentAttachmentDropZone record={makeRecord({ classification: "error" })} />);
    const zone = screen.getByRole("button", { name: "Attach document file" });
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["image"], "scan.png", { type: "image/png" })] },
    });

    await waitFor(() => expect(TM.toast.error).toHaveBeenCalledWith("Upload failed", {
      description: "This looks like a tiny email signature image.",
    }));
    expect(screen.getByText("Drop the invoice PDF here")).toBeInTheDocument();
  });

  it("shows a 500 processing-failure server message verbatim and returns to idle", async () => {
    TM.mutateAsync.mockRejectedValueOnce({
      status: 500,
      message: "Extraction pipeline failed on page 2.",
    });
    render(<DocumentAttachmentDropZone record={makeRecord()} />);
    const zone = screen.getByRole("button", { name: "Attach document file" });
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["pdf"], "invoice.pdf", { type: "application/pdf" })] },
    });

    await waitFor(() => expect(TM.toast.error).toHaveBeenCalledWith("Upload failed", {
      description: "Extraction pipeline failed on page 2.",
    }));
    expect(screen.getByText("Drop the invoice PDF here")).toBeInTheDocument();
  });

});
