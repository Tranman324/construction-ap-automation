import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DocumentPanel } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanel";
import { registerFilenameTests } from "./documentFilenameField.testUtils";
import { createWarrantyDocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/warrantyDocumentSpec";
import { makeMutationWrapper } from "@/modules/accounting/modules/invoices/hooks/mutations.testUtils";
import { SEEDED_DESTINATIONS } from "@/modules/accounting/modules/invoices/lib/destinationsFixture";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

function makeWarranty(): Invoice {
  return {
    id: "warranty-1",
    classification: "warranty",
    confidence: 0.88,
    file: "WTY-24-017.pdf",
    email: {
      from: "service@example.com",
      subject: "Workmanship warranty",
      receivedAt: "2026-06-13T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-06-13T12:00:00.000Z",
    extracted: {
      vendorName: "Climate Mechanical Systems",
      vendorAddress: null,
      invoiceNumber: "WTY-24-017",
      invoiceDate: null,
      dueDate: null,
      amount: null,
      jobNumber: "24-017",
      projectName: "North Tower",
      description: "Workmanship warranty for rooftop units and controls.",
      lineItems: [],
    },
    matching: {
      vendor: null,
      job: null,
      subcontract: {
        subcontractNumber: "SC-24-017-HVAC",
        confidence: 0.84,
        method: "subject",
      },
      sourceInvoiceTotal: null,
    },
    overallConfidence: 0.88,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    filing: {
      fileName: { value: "WTY canonical.pdf", provenance: "computed", permittedActions: [], blockers: [] },
      vendor: { value: "Canonical Warranty Provider", provenance: "manual", permittedActions: [], blockers: [] },
      job: { value: "CANONICAL-JOB", provenance: "manual", permittedActions: [], blockers: [] },
      scope: { value: "Canonical workmanship scope", provenance: "manual", permittedActions: [], blockers: [] },
      providerKind: { value: "Vendor", provenance: "computed", permittedActions: [], blockers: [] },
      warrantyType: { value: "Extended warranty", provenance: "computed", permittedActions: [], blockers: [] },
    },
  };
}

vi.mock("@/modules/shared/lib/api", () => ({
  api: { get: vi.fn().mockRejectedValue(new Error("Synthetic folder catalog unavailable")) },
}));

registerFilenameTests(makeWarranty, (onFileToProject) => createWarrantyDocumentSpec({ onFileToProject, destinations: SEEDED_DESTINATIONS }));

describe("createWarrantyDocumentSpec", () => {
  it("preserves an explicitly selected Projects root when filing a warranty", async () => {
    const onFileToProject = vi.fn().mockResolvedValue(undefined);
    const spec = createWarrantyDocumentSpec({ onFileToProject, destinations: SEEDED_DESTINATIONS });
    let form = { ...spec.initForm(makeWarranty()), destinationAbsolute: "" };
    const patchForm = (patch: Partial<typeof form>) => { form = { ...form, ...patch }; };
    const output = spec.build({ record: makeWarranty(), form, setForm: () => undefined, patchForm });

    await output.primaryAction?.onClick();

    expect(onFileToProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: "warranty-1" }),
      expect.objectContaining({ destinationAbsolute: "", uploadToSharePoint: true }),
    );
  });

  it("uses the pinned amber Ready tier before filing", () => {
    const spec = createWarrantyDocumentSpec();
    const record = makeWarranty();
    const form = spec.initForm(record);
    const output = spec.build({ record, form, setForm: () => undefined, patchForm: () => undefined });

    expect(output.header.statusLabel).toBe("Ready");
    expect(output.header.statusTone).toBe("warn");
  });

  it("renders the lean coverage and destination reference, then files through the existing callback", async () => {
    const user = userEvent.setup();
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    const onFileToProject = vi.fn().mockResolvedValue(undefined);
    const { Wrapper } = makeMutationWrapper();

    render(
      <DocumentPanel record={makeWarranty()} spec={createWarrantyDocumentSpec({ onFileDocument, onFileToProject, destinations: SEEDED_DESTINATIONS })} />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Warranty")).toBeInTheDocument();
    expect(screen.getByText("Coverage")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Extended warranty")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Vendor")).toBeInTheDocument();
    expect(screen.getByText("Canonical workmanship scope")).toBeInTheDocument();
    expect(screen.getByText("CANONICAL-JOB / North Tower")).toBeInTheDocument();
    expect(screen.getByText("Canonical Warranty Provider")).toBeInTheDocument();
    expect(screen.getAllByText("04 Closeout / Warranties").length).toBeGreaterThan(0);
    expect(screen.getByText("File To")).toBeInTheDocument();
    expect(screen.queryByText("Clearance Checklist")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Shelve" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "File to SharePoint" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "File to SharePoint" }));

    await waitFor(() => {
      expect(onFileToProject).toHaveBeenCalledWith(
        expect.objectContaining({ id: "warranty-1" }),
        expect.objectContaining({
          destination: "04 Closeout / Warranties",
          uploadToSharePoint: true,
        }),
      );
    });
    expect(onFileDocument).not.toHaveBeenCalled();
  });

  it("reviews a missing classification at the Coverage section", async () => {
    const user = userEvent.setup();
    const record = makeWarranty();
    record.filing = { ...record.filing!, providerKind: undefined };
    const scrolled: HTMLElement[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement) { scrolled.push(this); };
    try {
      const { Wrapper } = makeMutationWrapper();
      render(<DocumentPanel record={record} spec={createWarrantyDocumentSpec({ onFileToProject: vi.fn(), destinations: SEEDED_DESTINATIONS })} />, { wrapper: Wrapper });
      await user.click(screen.getByRole("button", { name: "Review details" }));
      expect(scrolled).toEqual([document.querySelector('[data-document-section-id="coverage"]')]);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it("surfaces missing classification as required without locally blocking filing", () => {
    const record = makeWarranty();
    record.filing = {
      ...record.filing!,
      providerKind: undefined,
      warrantyType: undefined,
    };
    const { Wrapper } = makeMutationWrapper();

    render(
      <DocumentPanel
        record={record}
        spec={createWarrantyDocumentSpec({
          onFileToProject: vi.fn(),
          destinations: SEEDED_DESTINATIONS,
          canEditClassification: true,
          onUpdateClassification: vi.fn(),
        })}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Provider kind required — Add the warranty provider kind before filing.")).toBeInTheDocument();
    expect(screen.getByText("Warranty type required — Add the warranty type before filing.")).toBeInTheDocument();
    expect(screen.getAllByText("REQUIRED")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "File to SharePoint" })).toBeEnabled();
  });

  it("renders a retained classification failure verbatim", () => {
    const { Wrapper } = makeMutationWrapper();
    render(
      <DocumentPanel
        record={makeWarranty()}
        spec={createWarrantyDocumentSpec({ classificationError: "The server refused this warranty change" })}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Warranty classification could not be saved — The server refused this warranty change")).toBeInTheDocument();
  });
});
