import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { DocumentPanel } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanel";
import { PanelNoticeOutlet, PanelNoticeProvider } from "./PanelNotice";
import { createCoiDocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/coiDocumentSpec";
import { runDocumentStubActionWithToast } from "@/modules/accounting/modules/invoices/lib/documentStubActions";
import type { CoiComplianceResult, UpdateCoiManualValuesResponse, UploadCoiToSpectrumResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/modules/accounting/modules/invoices/lib/documentStubActions", () => {
  class DocumentStubActionError extends Error {}
  return {
    DocumentStubActionError,
    runDocumentStubActionWithToast: vi.fn(),
  };
});

vi.mock("@/modules/accounting/modules/invoices/components/invoices/dropdowns/VendorDropdown", () => ({
  VendorDropdown: ({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) => (
    <><button type="button" onClick={() => onChange("V200")}>Vendor {value ?? "none"}</button><button type="button" onClick={() => onChange(null)}>Clear vendor</button></>
  ),
}));

const runStubAction = vi.mocked(runDocumentStubActionWithToast);
const toastSuccess = vi.mocked(toast.success);
const toastError = vi.mocked(toast.error);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

interface ToastAction {
  label: string;
  onClick: () => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function isToastAction(value: unknown): value is ToastAction {
  return (
    typeof value === "object" &&
    value !== null &&
    "label" in value &&
    "onClick" in value &&
    typeof value.label === "string" &&
    typeof value.onClick === "function"
  );
}

function getVendorPicker() {
  const picker = screen.getAllByRole("button")
    .find((button) => button.textContent?.trim().startsWith("Vendor"));
  expect(picker).toBeDefined();
  return picker!;
}

function makeCompliance(overrides: Partial<CoiComplianceResult> = {}): CoiComplianceResult {
  return {
    verdict: "compliant", evaluatedAt: "2026-07-30T12:00:00.000Z", configVersion: "2026-07-30", configVersionId: "v1",
    checks: [{ id: "additional-insured", label: "Additional insured endorsement present", rawStatus: "fail", effectiveStatus: "pass", provenance: "override", detail: "Approved by the server.", required: true }],
    coverageFailures: [], coverageExceptions: [], expiration: { value: { state: "active", expirationDate: "2027-06-30", daysRemaining: 335 }, provenance: "extracted", permittedActions: [], blockers: [] },
    vendorCode: { value: "RS100", provenance: "matched", permittedActions: [], blockers: [] }, blockers: [], uploadReady: true,
    ...overrides,
  };
}

function makeManualValuesResponse(compliance: CoiComplianceResult): UpdateCoiManualValuesResponse {
  return { manualValues: {}, compliance };
}

function makeCoi(): Invoice {
  return {
    id: "coi-200",
    classification: "coi",
    confidence: 0.72,
    file: "coi-200.pdf",
    email: {
      from: "broker@example.com",
      subject: "Ridge Steel COI",
      receivedAt: "2026-06-15T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-06-15T12:00:00.000Z",
    extracted: {
      vendorName: "Ridge Steel",
      vendorAddress: null,
      invoiceNumber: null,
      invoiceDate: "2026-06-10T12:00:00.000Z",
      dueDate: null,
      amount: null,
      jobNumber: null,
      projectName: null,
      description: null,
      lineItems: [],
    },
    matching: {
      vendor: { vendorCode: "RS100", vendorName: "Ridge Steel", confidence: 0.91, method: "document" },
      job: null,
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
    coiData: {
      coverageLines: [
        {
          type: "general-liability",
          carrier: "Travelers Casualty",
          policyNumber: "GL-12345",
          expirationDate: "2027-06-30",
          limits: {
            eachOccurrence: 1000000,
            generalAggregate: 2000000,
            productsCompOps: 2000000,
            damageToRented: 50000,
            medicalExpense: 3000,
            personalAdvInjury: 1000000,
          },
        },
        {
          type: "workers-comp",
          carrier: "Travelers Casualty",
          policyNumber: "WC-12345",
          expirationDate: "2027-06-30",
          limits: {
            eachAccident: 1000000,
            diseaseEachEmployee: 1000000,
            diseasePolicyLimit: 1000000,
          },
        },
      ],
      endorsements: {
        additionalInsured: false,
        additionalInsuredForms: [],
        waiverOfSubrogation: true,
        primaryNoncontributory: true,
        completedOperations: false,
      },
      holder: {
        name: "Northwind Construction Grp",
        address: "500 Spectrum Way",
      },
      cancellationNoticeDays: 30,
    },
    coiOverrides: ["additional-insured", "coverage-minimums", "certificate-holder"].map((checkId) => ({
      id: `persisted-${checkId}`,
      documentId: "coi-200",
      checkId,
      originalStatus: "warn" as const,
      reason: null,
      configVersionId: "v1",
      approvedBy: "reviewer@example.com",
      approvedAt: "2026-07-01T00:00:00.000Z",
      revokedBy: null,
      revokedAt: null,
    })),
    compliance: makeCompliance(),
  };
}

function makeQueuedResponse(overrides: Partial<UploadCoiToSpectrumResponse> = {}): UploadCoiToSpectrumResponse {
  return {
    status: "queued",
    documentId: "coi-200",
    vendorCode: "V200",
    expirationDate: "2027-06-30",
    attempt: 1,
    queuePosition: 0,
    message: "Queued.",
    ...overrides,
  };
}

async function makePanelUploadReady(user: ReturnType<typeof userEvent.setup>) {
  await user.click(getVendorPicker());

}

describe("createCoiDocumentSpec", () => {
  it("does not expose a SharePoint filename field even when the server permits editing", () => {
    const record = makeCoi();
    record.filing = { ...record.filing, fileName: { value: "Canonical.pdf", provenance: "computed", permittedActions: ["edit"], blockers: [] } };
    render(<DocumentPanel record={record} spec={createCoiDocumentSpec()} />);
    expect(screen.queryByRole("textbox", { name: "File name" })).not.toBeInTheDocument();
  });

  beforeEach(() => {
    runStubAction.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("renders an explicit unavailable state without a legacy fallback", () => {
    render(
      <DocumentPanel record={{ ...makeCoi(), compliance: undefined }} spec={createCoiDocumentSpec({ onUploadToSpectrum: vi.fn() })} />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Server compliance result is unavailable");
    // No verdict label of any kind, and no compliance/coverage UI.
    expect(screen.queryByText("Compliant")).not.toBeInTheDocument();
    expect(screen.queryByText("Review Required")).not.toBeInTheDocument();
    expect(screen.queryByText("Non-Compliant")).not.toBeInTheDocument();
    expect(screen.queryByText("Coverage Lines")).not.toBeInTheDocument();
    expect(screen.queryByText("COMPLIANCE")).not.toBeInTheDocument();
  });

  it("portals each failing or warning check once and leaves passing records inline", () => {
    const record = {
      ...makeCoi(),
      compliance: makeCompliance({
        verdict: "non-compliant",
        checks: [
          { id: "completed-operations", label: "Completed Operations", rawStatus: "fail", effectiveStatus: "fail", provenance: "computed", detail: "Missing tail.", required: true },
          { id: "named-insured", label: "Named Insured Match", rawStatus: "warn", effectiveStatus: "warn", provenance: "computed", detail: "Name differs.", required: false },
          { id: "holder", label: "Certificate Holder Match", rawStatus: "pass", effectiveStatus: "pass", provenance: "computed", detail: "Matched.", required: true },
        ],
      }),
    };
    const spec = createCoiDocumentSpec();
    const form = spec.initForm(record);
    const output = spec.build({ record, form, setForm: () => undefined, patchForm: () => undefined });
    const alerts = output.alerts ?? [];

    expect(alerts).toEqual([]);
    render(<PanelNoticeProvider documentId={record.id}>
      <div data-testid="inline-checks">{output.sections.find((section) => section.id === "checks")?.children}</div>
      <PanelNoticeOutlet />
    </PanelNoticeProvider>);
    expect(screen.getByTestId("inline-checks")).toContainElement(screen.getByText("Certificate Holder Match"));
    expect(screen.getByTestId("inline-checks")).toContainElement(screen.getByText("Matched."));
    const outlet = screen.getByTestId("panel-notice-outlet");
    expect(Array.from(outlet.querySelectorAll("[data-panel-notice]")).map((node) => node.getAttribute("data-panel-notice"))).toEqual(["coi-check-completed-operations", "coi-check-named-insured"]);
    for (const text of ["Completed Operations", "Missing tail.", "Named Insured Match", "Name differs."]) {
      expect(screen.getAllByText(text)).toHaveLength(1);
      expect(outlet).toContainElement(screen.getByText(text));
    }
  });

  it("keeps parent failure confirmation and inline revoke callbacks intact", async () => {
    const user = userEvent.setup();
    const applyOverride = vi.fn().mockResolvedValue({});
    const revokeOverride = vi.fn().mockResolvedValue({});
    const record = { ...makeCoi(), compliance: makeCompliance({ checks: [
      { ...makeCompliance().checks[0], effectiveStatus: "fail" as const, provenance: "computed" as const },
      { ...makeCompliance().checks[0], id: "approved-check" },
    ] }) };
    const spec = createCoiDocumentSpec({ canOverride: true, onApplyOverride: applyOverride, onRevokeOverride: revokeOverride });
    const output = spec.build({ record, form: spec.initForm(record), setForm: () => undefined, patchForm: () => undefined });
    render(<PanelNoticeProvider documentId={record.id}>
      <div data-testid="inline-checks">{output.sections.find((section) => section.id === "checks")?.children}</div>
      <PanelNoticeOutlet />
    </PanelNoticeProvider>);
    expect(screen.getByTestId("panel-notice-outlet")).toContainElement(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByRole("button", { name: "Confirm override" })).toBeDisabled();
    expect(applyOverride).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Override reason"), "  Verified endorsement  ");
    await user.click(screen.getByRole("button", { name: "Confirm override" }));
    expect(applyOverride).toHaveBeenCalledWith(record, "additional-insured", "Verified endorsement");
    expect(screen.getByTestId("inline-checks")).toContainElement(screen.getByRole("button", { name: "Revoke approval" }));
    await user.click(screen.getByRole("button", { name: "Revoke approval" }));
    expect(revokeOverride).toHaveBeenCalledWith(record, "approved-check");
  });

  it("renders COI sections from persisted checks and queues upload through the route callback", async () => {
    const user = userEvent.setup();
    const onUpdateManualValues = vi.fn().mockResolvedValue(makeManualValuesResponse(makeCompliance()));
    const uploadCoi = vi.fn<(
      record: Invoice,
      payload: { vendorCode: string; expirationDate: string },
    ) => Promise<UploadCoiToSpectrumResponse>>().mockResolvedValue(makeQueuedResponse());

    render(
      <DocumentPanel
        record={makeCoi()}
        spec={createCoiDocumentSpec({ onUploadToSpectrum: uploadCoi, onUpdateManualValues })}
      />,
    );

    expect(screen.getByText("COI")).toBeInTheDocument();
    expect(screen.getByText("Spectrum Submission")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Compliance/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Coverage/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Activity/ })).toBeInTheDocument();
    expect(screen.getByText("Compliance Checks")).toBeInTheDocument();
    expect(screen.getByText("Coverage Lines")).toBeInTheDocument();
    expect(screen.queryByText("Certificate Holder")).not.toBeInTheDocument();
    expect(screen.queryByText("Producer")).not.toBeInTheDocument();
    expect(screen.getAllByText("Compliant").length).toBeGreaterThan(0);
    expect(getVendorPicker()).toHaveTextContent("Vendor RS100");

    const primary = screen.getByRole("button", { name: "Upload to Spectrum" });
    expect(primary).toBeEnabled();

    await user.click(getVendorPicker());
    await waitFor(() => {
      expect(onUpdateManualValues).toHaveBeenCalledWith(
        expect.objectContaining({ id: "coi-200" }),
        { vendorCode: "V200" },
      );
    });
    expect(getVendorPicker()).toHaveTextContent("Vendor RS100");
    expect(getVendorPicker()).not.toHaveTextContent("Vendor V200");

    fireEvent.change(screen.getByLabelText(/^Expiration date/), { target: { value: "2028-01-31" } });
    await waitFor(() => {
      expect(onUpdateManualValues).toHaveBeenCalledWith(
        expect.objectContaining({ id: "coi-200" }),
        { expirationDate: "2028-01-31" },
      );
    });

    await user.click(screen.getByRole("tab", { name: /Coverage/ }));
    await user.click(screen.getByRole("button", { name: "Show limits" }));
    expect(screen.getByText("Medical Expense")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Compliance/ }));
    expect(screen.getByText("Additional insured endorsement present")).toBeInTheDocument();

    expect(screen.getAllByText("Compliant").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Upload to Spectrum" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Upload to Spectrum" }));

    await waitFor(() => {
      expect(uploadCoi).toHaveBeenCalledWith(expect.objectContaining({ id: "coi-200" }), {
        vendorCode: "RS100",
        expirationDate: "2027-06-30",
      });
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Queued to Spectrum" })).toBeDisabled());
    expect(toastSuccess).toHaveBeenCalledWith("COI queued for Spectrum", expect.objectContaining({
      description: expect.stringContaining("accepted for Spectrum upload"),
    }));
    expect(runStubAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("disables the primary action while COI upload is pending", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<UploadCoiToSpectrumResponse>();
    const uploadCoi = vi.fn(() => deferred.promise);

    render(<DocumentPanel record={makeCoi()} spec={createCoiDocumentSpec({ onUploadToSpectrum: uploadCoi })} />);

    await makePanelUploadReady(user);
    await user.click(screen.getByRole("button", { name: "Upload to Spectrum" }));

    expect(screen.getByRole("button", { name: "Upload to Spectrum" })).toBeDisabled();
    deferred.resolve(makeQueuedResponse());
    await waitFor(() => expect(screen.getByRole("button", { name: "Queued to Spectrum" })).toBeDisabled());
  });

  it("shows a persistent upload failure toast with a document deep link", async () => {
    const user = userEvent.setup();
    const onViewDocument = vi.fn();
    const uploadCoi = vi.fn(() => Promise.reject(new Error("Duplicate COI tracking code")));

    render(
      <DocumentPanel
        record={makeCoi()}
        spec={createCoiDocumentSpec({ onUploadToSpectrum: uploadCoi, onViewDocument })}
      />,
    );

    await makePanelUploadReady(user);
    await user.click(screen.getByRole("button", { name: "Upload to Spectrum" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("COI upload failed", expect.objectContaining({
      description: "Duplicate COI tracking code",
      duration: Infinity,
      action: expect.objectContaining({ label: "View document" }),
    })));

    const toastOptions = toastError.mock.calls[0]?.[1];
    expect(isToastAction(toastOptions?.action)).toBe(true);
    if (isToastAction(toastOptions?.action)) {
      toastOptions.action.onClick();
    }
    expect(onViewDocument).toHaveBeenCalledWith(expect.objectContaining({ id: "coi-200" }));
    expect(runStubAction).not.toHaveBeenCalled();
  });

  it("surfaces API error messages from rejected queue requests", async () => {
    const user = userEvent.setup();
    const uploadCoi = vi.fn(() => Promise.reject({
      status: 409,
      message: "Upload already processing",
    }));

    render(
      <DocumentPanel
        record={makeCoi()}
        spec={createCoiDocumentSpec({ onUploadToSpectrum: uploadCoi })}
      />,
    );

    await makePanelUploadReady(user);
    await user.click(screen.getByRole("button", { name: "Upload to Spectrum" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("COI upload failed", expect.objectContaining({
      description: "Upload already processing",
    })));
    expect(screen.getByRole("button", { name: "Upload to Spectrum" })).toBeEnabled();
  });

  it("renders backend COI upload failures from document status fields", () => {
    const friendly = "Spectrum did not respond. Retry in a few minutes.";
    render(
      <DocumentPanel
        record={{ ...makeCoi(), spectrumUploadStatus: "failed", spectrumUploadError: friendly }}
        spec={createCoiDocumentSpec({ onUploadToSpectrum: vi.fn() })}
      />,
    );

    expect(screen.getAllByText("Upload failed").length).toBeGreaterThan(0);
    expect(screen.getAllByText(`Upload failed — ${friendly}`).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Retry Upload" })).toBeEnabled();
  });

  it("reviews an upload failure at the Submission Status section", async () => {
    const user = userEvent.setup();
    const scrolled: HTMLElement[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement) { scrolled.push(this); };
    try {
      render(<DocumentPanel record={{ ...makeCoi(), spectrumUploadStatus: "failed", spectrumUploadError: "Spectrum did not respond." }} spec={createCoiDocumentSpec({ onUploadToSpectrum: vi.fn() })} />);
      await user.click(screen.getByRole("button", { name: "Review details" }));
      expect(scrolled).toEqual([document.querySelector('[data-document-section-id="submission-status"]')]);
      expect(document.activeElement).toHaveTextContent("Submission Status");
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it.each([
    "Credentials not found. Set SPECTRUM_USER/SPECTRUM_PASS env vars or create /etc/toolbox/spectrum.env",
    "JSON-RPC error in openWorkspace: {\"code\":-32000}",
    "Could not extract serialNumber from session page. HTML: <html><body></body></html>",
    "PROIV WebSocket send failed: socket closed",
    "File not found: /home/toolbox/data/coi.pdf",
    "TypeError: x is undefined\n    at uploadCoi (/srv/app/coi-upload.js:12:3)",
  ])("hides stored developer error text behind a plain message: %s", (raw) => {
    const generic = "Spectrum upload failed. Retry; if it fails again, ask an admin to check the Toolbox logs.";
    const { container } = render(
      <DocumentPanel
        record={{ ...makeCoi(), spectrumUploadStatus: "failed", spectrumUploadError: raw }}
        spec={createCoiDocumentSpec({ onUploadToSpectrum: vi.fn() })}
      />,
    );

    expect(screen.getAllByText(`Upload failed — ${generic}`).length).toBeGreaterThan(0);
    const text = container.textContent ?? "";
    expect(text).not.toContain(raw);
    for (const leak of ["SPECTRUM_", "/root/", "/home/", "JSON-RPC", "PROIV", "HTML:"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("guards raw developer text stored in lastSpectrumError too", () => {
    const generic = "Spectrum upload failed. Retry; if it fails again, ask an admin to check the Toolbox logs.";
    render(
      <DocumentPanel
        record={{ ...makeCoi(), spectrumUploadStatus: "failed", lastSpectrumError: "JSON-RPC error in createTab: {}" }}
        spec={createCoiDocumentSpec({ onUploadToSpectrum: vi.fn() })}
      />,
    );

    expect(screen.getAllByText(`Upload failed — ${generic}`).length).toBeGreaterThan(0);
  });

  it("re-enables the Spectrum upload CTA after a backend failure once checks are clear", async () => {
    const user = userEvent.setup();
    const uploadCoi = vi.fn().mockResolvedValue(makeQueuedResponse({ attempt: 2 }));

    render(
      <DocumentPanel
        record={{ ...makeCoi(), spectrumUploadStatus: "failed", spectrumUploadError: "PROIV session timed out" }}
        spec={createCoiDocumentSpec({ onUploadToSpectrum: uploadCoi })}
      />,
    );

    await makePanelUploadReady(user);
    expect(screen.getByRole("button", { name: "Retry Upload" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Retry Upload" }));

    await waitFor(() => {
      expect(uploadCoi).toHaveBeenCalledWith(expect.objectContaining({ id: "coi-200" }), {
        vendorCode: "RS100",
        expirationDate: "2027-06-30",
      });
    });
  });

  it("uses server-restored extracted values after clearing a manual vendor", async () => {
    const user = userEvent.setup();
    const extractedCompliance = makeCompliance({ vendorCode: { value: "EXTRACTED", provenance: "extracted", permittedActions: [], blockers: [] } });
    const onUpdateManualValues = vi.fn().mockResolvedValue(makeManualValuesResponse(extractedCompliance));
    const uploadCoi = vi.fn().mockResolvedValue(makeQueuedResponse());

    render(<DocumentPanel record={makeCoi()} spec={createCoiDocumentSpec({ onUpdateManualValues, onUploadToSpectrum: uploadCoi })} />);

    await user.click(screen.getByRole("button", { name: "Clear vendor" }));
    await waitFor(() => expect(onUpdateManualValues).toHaveBeenCalledWith(expect.objectContaining({ id: "coi-200" }), { vendorCode: null }));
    expect(getVendorPicker()).toHaveTextContent("Vendor EXTRACTED");
    await user.click(screen.getByRole("button", { name: "Upload to Spectrum" }));
    await waitFor(() => expect(uploadCoi).toHaveBeenCalledWith(expect.anything(), { vendorCode: "EXTRACTED", expirationDate: "2027-06-30" }));
  });

  it("reseeds the mounted COI form from refetched server compliance values", async () => {
    const user = userEvent.setup();
    const uploadCoi = vi.fn().mockResolvedValue(makeQueuedResponse());
    const spec = createCoiDocumentSpec({ onUploadToSpectrum: uploadCoi });
    const initial = { ...makeCoi(), compliance: makeCompliance({ vendorCode: { value: "V200", provenance: "manual", permittedActions: [], blockers: [] }, expiration: { value: { state: "active", expirationDate: "2028-01-31", daysRemaining: 550 }, provenance: "manual", permittedActions: [], blockers: [] } }) };
    const refetched = { ...makeCoi(), compliance: makeCompliance() };
    const { rerender } = render(<DocumentPanel record={initial} spec={spec} />);

    expect(getVendorPicker()).toHaveTextContent("Vendor V200");
    rerender(<DocumentPanel record={refetched} spec={spec} />);

    expect(getVendorPicker()).toHaveTextContent("Vendor RS100");
    expect(screen.getByLabelText(/^Expiration date/)).toHaveValue("2027-06-30");
    await user.click(screen.getByRole("button", { name: "Upload to Spectrum" }));
    await waitFor(() => expect(uploadCoi).toHaveBeenCalledWith(expect.anything(), { vendorCode: "RS100", expirationDate: "2027-06-30" }));
  });

  it("renders backend queued and successful Spectrum upload states", () => {
    const { rerender } = render(
      <DocumentPanel
        record={{ ...makeCoi(), spectrumUploadStatus: "queued" }}
        spec={createCoiDocumentSpec({ onUploadToSpectrum: vi.fn() })}
      />,
    );

    expect(screen.getByRole("button", { name: "Queued to Spectrum" })).toBeDisabled();
    expect(screen.getAllByText("Queued in Spectrum").length).toBeGreaterThan(0);

    rerender(
      <DocumentPanel
        record={{ ...makeCoi(), spectrumUploadStatus: "success" }}
        spec={createCoiDocumentSpec({ onUploadToSpectrum: vi.fn() })}
      />,
    );

    expect(screen.getByRole("button", { name: "Uploaded to Spectrum" })).toBeDisabled();
    expect(screen.getAllByText("Uploaded to Spectrum").length).toBeGreaterThan(0);
  });

  it("uses server-returned compliance provenance for override controls", () => {
    const record = makeCoi();
    const { rerender } = render(
      <DocumentPanel record={record} spec={createCoiDocumentSpec({ canOverride: true, onApplyOverride: vi.fn() })} />,
    );
    expect(screen.getAllByRole("button", { name: "Revoke approval" }).length).toBeGreaterThan(0);
    rerender(<DocumentPanel record={{ ...record, compliance: makeCompliance({ checks: [{ ...record.compliance!.checks[0], effectiveStatus: "fail", provenance: "computed" }] }) }} spec={createCoiDocumentSpec({ canOverride: true, onApplyOverride: vi.fn() })} />);
    expect(screen.getAllByRole("button", { name: "Approve" }).length).toBeGreaterThan(0);
  });

  it("requires a non-whitespace reason before overriding a failing check", async () => {
    const user = userEvent.setup();
    const applyOverride = vi.fn().mockResolvedValue({});
    const record = {
      ...makeCoi(),
      coiOverrides: [],
      compliance: makeCompliance({
        checks: [{ ...makeCompliance().checks[0], effectiveStatus: "fail", provenance: "computed" }],
      }),
    };

    render(<DocumentPanel record={record} spec={createCoiDocumentSpec({ canOverride: true, onApplyOverride: applyOverride })} />);

    await user.click(screen.getAllByRole("button", { name: "Approve" })[0]);
    expect(screen.getByRole("dialog", { name: "Override compliance check?" })).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Confirm override" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("Override reason"), "   ");
    expect(confirm).toBeDisabled();
    await user.clear(screen.getByLabelText("Override reason"));
    await user.type(screen.getByLabelText("Override reason"), "Verified with the broker");
    await user.click(confirm);

    await waitFor(() => expect(applyOverride).toHaveBeenCalledWith(
      expect.objectContaining({ id: "coi-200" }),
      "additional-insured",
      "Verified with the broker",
    ));
    expect(screen.queryByRole("dialog", { name: "Override compliance check?" })).not.toBeInTheDocument();
  });

  it("keeps warning overrides as a one-click action without a reason", async () => {
    const user = userEvent.setup();
    const applyOverride = vi.fn().mockResolvedValue({});
    const record = {
      ...makeCoi(),
      coiOverrides: [],
      compliance: makeCompliance({
        checks: [{ ...makeCompliance().checks[0], effectiveStatus: "warn", provenance: "computed" }],
      }),
    };

    render(<DocumentPanel record={record} spec={createCoiDocumentSpec({ canOverride: true, onApplyOverride: applyOverride })} />);

    await user.click(screen.getAllByRole("button", { name: "Approve" })[0]);
    await waitFor(() => expect(applyOverride).toHaveBeenCalledWith(
      expect.objectContaining({ id: "coi-200" }),
      "additional-insured",
      undefined,
    ));
    expect(screen.queryByRole("dialog", { name: "Override compliance check?" })).not.toBeInTheDocument();
  });

  it("cancels a failing-check override without calling the mutation", async () => {
    const user = userEvent.setup();
    const applyOverride = vi.fn().mockResolvedValue({});
    const record = {
      ...makeCoi(),
      coiOverrides: [],
      compliance: makeCompliance({
        checks: [{ ...makeCompliance().checks[0], effectiveStatus: "fail", provenance: "computed" }],
      }),
    };

    render(<DocumentPanel record={record} spec={createCoiDocumentSpec({ canOverride: true, onApplyOverride: applyOverride })} />);

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(applyOverride).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Override compliance check?" })).not.toBeInTheDocument();
  });

  it("clears a pending override reason when navigating to a different COI", async () => {
    const user = userEvent.setup();
    const applyOverride = vi.fn().mockResolvedValue({});
    const compliance = makeCompliance({
      checks: [{ ...makeCompliance().checks[0], effectiveStatus: "fail", provenance: "computed" }],
    });
    const first = { ...makeCoi(), id: "coi-a", coiOverrides: [], compliance };
    const second = { ...makeCoi(), id: "coi-b", coiOverrides: [], compliance };
    const spec = createCoiDocumentSpec({ canOverride: true, onApplyOverride: applyOverride });
    const { rerender } = render(<DocumentPanel record={first} spec={spec} />);

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.type(screen.getByLabelText("Override reason"), "Reason for COI A");

    rerender(<DocumentPanel record={second} spec={spec} />);

    expect(screen.queryByRole("dialog", { name: "Override compliance check?" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByLabelText("Override reason")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Confirm override" })).toBeDisabled();
    expect(applyOverride).not.toHaveBeenCalled();
  });

  it("gates persisted mutations by the exact permission and preserves state on a literal 403", async () => {
    const user = userEvent.setup();
    const record = { ...makeCoi(), coiOverrides: [], compliance: makeCompliance({ checks: [{ ...makeCompliance().checks[0], effectiveStatus: "fail", provenance: "computed" }] }) };
    const rejected = vi.fn(() => Promise.reject({ status: 403, message: "COI override permission is required" }));
    const { rerender } = render(
      <DocumentPanel record={record} spec={createCoiDocumentSpec({ canOverride: false, onApplyOverride: rejected })} />,
    );
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    rerender(
      <DocumentPanel record={record} spec={createCoiDocumentSpec({ canOverride: true, onApplyOverride: rejected })} />,
    );
    await user.click(screen.getAllByRole("button", { name: "Approve" })[0]);
    await user.type(screen.getByLabelText("Override reason"), "Approved after review");
    await user.click(screen.getByRole("button", { name: "Confirm override" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("COI override permission is required"));
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: "Approve" }).length).toBeGreaterThan(0);
  });
});
