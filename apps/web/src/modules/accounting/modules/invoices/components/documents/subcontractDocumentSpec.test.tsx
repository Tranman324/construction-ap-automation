import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DocumentPanel } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanel";
import { registerFilenameTests } from "./documentFilenameField.testUtils";
import { createSubcontractDocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/subcontractDocumentSpec";
import { makeMutationWrapper } from "@/modules/accounting/modules/invoices/hooks/mutations.testUtils";
import { SEEDED_DESTINATIONS } from "@/modules/accounting/modules/invoices/lib/destinationsFixture";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

const JOB_FOLDER = "24-000/24-017 - North Tower";

vi.mock("@/modules/shared/lib/api", () => ({
  api: {
    get: vi.fn((url: string, params?: Record<string, unknown>) => {
      if (url.includes("/api/jobs/sharepoint/folders")) {
        const path = (params?.path as string) ?? "";
        const responses: Record<string, Array<{ id: string; name: string; hasChildren: null }>> = {
          [JOB_FOLDER]: [
            { id: "c1", name: "01 Contracts", hasChildren: null },
            { id: "c2", name: "04 Closeout", hasChildren: null },
          ],
          [`${JOB_FOLDER}/04 Closeout`]: [{ id: "d1", name: "Warranties", hasChildren: null }],
        };
        return Promise.resolve({ path, folders: responses[path] ?? [] });
      }
      if (url.includes("/folders")) {
        return Promise.resolve({ jobNumber: "24-017", jobFolder: JOB_FOLDER, folders: [] });
      }
      return Promise.reject(new Error(`Unmocked GET: ${url}`));
    }),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

function makeSubcontract(): Invoice {
  return {
    id: "subcontract-1",
    classification: "subcontract",
    confidence: 0.9,
    file: "SC-24-017.pdf",
    email: {
      from: "contracts@example.com",
      subject: "Drywall subcontract retainage 10%",
      receivedAt: "2026-06-12T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-06-12T12:00:00.000Z",
    extracted: {
      vendorName: "Apex Interior Metals",
      vendorAddress: null,
      invoiceNumber: "SC-24-017",
      invoiceDate: null,
      dueDate: null,
      amount: 486500,
      jobNumber: "24-017",
      projectName: "North Tower",
      description: "Drywall and framing subcontract retainage 10%",
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
  };
}

registerFilenameTests(makeSubcontract, (onFileToProject) => createSubcontractDocumentSpec({ onFileToProject, destinations: SEEDED_DESTINATIONS }));

describe("createSubcontractDocumentSpec", () => {
  it("preserves an explicitly selected Projects root when filing a subcontract", async () => {
    const onFileToProject = vi.fn().mockResolvedValue(undefined);
    const spec = createSubcontractDocumentSpec({ onFileToProject, destinations: SEEDED_DESTINATIONS });
    let form = { ...spec.initForm(makeSubcontract()), destinationAbsolute: "" };
    const patchForm = (patch: Partial<typeof form>) => { form = { ...form, ...patch }; };
    const output = spec.build({ record: makeSubcontract(), form, setForm: () => undefined, patchForm });

    await output.primaryAction?.onClick();

    expect(onFileToProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: "subcontract-1" }),
      expect.objectContaining({ destinationAbsolute: "", uploadToSharePoint: true }),
    );
  });

  it("uses the pinned amber Ready tier before filing", () => {
    const spec = createSubcontractDocumentSpec();
    const record = makeSubcontract();
    const form = spec.initForm(record);
    const output = spec.build({ record, form, setForm: () => undefined, patchForm: () => undefined });

    expect(output.header.statusLabel).toBe("Ready");
    expect(output.header.statusTone).toBe("warn");
  });

  it("uses the compact single-flow reference renderer without a duplicate checklist", () => {
    const spec = createSubcontractDocumentSpec({ destinations: SEEDED_DESTINATIONS, onFileToProject: vi.fn() });
    const record = makeSubcontract();
    const output = spec.build({ record, form: spec.initForm(record), setForm: vi.fn(), patchForm: vi.fn() });

    expect(output.preferredRenderer).toBe("scroll");
    expect(output.checklist).toEqual([]);
    expect(output.sections.map((section) => section.title)).toEqual(["Subcontract", "File To"]);
    expect(output.primaryAction?.label).toBe("File to SharePoint");
  });

  it("renders summary fields, lets the destination picker select a folder, and files once", async () => {
    const user = userEvent.setup();
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    const onFileToProject = vi.fn().mockResolvedValue(undefined);
    const { Wrapper } = makeMutationWrapper();

    render(
      <DocumentPanel
        record={makeSubcontract()}
        spec={createSubcontractDocumentSpec({ onFileDocument, onFileToProject, destinations: SEEDED_DESTINATIONS })}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getAllByText("Subcontract").length).toBeGreaterThan(0);
    expect(screen.getByText("Subcontractor")).toBeInTheDocument();
    expect(screen.getByText("Drywall and framing subcontract retainage 10%")).toBeInTheDocument();
    expect(screen.getByText("$486,500.00")).toBeInTheDocument();
    expect(screen.getAllByText("01 Contracts / Subcontracts").length).toBeGreaterThan(0);
    expect(screen.queryByText("Clearance Checklist")).not.toBeInTheDocument();
    expect(screen.getByText("File To")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Browse" }));
    await user.click(await screen.findByRole("button", { name: "Open 04 Closeout" }));
    await user.click(await screen.findByRole("button", { name: "Open Warranties" }));
    await user.click(screen.getByRole("button", { name: "Save to this folder" }));

    expect(screen.getAllByText("04 Closeout / Warranties").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Shelve" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "File to SharePoint" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "File to SharePoint" }));

    await waitFor(() => {
      expect(onFileToProject).toHaveBeenCalledWith(
        expect.objectContaining({ id: "subcontract-1" }),
        expect.objectContaining({
          destination: "04 Closeout / Warranties",
          uploadToSharePoint: true,
        }),
      );
    });
    expect(onFileDocument).not.toHaveBeenCalled();
  });

  it("seeds the destination picker from the served subcontract default (parity)", () => {
    const { Wrapper } = makeMutationWrapper();

    render(
      <DocumentPanel
        record={makeSubcontract()}
        spec={createSubcontractDocumentSpec({
          onFileToProject: vi.fn(),
          destinations: SEEDED_DESTINATIONS,
        })}
      />,
      { wrapper: Wrapper },
    );

    // The picker's initial value comes from the served catalog default, not a
    // hardcoded literal in the spec.
    expect(screen.getAllByText("01 Contracts / Subcontracts").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "File to SharePoint" })).toBeEnabled();
  });

  it("disables filing when the served destinations are unavailable", () => {
    const { Wrapper } = makeMutationWrapper();

    render(
      <DocumentPanel
        record={makeSubcontract()}
        spec={createSubcontractDocumentSpec({
          onFileToProject: vi.fn(),
          destinations: undefined,
        })}
      />,
      { wrapper: Wrapper },
    );

    // No served catalog → the File to Project CTA stays disabled (explicit
    // unavailable state instead of a hardcoded fallback destination).
    expect(screen.getByRole("button", { name: "File to SharePoint" })).toBeDisabled();
  });
});
