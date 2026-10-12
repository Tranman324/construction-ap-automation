import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => ({
  post: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/modules/shared/lib/api", () => ({
  api: { post: M.post },
  isApiError: () => false,
}));

vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: { success: M.success, error: M.error },
}));

import { DocumentActionsDropdown } from "@/modules/accounting/modules/invoices/components/documents/DocumentActionsDropdown";
import { useReprocessDocumentAction } from "@/modules/accounting/modules/invoices/hooks/useReprocessDocumentAction";

function Harness({ documentId = "document-42" }: { documentId?: string }) {
  const { action, dialog } = useReprocessDocumentAction({ documentId });
  return <>{action && <DocumentActionsDropdown actions={[action]} />}{dialog}</>;
}

function renderWithClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

describe("useReprocessDocumentAction", () => {
  beforeEach(() => {
    M.post.mockReset();
    M.success.mockReset();
    M.error.mockReset();
  });

  it("renders only in the document dropdown and warns about overwritten extracted fields", async () => {
    const user = userEvent.setup();
    renderWithClient(<Harness />);

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Reprocess" }));

    expect(screen.getByRole("alertdialog")).toHaveTextContent("overwrite derived and extracted fields");
  });

  it("does not send a request when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    renderWithClient(<Harness />);

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Reprocess" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(M.post).not.toHaveBeenCalled();
  });

  it("posts the current document id without a request body and describes acceptance, not completion", async () => {
    const user = userEvent.setup();
    M.post.mockResolvedValue({ success: true, id: "document-42", status: "pending" });
    renderWithClient(<Harness documentId="document-42" />);

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Reprocess" }));
    await user.click(screen.getByRole("button", { name: "Reprocess" }));

    await waitFor(() => expect(M.post).toHaveBeenCalledWith("/api/invoices/document-42/reprocess"));
    expect(M.success).toHaveBeenCalledWith("Reprocessing started", {
      description: "The request was accepted. Document status will update after processing finishes.",
    });
  });

  it("disables confirmation while pending and surfaces the server error", async () => {
    const user = userEvent.setup();
    let rejectRequest: (error: Error) => void = () => undefined;
    M.post.mockReturnValue(new Promise<never>((_resolve, reject) => { rejectRequest = reject; }));
    renderWithClient(<Harness />);

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Reprocess" }));
    await user.click(screen.getByRole("button", { name: "Reprocess" }));

    expect(screen.getByRole("button", { name: "Reprocessing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    rejectRequest(new Error("No stored file is available"));
    await waitFor(() => expect(M.error).toHaveBeenCalledWith("Reprocess failed", {
      description: "No stored file is available",
    }));
  });

  it("keeps reprocess out of invoice action bars, list, and bulk surfaces", () => {
    const appRoot = process.cwd();
    const paths = [
      "src/modules/accounting/modules/invoices/components/invoices/InvoiceActionBar.tsx",
      "src/modules/accounting/modules/invoices/components/invoices/BulkActionBar.tsx",
      "src/modules/accounting/modules/invoices/components/invoices/InvoiceTable.tsx",
    ];

    paths.forEach((path) => {
      const source = readFileSync(resolve(appRoot, path), "utf8");
      expect(source).not.toContain("reprocess-document");
      expect(source).not.toContain("useReprocessDocumentAction");
    });
  });
});
