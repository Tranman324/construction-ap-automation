import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFallbackDocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/fallbackDocumentSpec";
import { DocumentPanel } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanel";
import { getServerFilingFileName } from "@/modules/accounting/modules/invoices/components/documents/documentFilingResult";
import { SEEDED_DESTINATIONS } from "@/modules/accounting/modules/invoices/lib/destinationsFixture";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: toastMock,
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/dropdowns/JobDropdown", () => ({
  JobDropdown: ({
    value,
    onChange,
    disabled,
  }: {
    value: string | null;
    onChange: (value: string | null) => void;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={() => onChange("26-499")}>
      Change job from {value}
    </button>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/documents/DestinationPicker", () => ({
  DestinationPicker: () => <div>Destination picker</div>,
}));

const invoice: Invoice = {
  id: "doc-1",
  classification: "purchase-order",
  confidence: 0.82,
  file: "po-104.pdf",
  email: {
    from: "vendor@example.com",
    subject: "PO 104",
    receivedAt: "2026-06-01T12:00:00.000Z",
  },
  status: "pending",
  queuedAt: "2026-06-01T12:00:00.000Z",
  extracted: null,
  matching: {
    vendor: null,
    job: {
      jobNumber: "26-434",
      jobDescription: "Lakeshore Vascular",
      confidence: 0.91,
      method: "project-address",
    },
    subcontract: null,
    sourceInvoiceTotal: null,
  },
  overallConfidence: 0.82,
  splitFrom: null,
  duplicateOf: null,
  reason: null,
  error: null,
  reclassifiedFrom: null,
  reclassifiedAt: null,
  filing: {
    fileName: {
      value: "DOC vendor 06-01-26.pdf",
      provenance: "computed",
      permittedActions: [],
      blockers: [],
    },
  },
};

const serverFilingInvoice = {
  ...invoice,
  filing: {
    fileName: {
      value: "PO 104 server candidate.pdf",
      provenance: "computed" as const,
      permittedActions: [] as string[],
      blockers: [] as string[],
    },
  },
};

