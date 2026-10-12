import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DocumentPanel } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanel";
import { PanelNoticeOutlet, PanelNoticeProvider } from "./PanelNotice";
import { createW9DocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/w9DocumentSpec";
import { deriveW9VendorCodePreview, failW9Progress } from "@/modules/accounting/modules/invoices/components/documents/w9DocumentModel";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

function makeW9(): Invoice {
  return {
    id: "w9-200",
    classification: "w9",
    confidence: 0.84,
    file: "w9-200.pdf",
    email: {
      from: "tax@millwork.example.com",
      subject: "W-9 material supply vendor",
      receivedAt: "2026-06-15T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-06-15T12:00:00.000Z",
    extracted: {
      vendorName: "Millwork & Casework LLC",
      vendorAddress: "4820 Quarry Bend Rd, Brookfield, ST 00002",
      invoiceNumber: null,
      invoiceDate: null,
      dueDate: null,
      amount: null,
      jobNumber: null,
      projectName: null,
      description: null,
      lineItems: [],
    },
    matching: null,
    overallConfidence: 0.84,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
  };
}

describe("createW9DocumentSpec", () => {
  it("does not expose a SharePoint filename field even when the server permits editing", () => {
    const record = makeW9();
    record.filing = { ...record.filing, fileName: { value: "Canonical.pdf", provenance: "computed", permittedActions: ["edit"], blockers: [] } };
    render(<DocumentPanel record={record} spec={createW9DocumentSpec()} />);
    expect(screen.queryByRole("textbox", { name: "File name" })).not.toBeInTheDocument();
  });

  it("uses amber for a new vendor and red for an upload failure", () => {
    const spec = createW9DocumentSpec();
    const record = makeW9();
    const form = spec.initForm(record);
    const output = spec.build({ record, form, setForm: () => undefined, patchForm: () => undefined });

    expect(output.header.statusLabel).toBe("New vendor");
    expect(output.header.statusTone).toBe("warn");

    const failedForm = { ...form, progress: failW9Progress("upload") };
    const failedOutput = spec.build({ record, form: failedForm, setForm: () => undefined, patchForm: () => undefined });
    expect(failedOutput.header.statusLabel).toBe("Upload failed");
    expect(failedOutput.header.statusTone).toBe("bad");
    expect(failedOutput.alerts?.some((alert) => alert.id === "w9-upload-failed")).toBe(false);
    render(<PanelNoticeProvider documentId={record.id}>
      <div data-testid="inline-progress">{failedOutput.sections.find((section) => section.id === "progress")?.children}</div>
      <PanelNoticeOutlet />
    </PanelNoticeProvider>);
    expect(screen.getByTestId("inline-progress")).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("panel-notice-outlet")).toContainElement(screen.getByRole("button", { name: "Retry upload" }));
    expect(screen.getByText(/was created, but the document upload failed/)).toBeInTheDocument();
  });

  it("uses the compact scroll renderer and emits one stable item for each missing requirement", () => {
    const spec = createW9DocumentSpec();
    const record = { ...makeW9(), email: { ...makeW9().email, subject: "Signed W-9" } };
    const form = { ...spec.initForm(record), taxId: "123456789" };
    const output = spec.build({ record, form, setForm: () => undefined, patchForm: () => undefined });
    const alerts = output.alerts ?? [];

    expect(output.preferredRenderer).toBe("scroll");
    expect(output.checklist).toBeUndefined();
    expect(alerts.map((alert) => alert.id)).toEqual(["w9-vendor-type"]);
    expect(new Set(alerts.map((alert) => alert.id)).size).toBe(alerts.length);
    expect(alerts[0]?.label).toBe("Vendor type required");
  });

  it("renders W-9 sections, updates vendor code preview, and submits when valid", async () => {
    const user = userEvent.setup();
    let finishSubmission: ((result: { status: "created" }) => void) | undefined;
    const submission = new Promise<{ status: "created" }>((resolve) => {
      finishSubmission = resolve;
    });
    const onCreateVendorAndUpload = vi.fn().mockReturnValue(submission);

    render(<DocumentPanel record={makeW9()} spec={createW9DocumentSpec({ onCreateVendorAndUpload })} />);

    expect(screen.getByText("W-9")).toBeInTheDocument();
    expect(screen.getByText("Vendor Identity")).toBeInTheDocument();
    expect(screen.getByText("Vendor Contact")).toBeInTheDocument();
    expect(screen.getByText("W-9 Document")).toBeInTheDocument();
    expect(screen.getByText(deriveW9VendorCodePreview("Millwork & Casework LLC"))).toBeInTheDocument();

    const primary = screen.getByRole("button", { name: "Create Vendor & Upload" });
    expect(primary).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^Vendor name/), { target: { value: "Acme Electric LLC" } });
    expect(screen.getByText(deriveW9VendorCodePreview("Acme Electric LLC"))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.getAllByText("tax@millwork.example.com").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText(/^Tax ID number/), { target: { value: "123456789" } });
    expect(screen.getByRole("button", { name: "Create Vendor & Upload" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Create Vendor & Upload" }));

    await waitFor(() => expect(screen.getByText("Spectrum Progress")).toBeInTheDocument());
    await waitFor(() => {
      expect(onCreateVendorAndUpload).toHaveBeenCalledWith(
        expect.objectContaining({ id: "w9-200" }),
        expect.objectContaining({ vendorName: "Acme Electric LLC", taxId: "123456789" }),
      );
    });
    finishSubmission?.({ status: "created" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Vendor Created" })).toBeDisabled());
  });

  it("shows upload error state and retries from the failed step", async () => {
    const user = userEvent.setup();
    const onCreateVendorAndUpload = vi.fn()
      .mockResolvedValueOnce({ status: "upload-failed" })
      .mockResolvedValueOnce({ status: "created" });

    render(<DocumentPanel record={makeW9()} spec={createW9DocumentSpec({ onCreateVendorAndUpload })} />);

    fireEvent.change(screen.getByLabelText(/^Tax ID number/), { target: { value: "123456787" } });
    await user.click(screen.getByRole("button", { name: "Create Vendor & Upload" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Retry Upload" })).toBeEnabled());
    expect(screen.getAllByText("W-9 upload failed")).toHaveLength(1);
    expect(screen.getByTestId("panel-notice-outlet")).toContainElement(screen.getByRole("button", { name: "Retry upload" }));

    await user.click(screen.getByRole("button", { name: "Retry upload" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Vendor Created" })).toBeDisabled());
    expect(onCreateVendorAndUpload).toHaveBeenCalledTimes(2);
  });

  it("never enables or fabricates completion without a server-owned submission callback", () => {
    const spec = createW9DocumentSpec();
    const record = makeW9();
    const form = { ...spec.initForm(record), vendorType: "subcontractor", taxId: "123456789" };
    const output = spec.build({ record, form, setForm: () => undefined, patchForm: () => undefined });

    expect(output.primaryAction?.disabled).toBe(true);
    expect(output.primaryAction?.disabledReason).toBe("Vendor creation is not available from this panel yet.");
    expect(output.header.statusLabel).toBe("New vendor");
  });

  it("does not treat a generic reviewed lifecycle status as vendor completion", () => {
    const spec = createW9DocumentSpec();
    const record = { ...makeW9(), status: "reviewed" as const };
    const form = spec.initForm(record);
    const output = spec.build({ record, form, setForm: () => undefined, patchForm: () => undefined });

    expect(form.submitted).toBe(false);
    expect(output.header.statusLabel).toBe("New vendor");
    expect(output.primaryAction?.label).toBe("Create Vendor & Upload");
  });
});
