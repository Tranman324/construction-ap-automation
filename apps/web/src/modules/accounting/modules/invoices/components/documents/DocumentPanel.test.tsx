import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DocumentPanel } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanel";
import type { DocumentSpecDefinition } from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

vi.mock("@/modules/accounting/modules/invoices/components/invoices/dropdowns/JobDropdown", () => ({
  JobDropdown: () => <div>Mock job dropdown</div>,
}));

vi.mock("@/modules/accounting/modules/invoices/components/documents/DestinationPicker", () => ({
  DestinationPicker: () => <div>Mock destination picker</div>,
}));

const invoice: Invoice = {
  id: "doc-1",
  classification: "other",
  confidence: 0.7,
  file: "unknown.pdf",
  email: {
    from: "inbox@example.com",
    subject: "Unknown document",
    receivedAt: "2026-06-01T12:00:00.000Z",
  },
  status: "pending",
  queuedAt: "2026-06-01T12:00:00.000Z",
  extracted: null,
  matching: null,
  overallConfidence: 0.7,
  splitFrom: null,
  duplicateOf: null,
  reason: null,
  error: null,
  reclassifiedFrom: null,
  reclassifiedAt: null,
};

describe("DocumentPanel", () => {
  it("renders the generalized fallback document framework", () => {
    render(<DocumentPanel record={invoice} />);

    expect(screen.getByText("Other")).toBeInTheDocument();
    expect(screen.getByText("Captured Job Match")).toBeInTheDocument();
    expect(screen.getByText("Save to SharePoint")).toBeInTheDocument();
    expect(screen.queryByText("Classify")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shelve" })).toBeDisabled();
  });

  it("registers the active spec pending-save handler", async () => {
    const flush = vi.fn();
    const register = vi.fn();
    const spec: DocumentSpecDefinition<Invoice, { acknowledged: boolean }> = {
      id: "registered-save",
      label: "Registered Save",
      initForm: () => ({ acknowledged: true }),
      flushPendingChanges: () => flush(),
      build: () => ({
        header: { kindLabel: "Other", title: "Unknown document", statusLabel: "Ready" },
        sections: [],
      }),
    };

    render(<DocumentPanel record={invoice} spec={spec} onRegisterPendingSave={register} />);

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith(expect.any(Function));
    });

    const handler = register.mock.calls.find((call) => typeof call[0] === "function")?.[0] as (() => Promise<void>) | undefined;
    await handler?.();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("does not reseed a non-COI form when optional compliance changes", () => {
    const initForm = vi.fn(() => ({ acknowledged: true }));
    const spec: DocumentSpecDefinition<Invoice, { acknowledged: boolean }> = {
      id: "non-coi-stability",
      label: "Non-COI stability",
      initForm,
      build: () => ({ header: { kindLabel: "Other", title: "Unknown document", statusLabel: "Ready" }, sections: [] }),
    };
    const { rerender } = render(<DocumentPanel record={invoice} spec={spec} />);

    rerender(<DocumentPanel record={{ ...invoice, compliance: { verdict: "compliant", evaluatedAt: "now", configVersion: "v1", configVersionId: "v1", checks: [], coverageFailures: [], coverageExceptions: [], expiration: { value: { state: "active", expirationDate: "2027-01-01", daysRemaining: 1 }, provenance: "server", permittedActions: [], blockers: [] }, vendorCode: { value: "SERVER", provenance: "server", permittedActions: [], blockers: [] }, blockers: [], uploadReady: true } }} spec={spec} />);

    expect(initForm).toHaveBeenCalledTimes(1);
  });

  it("reseeds a statement form when canonical attribute values or provenance change", () => {
    const initForm = vi.fn(() => ({ acknowledged: true }));
    const spec: DocumentSpecDefinition<Invoice, { acknowledged: boolean }> = { id: "statement", label: "Statement", initForm, build: () => ({ header: { kindLabel: "Statement", title: "Statement", statusLabel: "Ready" }, sections: [] }) };
    const statement = { ...invoice, classification: "statement" as const, statementAttributes: { statementPeriod: { value: "June", source: "extracted" as const }, balance: { value: 1, source: "computed" as const } } };
    const { rerender } = render(<DocumentPanel record={statement} spec={spec} />);
    rerender(<DocumentPanel record={{ ...statement, statementAttributes: { statementPeriod: { value: "July", source: "manual" }, balance: { value: 2, source: "manual" } } }} spec={spec} />);
    expect(initForm).toHaveBeenCalledTimes(2);
  });
});