describe("createFallbackDocumentSpec", () => {
  beforeEach(() => {
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it("preserves an explicitly selected Projects root when filing a fallback document", async () => {
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    const spec = createFallbackDocumentSpec({ onFileDocument, destinations: SEEDED_DESTINATIONS });
    let form = { ...spec.initForm(invoice), destinationAbsolute: "" };
    const patchForm = (patch: Partial<typeof form>) => { form = { ...form, ...patch }; };
    const output = spec.build({ record: invoice, form, setForm: () => undefined, patchForm });

    expect(output.primaryAction?.label).toBe("File to SharePoint");
    await output.primaryAction?.onClick();

    expect(onFileDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: "doc-1" }),
      expect.objectContaining({ destinationAbsolute: "", uploadToSharePoint: true }),
    );
  });

  it("builds the generalized simple-filing render model", async () => {
    const onFileToProject = vi.fn().mockResolvedValue(undefined);
    const spec = createFallbackDocumentSpec({
      auditEntries: [{
        id: "audit-1",
        action: "mark-reviewed",
        actor: "dana@example.com",
        changes: {},
        createdAt: "2026-06-01T12:00:00.000Z",
      }],
      secondaryActions: [{
        id: "file",
        label: "Shelve",
        onClick: () => undefined,
      }],
      onFileDocument: vi.fn(),
      onFileToProject,
      destinations: SEEDED_DESTINATIONS,
    });
    const form = spec.initForm(invoice);
    const output = spec.build({
      record: invoice,
      form,
      setForm: () => undefined,
      patchForm: () => undefined,
    });

    expect(output.header.kindLabel).toBe("Purchase Order");
    expect(output.header.statusLabel).toBe("Ready");
    expect(output.header.statusTone).toBe("warn");
    expect(output.preferredRenderer).toBe("scroll");
    expect(output.checklist).toBeUndefined();
    expect(output.primaryAction?.id).toBe("shelve-document");
    expect(output.primaryAction?.label).toBe("Shelve");
    expect(output.primaryAction?.disabled).toBe(false);
    expect(output.secondaryActions?.map((action) => action.id)).toEqual(["file"]);
    expect(output.sections.map((section) => section.id)).toEqual(["captured", "destination", "source", "activity"]);

    render(
      <>
        {output.sections[1].action}
        {output.sections[2].children}
        {output.sections[3].children}
      </>,
    );
    expect(screen.getByText("PO 104")).toBeInTheDocument();
    expect(screen.getByText("dana@example.com")).toBeInTheDocument();

    screen.getByRole("button", { name: "File to Project" }).click();
    expect(onFileToProject).toHaveBeenCalledWith(
      invoice,
      expect.objectContaining({ destination: "", uploadToSharePoint: true }),
    );
  });

  it("uses File to SharePoint as the primary action for building permits", async () => {
    const onFileToProject = vi.fn().mockResolvedValue(undefined);
    const spec = createFallbackDocumentSpec({
      onFileDocument: vi.fn(),
      onFileToProject,
      destinations: SEEDED_DESTINATIONS,
    });
    const permit: Invoice = {
      ...invoice,
      classification: "building-permit",
      filing: {
        fileName: {
          value: "PMT vendor 06-01-26.pdf",
          provenance: "computed",
          permittedActions: [],
          blockers: [],
        },
      },
    };
    const form = spec.initForm(permit);
    const output = spec.build({
      record: permit,
      form,
      setForm: () => undefined,
      patchForm: () => undefined,
    });

    expect(output.primaryAction?.label).toBe("File to SharePoint");
    expect(output.sections.find((section) => section.id === "destination")?.action).toBeUndefined();

    await output.primaryAction?.onClick();

    expect(onFileToProject).toHaveBeenCalledWith(
      permit,
      expect.objectContaining({ destination: "", uploadToSharePoint: true }),
    );
  });

  it("labels a fallback footer as SharePoint only when the existing action includes the selected folder", async () => {
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    const spec = createFallbackDocumentSpec({ onFileDocument, destinations: SEEDED_DESTINATIONS });
    const initial = spec.initForm(invoice);
    const beforeSelection = spec.build({ record: invoice, form: initial, setForm: () => undefined, patchForm: () => undefined });
    const afterSelection = spec.build({
      record: invoice,
      form: { ...initial, destinationAbsolute: "24-000/26-434 - Lakeshore Vascular/02 Financials" },
      setForm: () => undefined,
      patchForm: () => undefined,
    });

    expect(beforeSelection.primaryAction?.label).toBe("Shelve");
    expect(afterSelection.primaryAction?.label).toBe("File to SharePoint");

    await afterSelection.primaryAction?.onClick();
    expect(onFileDocument).toHaveBeenCalledWith(
      invoice,
      expect.objectContaining({
        destinationAbsolute: "24-000/26-434 - Lakeshore Vascular/02 Financials",
        uploadToSharePoint: true,
      }),
    );
  });

  it("leaves a fallback document unresolved when its selected SharePoint upload is rejected", async () => {
    const onFileDocument = vi.fn().mockResolvedValue({
      sharePoint: { uploaded: false, error: "Fallback folder access denied" },
    });
    const spec = createFallbackDocumentSpec({ onFileDocument, destinations: SEEDED_DESTINATIONS });
    let form = {
      ...spec.initForm(invoice),
      destination: "02 Financials",
      destinationAbsolute: "24-000/26-434 - Lakeshore Vascular/02 Financials",
    };
    const patchForm = (patch: Partial<typeof form>) => {
      form = { ...form, ...patch };
    };
    const output = spec.build({ record: invoice, form, setForm: () => undefined, patchForm });

    expect(output.primaryAction?.label).toBe("File to SharePoint");
    await output.primaryAction?.onClick();

    expect(form.filed).toBe(false);
    expect(form.filing).toBe(false);
    expect(form.filingError).toBe("Fallback folder access denied");
  });

  it("clears a selected SharePoint folder when the fallback job changes", async () => {
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    const onUpdateDocument = vi.fn().mockResolvedValue(undefined);
    const spec = createFallbackDocumentSpec({ onFileDocument, onUpdateDocument, destinations: SEEDED_DESTINATIONS });
    const initial = {
      ...spec.initForm(invoice),
      destination: "02 Financials",
      destinationAbsolute: "24-000/26-434 - Lakeshore Vascular/02 Financials",
    };
    let current = initial;
    const patchForm = (patch: Partial<typeof initial>) => {
      current = { ...current, ...patch };
    };
    const selected = spec.build({ record: invoice, form: current, setForm: () => undefined, patchForm });

    render(selected.sections[0].children);
    await userEvent.setup().click(screen.getByRole("button", { name: "Change job from 26-434" }));

    expect(current.destinationAbsolute).toBeUndefined();
    const afterJobChange = spec.build({ record: invoice, form: current, setForm: () => undefined, patchForm });
    expect(afterJobChange.primaryAction?.label).toBe("Shelve");
    await afterJobChange.primaryAction?.onClick();
    expect(onFileDocument).toHaveBeenCalledWith(invoice);
    expect(onFileDocument).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ destinationAbsolute: expect.anything() }),
    );
  });

  it("serializes a fallback job update and restores the exact selected destination after a synchronous rejection", async () => {
    const user = userEvent.setup();
    const onUpdateDocument = vi.fn(() => { throw new Error("Fallback job was rejected"); });
    const selected = {
      ...invoice,
      filedDestination: "02 Financials",
    };

    render(
      <DocumentPanel
        record={selected}
        spec={createFallbackDocumentSpec({ onFileDocument: vi.fn(), onUpdateDocument, destinations: SEEDED_DESTINATIONS })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Change job from 26-434" }));
    await waitFor(() => expect(onUpdateDocument).toHaveBeenCalledWith(selected, { jobNumber: "26-499" }));
    expect(onUpdateDocument).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Change job from 26-434" })).toBeEnabled();
  });

  it("prevents a second fallback job change while the first update is pending", async () => {
    const user = userEvent.setup();
    let rejectUpdate: ((reason?: unknown) => void) | undefined;
    const onUpdateDocument = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectUpdate = reject; }));

    render(
      <DocumentPanel
        record={invoice}
        spec={createFallbackDocumentSpec({ onFileDocument: vi.fn(), onUpdateDocument, destinations: SEEDED_DESTINATIONS })}
      />,
    );

    const job = screen.getByRole("button", { name: "Change job from 26-434" });
    await user.click(job);
    await waitFor(() => expect(onUpdateDocument).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Change job from 26-499" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Change job from 26-499" }));
    expect(onUpdateDocument).toHaveBeenCalledTimes(1);

    rejectUpdate?.(new Error("Fallback job was rejected"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Change job from 26-434" })).toBeEnabled());
  });

  it("surfaces rejected job updates without an unhandled rejection", async () => {
    const user = userEvent.setup();
    const onUpdateDocument = vi.fn().mockRejectedValue(new Error("Job save failed"));
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      unhandledRejections.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    try {
      const spec = createFallbackDocumentSpec({ onUpdateDocument });
      const form = spec.initForm(invoice);
      const output = spec.build({
        record: invoice,
        form,
        setForm: () => undefined,
        patchForm: () => undefined,
      });

      render(output.sections[0].children);
      await user.click(screen.getByRole("button", { name: "Change job from 26-434" }));

      await waitFor(() => {
        expect(toastMock.error).toHaveBeenCalledWith("Document update failed", {
          description: "Job save failed",
        });
      });
      expect(onUpdateDocument).toHaveBeenCalledWith(invoice, { jobNumber: "26-499" });
      expect(unhandledRejections).toEqual([]);
    } finally {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    }
  });

  it("restores the prior fallback job and selected SharePoint folder when a job update is rejected", async () => {
    const onUpdateDocument = vi.fn().mockRejectedValue(new Error("Fallback job was rejected"));
    const spec = createFallbackDocumentSpec({ onUpdateDocument, destinations: SEEDED_DESTINATIONS });
    let form = {
      ...spec.initForm(invoice),
      destination: "02 Financials",
      destinationAbsolute: "24-000/26-434 - Lakeshore Vascular/02 Financials",
    };
    const patchForm = (patch: Partial<typeof form>) => {
      form = { ...form, ...patch };
    };
    const output = spec.build({ record: invoice, form, setForm: () => undefined, patchForm });

    render(output.sections[0].children);
    await userEvent.setup().click(screen.getByRole("button", { name: "Change job from 26-434" }));

    await waitFor(() => expect(form).toMatchObject({
      jobNumber: "26-434",
      destination: "02 Financials",
      destinationAbsolute: "24-000/26-434 - Lakeshore Vascular/02 Financials",
    }));
  });

  it("allows a permitted filename override and resets it to the server suggestion", async () => {
    const user = userEvent.setup();
    const onFileToProject = vi.fn().mockResolvedValue(undefined);
    const editable = {
      ...serverFilingInvoice,
      filing: { fileName: { ...serverFilingInvoice.filing.fileName, permittedActions: ["edit"] } },
    };
    render(<DocumentPanel record={editable} spec={createFallbackDocumentSpec({ onFileDocument: vi.fn(), onFileToProject, destinations: SEEDED_DESTINATIONS })} />);

    const filename = screen.getByLabelText("File name");
    expect(filename).toHaveValue("PO 104 server candidate.pdf");
    expect(filename).not.toHaveAttribute("readonly");
    await user.clear(filename);
    await user.type(filename, "Custom PO");
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(filename).toHaveValue("PO 104 server candidate.pdf");
    await user.clear(filename);
    await user.type(filename, "Custom PO");
    await user.click(screen.getByRole("button", { name: "File to Project" }));
    await waitFor(() => expect(onFileToProject).toHaveBeenCalledWith(editable, expect.objectContaining({ filename: "Custom PO.pdf" })));
  });

  it("keeps the filing suggestion locked without server edit permission", () => {
    render(<DocumentPanel record={serverFilingInvoice} spec={createFallbackDocumentSpec({ destinations: SEEDED_DESTINATIONS })} />);

    expect(screen.getByLabelText("File name")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("File name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
  });

  it("renders canonical vendor, job, and scope envelopes when source fields conflict", () => {
    const canonical = {
      ...invoice,
      extracted: {
        vendorName: "Extracted vendor",
        vendorAddress: null,
        invoiceNumber: null,
        invoiceDate: null,
        dueDate: null,
        amount: null,
        jobNumber: "EXTRACTED-JOB",
        projectName: "Extracted project",
        description: "Extracted scope",
        lineItems: [],
      },
      matching: {
        ...invoice.matching!,
        vendor: { vendorCode: "MATCH", vendorName: "Matched vendor", confidence: 0.8, method: "match" },
        job: { jobNumber: "MATCHED-JOB", jobDescription: "Matched project", confidence: 0.8, method: "match" },
      },
      email: { ...invoice.email, from: "email-vendor@example.com", subject: "Email scope" },
      filing: {
        fileName: { value: "DOC canonical.pdf", provenance: "computed" as const, permittedActions: [], blockers: [] },
        vendor: { value: "Canonical vendor", provenance: "manual" as const, permittedActions: [], blockers: [] },
        job: { value: "CANONICAL-JOB", provenance: "manual" as const, permittedActions: [], blockers: [] },
        scope: { value: "Canonical scope", provenance: "manual" as const, permittedActions: [], blockers: [] },
      },
    } satisfies Invoice;

    render(<DocumentPanel record={canonical} spec={createFallbackDocumentSpec()} />);
    expect(screen.getByRole("button", { name: "Change job from CANONICAL-JOB" })).toBeInTheDocument();
    expect(screen.getByText("Canonical vendor")).toBeInTheDocument();
    expect(screen.getByText("Canonical scope")).toBeInTheDocument();
  });

  it("keeps the historical SharePoint filename ahead of a regenerated filing candidate", () => {
    const historical = {
      ...serverFilingInvoice,
      sharePointFilename: "DOC historical uploaded.pdf",
    };
    expect(getServerFilingFileName(historical)).toBe("DOC historical uploaded.pdf");
  });

  it("confirms the current candidate when refiling a row with a historical SharePoint name", async () => {
    const onFileToProject = vi.fn().mockResolvedValue({ sharePoint: { uploaded: true } });
    const historical = {
      ...serverFilingInvoice,
      filed: true,
      sharePointFilename: "DOC historical uploaded.pdf",
    };
    const spec = createFallbackDocumentSpec({ onFileToProject, destinations: SEEDED_DESTINATIONS });
    render(<DocumentPanel record={historical} spec={spec} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "File to Project" }));

    expect(onFileToProject).toHaveBeenCalledWith(
      historical,
      expect.not.objectContaining({ filename: expect.any(String) }),
    );
  });

  it("keeps the suggested filename and literal error when an older server returns stale-preview conflict", async () => {
    const user = userEvent.setup();
    const onFileToProject = vi.fn().mockRejectedValueOnce({
      status: 409,
      code: "FILING_FILENAME_STALE",
      message: "Filing filename preview is stale.",
      details: {
        filing: {
          fileName: {
            value: "PO 104 refreshed candidate.pdf",
            provenance: "computed",
            permittedActions: [],
            blockers: [],
          },
        },
      },
    });

    render(
      <DocumentPanel
        record={serverFilingInvoice}
        spec={createFallbackDocumentSpec({
          onFileDocument: vi.fn(),
          onFileToProject,
          destinations: SEEDED_DESTINATIONS,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "File to Project" }));
    await waitFor(() => {
      expect(screen.getByText("Filing error — Filing filename preview is stale.")).toBeInTheDocument();
      expect(screen.getByLabelText("File name")).toHaveValue("PO 104 server candidate.pdf");
    });
    expect(onFileToProject).toHaveBeenCalledWith(
      serverFilingInvoice,
      expect.not.objectContaining({ filename: expect.anything() }),
    );
  });

  it.each([403, 422])("keeps the literal %i filing refusal visible", async (status) => {
    const user = userEvent.setup();
    const message = `Filing ${status} refusal from server`;
    const onFileToProject = vi.fn().mockRejectedValueOnce({ status, message });
    render(
      <DocumentPanel
        record={serverFilingInvoice}
        spec={createFallbackDocumentSpec({ onFileDocument: vi.fn(), onFileToProject, destinations: SEEDED_DESTINATIONS })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "File to Project" }));
    await waitFor(() => expect(screen.getByText(`Filing error — ${message}`)).toBeInTheDocument());
    // Blockers keep their navigation and never become dismissible [fix-2].
    expect(screen.getByRole("button", { name: "Review details" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });
});
