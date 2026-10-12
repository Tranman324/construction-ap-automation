import { render, screen, waitFor } from "@testing-library/react";
import { Scissors } from "lucide-react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DocumentPanel } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanel";
import { registerFilenameTests } from "./documentFilenameField.testUtils";
import { createLienWaiverDocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/lienWaiverDocumentSpec";
import { makeMutationWrapper } from "@/modules/accounting/modules/invoices/hooks/mutations.testUtils";
import { SEEDED_DESTINATIONS } from "@/modules/accounting/modules/invoices/lib/destinationsFixture";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

interface MockPairingProps {
  linkedInvoiceId: string | null;
  onLinkedInvoiceChange: (value: string | null) => void;
  onCandidatesEmptyChange?: (empty: boolean) => void;
}

vi.mock("@/modules/accounting/modules/invoices/components/documents/LienWaiverPairingPanel", () => ({
  LienWaiverPairingPanel: ({ linkedInvoiceId, onLinkedInvoiceChange, onCandidatesEmptyChange }: MockPairingProps) => (
    <div>
      <span>{linkedInvoiceId ? `Mock paired ${linkedInvoiceId}` : "Mock unpaired"}</span>
      <button type="button" onClick={() => onLinkedInvoiceChange("invoice-2")}>Mock pair</button>
      <button type="button" onClick={() => onCandidatesEmptyChange?.(true)}>Mock no candidates</button>
      <button type="button" onClick={() => onCandidatesEmptyChange?.(false)}>Mock candidates returned</button>
    </div>
  ),
}));

vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const JOB_FOLDER = "24-000/24-017 - North Tower";

vi.mock("@/modules/shared/lib/api", () => ({
  api: {
    get: vi.fn((url: string, params?: Record<string, unknown>) => {
      if (url.includes("/api/jobs/sharepoint/folders")) {
        const path = (params?.path as string) ?? "";
        const responses: Record<string, Array<{ id: string; name: string; hasChildren: null }>> = {
          [JOB_FOLDER]: [
            { id: "c1", name: "02 Financials", hasChildren: null },
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

function makeWaiver(linkedInvoiceId: string | null = null): Invoice {
  return {
    id: "waiver-1",
    classification: "lien-waiver",
    confidence: 0.91,
    file: "conditional-waiver.pdf",
    email: {
      from: "apex@example.com",
      subject: "Conditional waiver through May",
      receivedAt: "2026-06-14T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-06-14T12:00:00.000Z",
    extracted: {
      vendorName: "Apex Concrete",
      vendorAddress: null,
      invoiceNumber: "LW-100",
      invoiceDate: "2026-05-31",
      dueDate: null,
      amount: 2400,
      jobNumber: "24-017",
      projectName: "North Tower",
      description: null,
      lineItems: [],
    },
    matching: {
      vendor: { vendorCode: "V100", vendorName: "Apex Concrete", confidence: 0.95, method: "name" },
      job: { jobNumber: "24-017", confidence: 0.9, method: "subject", jobDescription: "North Tower" },
      subcontract: null,
      sourceInvoiceTotal: null,
    },
    overallConfidence: 0.91,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    linkedLienWaiverId: linkedInvoiceId,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function waiverWithEdits(vendorCode: string, jobNumber: string, invoiceDate: string, amount: number): Invoice {
  const record = makeWaiver();
  return {
    ...record,
    extracted: { ...record.extracted!, invoiceDate, amount, jobNumber },
    matching: {
      ...record.matching!,
      vendor: { ...record.matching!.vendor!, vendorCode },
      job: { ...record.matching!.job!, jobNumber },
    },
  };
}

registerFilenameTests(() => makeWaiver("invoice-1"), (onFileToProject) => createLienWaiverDocumentSpec({ onFileToProject, destinations: SEEDED_DESTINATIONS }));

describe("createLienWaiverDocumentSpec", () => {
  it("locks filename editing when an upload is externally pending", () => {
    const record = makeWaiver("invoice-1");
    record.filing = { fileName: { value: "Canonical.pdf", provenance: "computed", permittedActions: ["edit"], blockers: [] } };
    const { Wrapper } = makeMutationWrapper();
    render(<DocumentPanel record={record} spec={createLienWaiverDocumentSpec({ fileToProjectPending: true })} />, { wrapper: Wrapper });
    expect(screen.getByRole("textbox", { name: "File name" })).toBeDisabled();
  });
  it("never adds filename or upload metadata to plain waiver shelving", async () => {
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    const { Wrapper } = makeMutationWrapper();
    const record = makeWaiver();
    record.filing = { fileName: { value: "Canonical.pdf", provenance: "computed", permittedActions: ["edit"], blockers: [] } };
    render(<DocumentPanel record={record} spec={createLienWaiverDocumentSpec({ onFileDocument, destinations: SEEDED_DESTINATIONS })} />, { wrapper: Wrapper });
    await userEvent.type(screen.getByRole("textbox", { name: "File name" }), " override");
    await userEvent.click(screen.getByRole("button", { name: "File to Documents" }));
    await waitFor(() => expect(onFileDocument).toHaveBeenCalledWith(record, { holdReason: undefined }));
  });

  it("preserves an explicitly selected Projects root when filing a paired waiver", async () => {
    const onFileToProject = vi.fn().mockResolvedValue(undefined);
    const record = makeWaiver("invoice-2");
    const spec = createLienWaiverDocumentSpec({ onFileToProject, destinations: SEEDED_DESTINATIONS });
    let form = { ...spec.initForm(record), destinationAbsolute: "" };
    const patchForm = (patch: Partial<typeof form>) => { form = { ...form, ...patch }; };
    const output = spec.build({ record, form, setForm: () => undefined, patchForm });

    expect(output.primaryAction?.label).toBe("File to SharePoint");
    await output.primaryAction?.onClick();

    expect(onFileToProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: "waiver-1" }),
      expect.objectContaining({ destinationAbsolute: "", uploadToSharePoint: true }),
    );
  });

  it("renders the served multi-waiver bundle guidance with the existing split action", async () => {
    const user = userEvent.setup();
    const onSplit = vi.fn();
    const splitDocumentAction = { id: "split-document", label: "Split Document", icon: Scissors, onClick: onSplit };
    const { Wrapper } = makeMutationWrapper();

    render(
      <DocumentPanel
        record={{ ...makeWaiver(), waiverAutoLinkSkipReason: "multi-waiver-bundle" }}
        spec={createLienWaiverDocumentSpec({ splitDocumentAction, destinations: SEEDED_DESTINATIONS })}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("This PDF looks like a bundle of multiple waivers (>2 pages), so auto-link was skipped. Split it first, then link each waiver.")).toBeInTheDocument();
    const splitButton = screen.getByRole("button", { name: "Split Document" });
    expect(splitButton.querySelector("svg")).toHaveClass("lucide-scissors");
    await user.click(splitButton);
    expect(onSplit).toHaveBeenCalledTimes(1);
  });

  it("does not render bundle guidance for absent or non-matching served reasons", () => {
    const { Wrapper } = makeMutationWrapper();
    const splitDocumentAction = { id: "split-document", label: "Split Document", icon: Scissors, onClick: vi.fn() };

    const { rerender } = render(
      <DocumentPanel
        record={{ ...makeWaiver(), waiverAutoLinkSkipReason: null }}
        spec={createLienWaiverDocumentSpec({ splitDocumentAction, destinations: SEEDED_DESTINATIONS })}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.queryByText(/bundle of multiple waivers/)).not.toBeInTheDocument();

    rerender(
      <DocumentPanel
        record={{ ...makeWaiver(), waiverAutoLinkSkipReason: "legacy-reason" } as unknown as Invoice}
        spec={createLienWaiverDocumentSpec({ splitDocumentAction, destinations: SEEDED_DESTINATIONS })}
      />,
    );
    expect(screen.queryByText(/bundle of multiple waivers/)).not.toBeInTheDocument();
  });

  it("uses one continuous details flow without a duplicate local tab or checklist", () => {
    const spec = createLienWaiverDocumentSpec();
    const output = spec.build({
      record: makeWaiver(),
      form: spec.initForm(makeWaiver()),
      setForm: vi.fn(),
      patchForm: vi.fn(),
    });

    expect(output.preferredRenderer).toBe("scroll");
    expect(output.tabs).toBeUndefined();
    expect(output.checklist).toEqual([]);
    expect(output.sections.map((section) => section.id)).toEqual(["details", "pairing", "destination"]);
  });

  it("renders the served Held state as neutral and removes the unresolved pair card", () => {
    const record = { ...makeWaiver(), filingStatus: "shelved" } as Invoice;
    const spec = createLienWaiverDocumentSpec({ onFileDocument: vi.fn(), destinations: SEEDED_DESTINATIONS });
    const output = spec.build({ record, form: spec.initForm(record), setForm: vi.fn(), patchForm: vi.fn() });

    expect(output.header).toMatchObject({ statusLabel: "Held", statusTone: "neutral" });
    expect(output.alerts?.some((alert) => alert.id === "unpaired")).toBe(false);
    expect(output.primaryAction).toMatchObject({ label: "Held in Documents", disabled: true });
  });

  it("renders a single unresolved source with the reference hold action", () => {
    const { Wrapper } = makeMutationWrapper();

    render(
      <DocumentPanel
        record={makeWaiver()}
        spec={createLienWaiverDocumentSpec({ destinations: SEEDED_DESTINATIONS })}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getAllByText(/^No invoice paired — /)).toHaveLength(1);
    expect(screen.getByText(/Pair the invoice it releases below/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hold on shelf" })).toBeDisabled();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("enriches the single unpaired row when candidates are empty and retains its hold action", async () => {
    const user = userEvent.setup();
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    const { Wrapper } = makeMutationWrapper();
    render(<DocumentPanel record={makeWaiver()} spec={createLienWaiverDocumentSpec({ onFileDocument, destinations: SEEDED_DESTINATIONS })} />, { wrapper: Wrapper });
    await user.click(screen.getByRole("button", { name: "Mock no candidates" }));
    expect(screen.getAllByText(/^No invoice paired — /)).toHaveLength(1);
    expect(screen.getAllByText(/No unlinked invoices are available/)).toHaveLength(1);
    expect(screen.getByTestId("document-resolve-tray").querySelector('[data-panel-notice="waiver-candidates-empty"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Hold on shelf" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Mock candidates returned" }));
    expect(screen.queryByText(/No unlinked invoices are available/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hold on shelf" }));
    expect(onFileDocument).toHaveBeenCalledWith(expect.objectContaining({ id: "waiver-1" }), { holdReason: undefined });
  });

  it("renders prefilled editable waiver controls", () => {
    const { Wrapper } = makeMutationWrapper();

    render(
      <DocumentPanel
        record={makeWaiver()}
        spec={createLienWaiverDocumentSpec({ destinations: SEEDED_DESTINATIONS })}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Lien Waiver")).toBeInTheDocument();
    expect(screen.getByText("Unpaired")).toBeInTheDocument();
    expect(screen.getByText("Waiver Details")).toBeInTheDocument();
    expect(screen.getByText("Pair to Invoice")).toBeInTheDocument();
    expect(screen.getByText("File To")).toBeInTheDocument();
    expect(screen.getAllByText("02 Financials / Lien Waivers").length).toBeGreaterThan(0);
    const scrollFlow = screen.getByText("Waiver Details").closest("div.min-h-0.flex-1");
    expect(scrollFlow).toHaveClass("space-y-[18px]", "px-6", "py-[22px]");

    expect(screen.getByRole("combobox", { name: /V100/ })).toHaveTextContent("V100");
    expect(screen.getByRole("combobox", { name: /24-017/ })).toHaveTextContent("24-017");
    expect(screen.getByLabelText("Through date")).toHaveValue("2026-05-31");
    expect(screen.getByLabelText("Amount")).toHaveValue("2400");
    expect(screen.getByLabelText("Waiver type")).toBeInTheDocument();
  });

  it("roundtrips claimant, job, through date, and amount through the existing save contract", async () => {
    const record = makeWaiver();
    const canonical = waiverWithEdits("V200", "24-020", "2026-06-30", 2750);
    const onUpdateDocument = vi.fn().mockResolvedValue(canonical);
    const spec = createLienWaiverDocumentSpec({ onUpdateDocument });
    let form: ReturnType<typeof spec.initForm> = {
      ...spec.initForm(record),
      vendorCode: "V200",
      jobNumber: "24-020",
      throughDate: "2026-06-30",
      amountInput: "2750",
    };

    await spec.flushPendingChanges?.({
      record,
      form,
      setForm: vi.fn(),
      patchForm: (patch) => { form = { ...form, ...patch }; },
    });

    expect(onUpdateDocument).toHaveBeenCalledWith(record, {
      vendorCode: "V200",
      jobNumber: "24-020",
      amount: 2750,
      invoiceDate: "2026-06-30",
    });
    expect(form).toMatchObject({
      savedVendorCode: "V200",
      savedJobNumber: "24-020",
      savedAmountInput: "2750",
      savedThroughDate: "2026-06-30",
      linkedInvoiceId: null,
      saveError: null,
    });
  });

  it("keeps an invalid blank amount pending while saving other valid waiver edits", async () => {
    const record = makeWaiver("invoice-2");
    const onUpdateDocument = vi.fn().mockResolvedValue(waiverWithEdits("V100", "24-020", "2026-05-31", 2400));
    const spec = createLienWaiverDocumentSpec({ onUpdateDocument });
    let form: ReturnType<typeof spec.initForm> = { ...spec.initForm(record), amountInput: "", jobNumber: "24-020" };

    await spec.flushPendingChanges?.({ record, form, setForm: vi.fn(), patchForm: (patch) => { form = { ...form, ...patch }; } });

    expect(onUpdateDocument).toHaveBeenCalledWith(record, { jobNumber: "24-020" });
    expect(form.savedJobNumber).toBe("24-020");
    expect(form.savedAmountInput).toBe("2400");
    expect(form.amountInput).toBe("");
    expect(form.saveError).toMatch(/valid numeric amount/);
    expect(form.linkedInvoiceId).toBe("invoice-2");
  });

  it("ignores a stale concurrent waiver save result and preserves the latest saved snapshot", async () => {
    const record = makeWaiver();
    const first = deferred<Invoice>();
    const second = deferred<Invoice>();
    const onUpdateDocument = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const spec = createLienWaiverDocumentSpec({ onUpdateDocument });
    let firstForm: ReturnType<typeof spec.initForm> = { ...spec.initForm(record), jobNumber: "24-018" };
    let secondForm: ReturnType<typeof spec.initForm> = { ...spec.initForm(record), jobNumber: "24-019" };

    const firstSave = spec.flushPendingChanges?.({ record, form: firstForm, setForm: vi.fn(), patchForm: (patch) => { firstForm = { ...firstForm, ...patch }; } });
    const secondSave = spec.flushPendingChanges?.({ record, form: secondForm, setForm: vi.fn(), patchForm: (patch) => { secondForm = { ...secondForm, ...patch }; } });
    second.resolve(waiverWithEdits("V100", "24-019", "2026-05-31", 2400));
    await secondSave;
    first.resolve(waiverWithEdits("V100", "24-018", "2026-05-31", 2400));
    await firstSave;

    expect(secondForm.savedJobNumber).toBe("24-019");
    expect(firstForm.savedJobNumber).toBe("24-017");
  });

  it("keeps deferred waiver saves independent across two documents", async () => {
    const first = deferred<Invoice>();
    const second = deferred<Invoice>();
    const firstRecord = makeWaiver();
    const secondRecord = { ...makeWaiver(), id: "waiver-2", file: "waiver-2.pdf" };
    const onUpdateDocument = vi.fn((record: Invoice) => record.id === firstRecord.id ? first.promise : second.promise);
    const spec = createLienWaiverDocumentSpec({ onUpdateDocument });
    let firstForm: ReturnType<typeof spec.initForm> = { ...spec.initForm(firstRecord), jobNumber: "24-018" };
    let secondForm: ReturnType<typeof spec.initForm> = { ...spec.initForm(secondRecord), jobNumber: "24-019" };

    const firstSave = spec.flushPendingChanges?.({ record: firstRecord, form: firstForm, setForm: vi.fn(), patchForm: (patch) => { firstForm = { ...firstForm, ...patch }; } });
    const secondSave = spec.flushPendingChanges?.({ record: secondRecord, form: secondForm, setForm: vi.fn(), patchForm: (patch) => { secondForm = { ...secondForm, ...patch }; } });
    second.resolve({ ...waiverWithEdits("V100", "24-019", "2026-05-31", 2400), id: secondRecord.id });
    await secondSave;
    first.resolve(waiverWithEdits("V100", "24-018", "2026-05-31", 2400));
    await firstSave;

    expect(firstForm.savedJobNumber).toBe("24-018");
    expect(secondForm.savedJobNumber).toBe("24-019");
  });

  it("keeps waiver drafts and pairing intact when save fails", async () => {
    const record = makeWaiver("invoice-2");
    const spec = createLienWaiverDocumentSpec({ onUpdateDocument: vi.fn().mockRejectedValue(new Error("Save refused")) });
    let form = { ...spec.initForm(record), throughDate: "2026-06-30" };
    await spec.flushPendingChanges?.({ record, form, setForm: vi.fn(), patchForm: (patch) => { form = { ...form, ...patch }; } });
    expect(form.throughDate).toBe("2026-06-30");
    expect(form.savedThroughDate).toBe("2026-05-31");
    expect(form.linkedInvoiceId).toBe("invoice-2");
    expect(form.saveError).toBe("Save refused");
  });

  it("holds an unpaired waiver and lets the destination picker select a folder", async () => {
    const user = userEvent.setup();
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    const { Wrapper } = makeMutationWrapper();

    render(
      <DocumentPanel
        record={makeWaiver()}
        spec={createLienWaiverDocumentSpec({ onFileDocument, destinations: SEEDED_DESTINATIONS })}
      />,
      { wrapper: Wrapper },
    );

    await user.click(screen.getByRole("button", { name: "Browse" }));
    await user.click(await screen.findByRole("button", { name: "Open 04 Closeout" }));
    await user.click(await screen.findByRole("button", { name: "Open Warranties" }));
    await user.click(screen.getByRole("button", { name: "Save to this folder" }));
    expect(screen.getAllByText("04 Closeout / Warranties").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "File to Documents" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hold on shelf" }));

    await waitFor(() => {
      expect(onFileDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: "waiver-1" }),
        { holdReason: undefined },
      );
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Held in Documents" })).toBeDisabled());
  });

  it("keeps the unpaired File action available despite the tray-only pairing alert", async () => {
    const user = userEvent.setup();
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    const { Wrapper } = makeMutationWrapper();

    render(
      <DocumentPanel
        record={makeWaiver()}
        spec={createLienWaiverDocumentSpec({ onFileDocument, destinations: SEEDED_DESTINATIONS })}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Unpaired")).toBeInTheDocument();
    expect(screen.getAllByText(/^No invoice paired — /)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "File to Documents" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "File to Documents" }));

    await waitFor(() => {
      expect(onFileDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: "waiver-1" }),
        expect.objectContaining({ holdReason: undefined }),
      );
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Held in Documents" })).toBeDisabled());
  });

  it("files and releases a paired waiver through the document filing callback", async () => {
    const user = userEvent.setup();
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    const onFileToProject = vi.fn().mockResolvedValue(undefined);
    const { Wrapper } = makeMutationWrapper();

    render(
      <DocumentPanel
        record={makeWaiver("invoice-2")}
        spec={createLienWaiverDocumentSpec({ onFileDocument, onFileToProject, destinations: SEEDED_DESTINATIONS })}
      />,
      { wrapper: Wrapper },
	    );

	    expect(screen.getByText("Paired")).toBeInTheDocument();
      expect(screen.queryByText(/^No invoice paired/)).not.toBeInTheDocument();
	    expect(screen.getByRole("button", { name: "Pair & File" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Browse" }));
      await user.click(await screen.findByRole("button", { name: "Open 04 Closeout" }));
      await user.click(await screen.findByRole("button", { name: "Open Warranties" }));
      await user.click(screen.getByRole("button", { name: "Save to this folder" }));
      expect(screen.queryByRole("button", { name: "Pair & File" })).not.toBeInTheDocument();
	    await user.click(screen.getByRole("button", { name: "File to SharePoint" }));

    await waitFor(() => {
      expect(onFileToProject).toHaveBeenCalledWith(
        expect.objectContaining({ id: "waiver-1" }),
        expect.objectContaining({
          destination: "04 Closeout / Warranties",
          destinationAbsolute: `${JOB_FOLDER}/04 Closeout/Warranties`,
          uploadToSharePoint: true,
        }),
      );
    });
    expect(onFileDocument).not.toHaveBeenCalled();
  });
});
