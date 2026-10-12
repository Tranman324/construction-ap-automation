import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DocumentPanel } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanel";
import { createReceiptDocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/receiptDocumentSpec";
import { SEEDED_DESTINATIONS } from "@/modules/accounting/modules/invoices/lib/destinationsFixture";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

interface MockJobDropdownProps {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

interface MockDestinationPickerProps {
  value: string;
  onChangePath: (value: string) => void;
}

vi.mock("@/modules/accounting/modules/invoices/components/invoices/dropdowns/JobDropdown", () => ({
  JobDropdown: ({ value, onChange, disabled }: MockJobDropdownProps) => (
    <button type="button" disabled={disabled} onClick={() => onChange("26-999")}>Job {value ?? "none"}</button>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/documents/DestinationPicker", () => ({
  DestinationPicker: ({ value, onChangePath }: MockDestinationPickerProps) => (
    <div>
      Destination {value}
      <button type="button" onClick={() => onChangePath("24-000/26-434 - Brightwater North/02 Financials")}>Choose SharePoint folder</button>
    </div>
  ),
}));

const SEEDED_CODING_OPTIONS = {
  expenseCategories: [
    { value: "5300", label: "5300 - Materials Job Cost" },
    { value: "5900", label: "5900 - Miscellaneous Job Cost" },
  ],
  phaseOptions: [
    { value: "01000", label: "01000 - General Requirements" },
  ],
  costTypes: [
    { value: "M", label: "M - Material" },
    { value: "E", label: "E - Equipment" },
  ],
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeReceipt(): Invoice {
  return {
    id: "receipt-1234",
    classification: "receipt",
    confidence: 0.72,
    file: "receipt-1234.pdf",
    email: {
      from: "receipts@example.com",
      subject: "Home Depot receipt",
      receivedAt: "2026-06-11T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-06-11T12:00:00.000Z",
    extracted: {
      vendorName: "The Home Depot",
      vendorAddress: null,
      invoiceNumber: "R-100",
      invoiceDate: "2026-06-10T12:00:00.000Z",
      dueDate: null,
      amount: 128.45,
      jobNumber: null,
      jobRef: "26-434",
      projectName: null,
      description: null,
      lineItems: [],
    },
    matching: {
      vendor: null,
      job: {
        jobNumber: "26-434",
        jobDescription: "Brightwater North",
        confidence: 0.88,
        method: "receipt-job-ref",
      },
      subcontract: null,
      sourceInvoiceTotal: null,
    },
    overallConfidence: 0.72,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    filing: {
      fileName: {
        value: "RCT The Home Depot 06-10-26 R-100",
        provenance: "computed",
        permittedActions: [],
        blockers: [],
      },
    },
  };
}

function makeReceiptWithServerFiling(): Invoice {
  return {
    ...makeReceipt(),
    filing: {
      fileName: {
        value: "RCT Home Depot server candidate.pdf",
        provenance: "computed",
        permittedActions: [],
        blockers: [],
      },
    },
  };
}

describe("createReceiptDocumentSpec", () => {
  it("preserves an explicitly selected Projects root when filing a receipt", async () => {
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    const spec = createReceiptDocumentSpec({ onFileDocument, destinations: SEEDED_DESTINATIONS });
    let form = { ...spec.initForm(makeReceipt()), categoryCode: "5300", destinationAbsolute: "" };
    const patchForm = (patch: Partial<typeof form>) => { form = { ...form, ...patch }; };
    const output = spec.build({ record: makeReceipt(), form, setForm: () => undefined, patchForm });

    expect(output.primaryAction?.label).toBe("File to SharePoint");
    await output.primaryAction?.onClick();

    expect(onFileDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: "receipt-1234" }),
      expect.objectContaining({ destinationAbsolute: "", uploadToSharePoint: true }),
    );
  });

  it("uses SharePoint prerequisites for an explicit Projects root instead of job-cost prerequisites", () => {
    const receipt = makeReceipt();
    receipt.extracted = { ...receipt.extracted!, jobNumber: null, jobRef: null };
    receipt.matching = { ...receipt.matching!, job: null };
    const spec = createReceiptDocumentSpec({
      onFileDocument: vi.fn(),
      destinations: SEEDED_DESTINATIONS,
    });
    const form = {
      ...spec.initForm(receipt),
      jobNumber: "",
      categoryCode: "",
      destinationAbsolute: "",
    };
    const output = spec.build({ record: receipt, form, setForm: () => undefined, patchForm: () => undefined });

    expect(output.primaryAction).toMatchObject({ label: "File to SharePoint", disabled: false });
  });

  it("removes Job Cost required markers when an explicit SharePoint path is selected", async () => {
    const user = userEvent.setup();
    const receipt = makeReceipt();
    receipt.extracted = { ...receipt.extracted!, jobNumber: null, jobRef: null };
    receipt.matching = { ...receipt.matching!, job: null };

    render(
      <DocumentPanel
        record={receipt}
        spec={createReceiptDocumentSpec({
          onFileDocument: vi.fn(),
          onUpdateDocument: vi.fn().mockResolvedValue(undefined),
          destinations: SEEDED_DESTINATIONS,
          codingOptions: SEEDED_CODING_OPTIONS,
        })}
      />,
    );

    expect(screen.getAllByText("REQUIRED")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "File to Job Cost" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Choose SharePoint folder" }));

    expect(screen.getByRole("button", { name: "File to SharePoint" })).toBeEnabled();
    expect(screen.queryByText("REQUIRED")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Expense category")).not.toHaveClass("border-l-tone-amber");
  });

  it("uses the pinned amber Unfiled tier before a receipt is shelved", () => {
    const spec = createReceiptDocumentSpec();
    const form = spec.initForm(makeReceipt());
    const output = spec.build({ record: makeReceipt(), form, setForm: () => undefined, patchForm: () => undefined });

    expect(output.header.statusLabel).toBe("Unfiled");
    expect(output.header.statusTone).toBe("warn");
    expect(output.alerts?.map((alert) => alert.id)).toEqual(["receipt-card-match"]);
    expect(output.alerts?.[0]?.action).toMatchObject({ label: "Match card", disabled: true });
    expect(output.alerts?.[0]?.action?.disabledReason).toBe("Card matching is not available from this panel yet.");
    expect(new Set(output.alerts?.map((alert) => alert.id)).size).toBe(output.alerts?.length);
  });

  it("shows unknown receipt values without fabricating captured data", () => {
    const receipt = makeReceipt();
    receipt.extracted = receipt.extracted ? { ...receipt.extracted, invoiceDate: null } : receipt.extracted;
    render(<DocumentPanel record={receipt} spec={createReceiptDocumentSpec()} />);

    expect(screen.getByLabelText("Purchase date")).toHaveValue("");
    expect(screen.getByLabelText("Purchase date")).toBeDisabled();
    expect(screen.queryByText("Sales tax")).not.toBeInTheDocument();
    expect(screen.getAllByText("No card match — Match this receipt to a purchasing-card transaction.")).toHaveLength(1);
  });

  it("renders editable receipt fields with a disabled card-match placeholder", async () => {
    const user = userEvent.setup();
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    const onUpdateDocument = vi.fn().mockResolvedValue(undefined);

    render(
      <DocumentPanel
        record={makeReceipt()}
        spec={createReceiptDocumentSpec({ onFileDocument, onUpdateDocument, codingOptions: SEEDED_CODING_OPTIONS })}
      />,
    );

    expect(screen.getByText("Receipt")).toBeInTheDocument();
    expect(screen.queryByText("Clearance Checklist")).not.toBeInTheDocument();
    expect(screen.getByText("Edit Captured Data")).toBeInTheDocument();
    expect(screen.getByText("Job & Cost Coding")).toBeInTheDocument();
    expect(screen.queryByText("Captured Data")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit captured data")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Merchant")).toHaveValue("The Home Depot");
    expect(screen.getByLabelText("Purchase date")).toHaveValue("2026-06-10");
    expect(screen.queryByLabelText("Sales tax")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Total")).toHaveValue("128.45");
    expect(screen.queryByText("Auto-save")).not.toBeInTheDocument();
    expect(screen.queryByText("Saving...")).not.toBeInTheDocument();
    expect(screen.getAllByText("No card match — Match this receipt to a purchasing-card transaction.")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Find match" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Match card" })).toBeDisabled();
    expect(screen.getByTestId("document-resolve-tray")).toContainElement(screen.getByText("No card match — Match this receipt to a purchasing-card transaction."));
    // Coding selects are editable — they were previously rendered `disabled`,
    // so a receipt's expense category / phase / cost type could never be set.
    expect(screen.getByLabelText("Expense category")).toBeEnabled();
    expect(screen.getByLabelText("Phase code")).toBeEnabled();
    expect(screen.getByLabelText("Cost type")).toBeEnabled();
    expect(screen.getByRole("option", { name: "5300 - Materials Job Cost" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "01000 - General Requirements" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "E - Equipment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File to Job Cost" })).toBeDisabled();

    await user.clear(screen.getByLabelText("Merchant"));
    await user.type(screen.getByLabelText("Merchant"), "Lowe's");
    await waitFor(() => {
      expect(onUpdateDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: "receipt-1234" }),
        { vendorName: "Lowe's" },
      );
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Total"));
    await user.type(screen.getByLabelText("Total"), "94.47");

    await waitFor(() => {
      expect(onUpdateDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: "receipt-1234" }),
        { amount: 94.47 },
      );
    });
    expect(screen.getAllByText("Saved").length).toBeGreaterThanOrEqual(1);

    await user.clear(screen.getByLabelText("Total"));
    await user.type(screen.getByLabelText("Total"), "-94.47");

    await waitFor(() => {
      expect(onUpdateDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: "receipt-1234" }),
        { amount: -94.47 },
      );
    });
    expect(screen.getAllByText("Saved").length).toBeGreaterThanOrEqual(1);

    await user.clear(screen.getByLabelText("Total"));
    await user.type(screen.getByLabelText("Total"), "nope");
    expect(screen.getByText("Use a valid dollar amount.")).toBeInTheDocument();
    expect(screen.getByLabelText("Total")).toHaveAttribute("aria-invalid", "true");

    await user.click(screen.getByRole("button", { name: "Job 26-434" }));
    await waitFor(() => {
      expect(onUpdateDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: "receipt-1234" }),
        { jobNumber: "26-999" },
      );
    });
    expect(screen.getAllByText("Saved").length).toBeGreaterThanOrEqual(1);

    await user.selectOptions(screen.getByLabelText("Expense category"), "5300");
    await waitFor(() => expect(screen.getByRole("button", { name: "File to Job Cost" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "File to Job Cost" }));
    await waitFor(() => {
      expect(onFileDocument).toHaveBeenCalledWith(expect.objectContaining({ id: "receipt-1234" }));
    });
  });

  it("files receipts with a permitted filename override and can reset it", async () => {
    const user = userEvent.setup();
    const onFileToProject = vi.fn().mockResolvedValue(undefined);
    const editable = {
      ...makeReceiptWithServerFiling(),
      filing: { fileName: { ...makeReceiptWithServerFiling().filing!.fileName, permittedActions: ["edit"] } },
    };

    render(
      <DocumentPanel
        record={editable}
        spec={createReceiptDocumentSpec({
          onFileDocument: vi.fn(),
          onFileToProject,
          destinations: SEEDED_DESTINATIONS,
        })}
      />,
    );
    const filename = screen.getByLabelText("File name");
    expect(filename).toHaveValue("RCT Home Depot server candidate.pdf");
    expect(filename).not.toHaveAttribute("readonly");
    await user.clear(filename);
    await user.type(filename, "Custom receipt");
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(filename).toHaveValue("RCT Home Depot server candidate.pdf");
    await user.clear(filename);
    await user.type(filename, "Custom receipt");
    await user.click(screen.getByRole("button", { name: "File to Project" }));

    await waitFor(() => {
      expect(onFileToProject).toHaveBeenCalledWith(
        editable,
        expect.objectContaining({ destination: "", uploadToSharePoint: true, filename: "Custom receipt.pdf" }),
      );
    });
  });

  it("labels the footer as SharePoint only after an explicit folder choice and preserves job-cost filing metadata", async () => {
    const user = userEvent.setup();
    const onFileDocument = vi.fn().mockResolvedValue(undefined);

    render(
      <DocumentPanel
        record={makeReceipt()}
        spec={createReceiptDocumentSpec({
          onFileDocument,
          destinations: SEEDED_DESTINATIONS,
          codingOptions: SEEDED_CODING_OPTIONS,
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "File to Job Cost" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "File to SharePoint" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Expense category"), "5300");
    await user.click(screen.getByRole("button", { name: "Choose SharePoint folder" }));
    await user.click(screen.getByRole("button", { name: "File to SharePoint" }));

    await waitFor(() => expect(onFileDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: "receipt-1234" }),
      expect.objectContaining({
        destinationAbsolute: "24-000/26-434 - Brightwater North/02 Financials",
        uploadToSharePoint: true,
      }),
    ));
    expect(screen.getByText("File to Project")).toBeInTheDocument();
  });

  it("clears an explicit SharePoint destination and restores Job Cost prerequisites", async () => {
    const user = userEvent.setup();
    render(
      <DocumentPanel
        record={makeReceipt()}
        spec={createReceiptDocumentSpec({
          onFileDocument: vi.fn(),
          onUpdateDocument: vi.fn().mockResolvedValue(undefined),
          destinations: SEEDED_DESTINATIONS,
          codingOptions: SEEDED_CODING_OPTIONS,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Choose SharePoint folder" }));
    expect(screen.getByRole("button", { name: "File to SharePoint" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Clear SharePoint destination" }));
    expect(screen.queryByRole("button", { name: "File to SharePoint" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File to Job Cost" })).toBeDisabled();
  });

  it("leaves a receipt unresolved when its selected SharePoint upload is rejected", async () => {
    const onFileDocument = vi.fn().mockResolvedValue({
      sharePoint: { uploaded: false, error: "Receipt folder access denied" },
    });
    const spec = createReceiptDocumentSpec({ onFileDocument, destinations: SEEDED_DESTINATIONS });
    let form = {
      ...spec.initForm(makeReceipt()),
      categoryCode: "5300",
      destination: "02 Financials",
      destinationAbsolute: "24-000/26-434 - Brightwater North/02 Financials",
    };
    const patchForm = (patch: Partial<typeof form>) => {
      form = { ...form, ...patch };
    };
    const output = spec.build({ record: makeReceipt(), form, setForm: () => undefined, patchForm });

    expect(output.primaryAction?.label).toBe("File to SharePoint");
    await output.primaryAction?.onClick();

    expect(form.filed).toBe(false);
    expect(form.filing).toBe(false);
    expect(form.filingError).toBe("Receipt folder access denied");
  });

  it("clears a selected SharePoint folder when the receipt job changes", async () => {
    const user = userEvent.setup();
    const onFileDocument = vi.fn().mockResolvedValue(undefined);

    render(
      <DocumentPanel
        record={makeReceipt()}
        spec={createReceiptDocumentSpec({
          onFileDocument,
          onUpdateDocument: vi.fn().mockResolvedValue(undefined),
          destinations: SEEDED_DESTINATIONS,
          codingOptions: SEEDED_CODING_OPTIONS,
        })}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Expense category"), "5300");
    await user.click(screen.getByRole("button", { name: "Choose SharePoint folder" }));
    expect(screen.getByRole("button", { name: "File to SharePoint" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Job 26-434" }));
    expect(screen.queryByRole("button", { name: "File to SharePoint" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "File to Job Cost" }));

    await waitFor(() => expect(onFileDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: "receipt-1234" }),
    ));
    expect(onFileDocument).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ destinationAbsolute: expect.anything() }),
    );
  });

  it("serializes a receipt job update and restores the exact prior job and SharePoint selection after a synchronous rejection", async () => {
    const user = userEvent.setup();
    const onUpdateDocument = vi.fn(() => { throw new Error("Receipt job was rejected"); });

    render(
      <DocumentPanel
        record={makeReceipt()}
        spec={createReceiptDocumentSpec({
          onFileDocument: vi.fn(),
          onUpdateDocument,
          destinations: SEEDED_DESTINATIONS,
          codingOptions: SEEDED_CODING_OPTIONS,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Choose SharePoint folder" }));
    expect(screen.getByRole("button", { name: "File to SharePoint" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Job 26-434" }));

    await waitFor(() => expect(onUpdateDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: "receipt-1234" }),
      { jobNumber: "26-999" },
    ));
    expect(onUpdateDocument).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "File to SharePoint" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Job 26-434" })).toBeEnabled();
  });

  it("keeps receipt filing suggestion locked without server edit permission", () => {
    render(<DocumentPanel record={makeReceiptWithServerFiling()} spec={createReceiptDocumentSpec({ destinations: SEEDED_DESTINATIONS })} />);

    expect(screen.getByLabelText("File name")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("File name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
  });

  it("confirms the current candidate when refiling a receipt with a historical SharePoint name", async () => {
    const onFileToProject = vi.fn().mockResolvedValue({ sharePoint: { uploaded: true } });
    const historical = {
      ...makeReceiptWithServerFiling(),
      filed: true,
      sharePointFilename: "RCT historical uploaded.pdf",
    };
    const spec = createReceiptDocumentSpec({ onFileToProject, destinations: SEEDED_DESTINATIONS });
    render(<DocumentPanel record={historical} spec={spec} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "File to Project" }));

    expect(onFileToProject).toHaveBeenCalledWith(
      historical,
      expect.not.objectContaining({ filename: expect.any(String) }),
    );
  });

  it("prefers the saved job number over the extracted receipt reference on reload", () => {
    const receipt = makeReceipt();
    receipt.extracted = {
      ...receipt.extracted!,
      jobRef: "26-434",
      jobNumber: "26-999",
    };

    render(
      <DocumentPanel
        record={receipt}
        spec={createReceiptDocumentSpec({
          onFileDocument: vi.fn(),
          onUpdateDocument: vi.fn(),
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Job 26-999" })).toBeInTheDocument();
  });

  it("stacks the receipt fields like the statement detail panel", () => {
    render(
      <DocumentPanel
        record={makeReceipt()}
        spec={createReceiptDocumentSpec({ onUpdateDocument: vi.fn(), codingOptions: SEEDED_CODING_OPTIONS })}
      />,
    );

    const merchantField = screen.getByLabelText("Merchant").closest('[data-testid="field"]');
    const purchaseDateField = screen.getByLabelText("Purchase date").closest('[data-testid="field"]');
    const totalField = screen.getByLabelText("Total").closest('[data-testid="field"]');

    expect(merchantField?.parentElement).toHaveClass("space-y-3");
    expect(purchaseDateField?.parentElement).toHaveClass("grid", "gap-3", "sm:grid-cols-2");
    expect(totalField?.parentElement).toBe(purchaseDateField?.parentElement);
    expect(screen.getByLabelText("Cost type")).toHaveClass("bg-transparent", "text-foreground");
  });

  it("persists a changed expense category / phase / cost type via the update payload", async () => {
    const user = userEvent.setup();
    const onUpdateDocument = vi.fn().mockResolvedValue(undefined);

    render(
      <DocumentPanel
        record={makeReceipt()}
        spec={createReceiptDocumentSpec({ onUpdateDocument, codingOptions: SEEDED_CODING_OPTIONS })}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Expense category"), "5300");
    await waitFor(() => {
      expect(onUpdateDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: "receipt-1234" }),
        expect.objectContaining({ glAccount: "5300" }),
      );
    });

    await user.selectOptions(screen.getByLabelText("Phase code"), "01000");
    await waitFor(() => {
      expect(onUpdateDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: "receipt-1234" }),
        expect.objectContaining({ phaseCode: "01000" }),
      );
    });

    await user.selectOptions(screen.getByLabelText("Cost type"), "E");
    await waitFor(() => {
      expect(onUpdateDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: "receipt-1234" }),
        expect.objectContaining({ costType: "E" }),
      );
    });
  });

  it("preserves a newer merchant draft when an older save resolves and applies only the latest canonical response", async () => {
    const user = userEvent.setup();
    const first = deferred<Invoice>();
    const second = deferred<Invoice>();
    const onUpdateDocument = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    render(
      <DocumentPanel
        record={makeReceipt()}
        spec={createReceiptDocumentSpec({ onUpdateDocument, codingOptions: SEEDED_CODING_OPTIONS })}
      />,
    );

    const merchant = screen.getByLabelText("Merchant");
    await user.clear(merchant);
    await user.type(merchant, "Merchant A");
    await waitFor(() => expect(onUpdateDocument).toHaveBeenCalledTimes(1));

    await user.clear(merchant);
    await user.type(merchant, "Merchant B");
    await act(async () => {
      first.resolve({
        ...makeReceipt(),
        extracted: { ...makeReceipt().extracted!, vendorName: "Canonical Merchant A" },
      });
    });

    expect(merchant).toHaveValue("Merchant B");
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    await waitFor(() => expect(onUpdateDocument).toHaveBeenCalledTimes(2));

    await act(async () => {
      second.resolve({
        ...makeReceipt(),
        extracted: { ...makeReceipt().extracted!, vendorName: "Canonical Merchant B" },
      });
    });

    await waitFor(() => expect(merchant).toHaveValue("Canonical Merchant B"));
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("loads persisted coding back into the selects on reload", () => {
    const receipt = Object.assign(makeReceipt(), {
      gl_account: "5300",
      phase_code: "01000",
      cost_type: "E",
    });

    render(
      <DocumentPanel
        record={receipt}
        spec={createReceiptDocumentSpec({ onUpdateDocument: vi.fn(), codingOptions: SEEDED_CODING_OPTIONS })}
      />,
    );

    expect(screen.getByLabelText("Expense category")).toHaveValue("5300");
    expect(screen.getByLabelText("Phase code")).toHaveValue("01000");
    expect(screen.getByLabelText("Cost type")).toHaveValue("E");
  });

  it("uses invoice field markers for required, optional, and server-confirmed manual receipt values", async () => {
    const user = userEvent.setup();
    const receipt = {
      ...makeReceipt(),
      fieldOrigins: {
        vendorName: { origin: "manual" as const, at: "2026-09-12T12:00:00Z", by: "synthetic@example.test" },
      },
    };

    render(
      <DocumentPanel
        record={receipt}
        spec={createReceiptDocumentSpec({
          onUpdateDocument: vi.fn().mockResolvedValue(undefined),
          codingOptions: SEEDED_CODING_OPTIONS,
        })}
      />,
    );

    expect(screen.getByLabelText("Merchant")).toHaveClass("border-l-tone-violet", "border-l-[3px]");
    expect(screen.getByLabelText("Expense category")).toHaveClass("border-l-tone-amber", "border-l-[3px]");
    expect(screen.getByLabelText("Phase code")).toHaveClass("border-l-muted-foreground", "border-l-[3px]");

    await user.selectOptions(screen.getByLabelText("Expense category"), "5300");
    expect(screen.getByLabelText("Expense category")).toHaveClass("border-l-tone-violet", "border-l-[3px]");
  });

  it("preserves approved-record locks while leaving server-supported date and coding controls editable", () => {
    const receipt = { ...makeReceipt(), status: "approved" as const };
    render(
      <DocumentPanel
        record={receipt}
        spec={createReceiptDocumentSpec({
          onUpdateDocument: vi.fn(),
          codingOptions: SEEDED_CODING_OPTIONS,
        })}
      />,
    );

    expect(screen.getByLabelText("Merchant")).toBeDisabled();
    expect(screen.getByLabelText("Total")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Job 26-434" })).toBeDisabled();
    expect(screen.getByLabelText("Purchase date")).toBeEnabled();
    expect(screen.getByLabelText("Expense category")).toBeEnabled();
    expect(screen.getByLabelText("Phase code")).toBeEnabled();
    expect(screen.getByLabelText("Cost type")).toBeEnabled();
  });

  it("keeps the suggested filename and literal error when an older server returns stale-preview conflict", async () => {
    const user = userEvent.setup();
    const onFileToProject = vi.fn().mockRejectedValueOnce({
      status: 409,
      code: "FILING_FILENAME_STALE",
      message: "Filing filename preview is stale.",
      details: { filing: { fileName: { value: "RCT Home Depot refreshed.pdf", provenance: "computed" } } },
    });

    render(
      <DocumentPanel
        record={makeReceiptWithServerFiling()}
        spec={createReceiptDocumentSpec({
          onFileDocument: vi.fn(),
          onFileToProject,
          destinations: SEEDED_DESTINATIONS,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "File to Project" }));
    await waitFor(() => {
      expect(screen.getByText("Filing error — Filing filename preview is stale.")).toBeInTheDocument();
      expect(screen.getByLabelText("File name")).toHaveValue("RCT Home Depot server candidate.pdf");
    });
    expect(onFileToProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: "receipt-1234" }),
      expect.not.objectContaining({ filename: expect.anything() }),
    );
  });

  it.each([403, 422])("keeps the literal %i filing refusal visible", async (status) => {
    const user = userEvent.setup();
    const message = `Receipt filing ${status} refusal from server`;
    const onFileToProject = vi.fn().mockRejectedValueOnce({ status, message });
    render(
      <DocumentPanel
        record={makeReceiptWithServerFiling()}
        spec={createReceiptDocumentSpec({ onFileDocument: vi.fn(), onFileToProject, destinations: SEEDED_DESTINATIONS })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "File to Project" }));
    await waitFor(() => expect(screen.getByText(`Filing error — ${message}`)).toBeInTheDocument());
    // Blockers keep their navigation and never become dismissible [fix-2].
    expect(screen.getByRole("button", { name: "Review details" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });
});
