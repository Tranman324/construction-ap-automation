import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  W9CollapsedContactSummary,
  W9ContactFields,
  W9DocumentStatus,
  W9IdentityFields,
  W9ProgressPanel,
} from "@/modules/accounting/modules/invoices/components/documents/w9DocumentViews";
import {
  setW9ActiveStep,
  failW9Progress,
  completeW9Progress,
  type W9ProgressState,
  validateW9Identity,
} from "@/modules/accounting/modules/invoices/components/documents/w9DocumentModel";
import { W9_TAX_CLASSES, W9_US_STATES, W9_VENDOR_TYPES } from "@/modules/accounting/modules/invoices/components/documents/w9DocumentData";
import { DocumentPanel } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanel";
import { createW9DocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/w9DocumentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { PanelNoticeObserver, PanelNoticeOutlet, PanelNoticeProvider } from "./PanelNotice";
import { expectDomOrder, expectNoPositiveTabIndex } from "../tabOrderAssertions";

const optionalContactTitles = [
  "Contact name",
  "Contact email",
  "Phone",
  "Fax",
  "Address line 1",
  "Address line 2",
  "City",
  "State",
  "ZIP",
] as const;

function makeW9Record(): Invoice {
  return {
    id: "w9-tab-order",
    classification: "w9",
    confidence: 0.9,
    overallConfidence: 0.9,
    file: "w9-tab-order.pdf",
    email: { from: "tax@example.com", subject: "material supply W-9", receivedAt: "2026-01-01T00:00:00Z" },
    status: "pending",
    queuedAt: "2026-01-01T00:00:00Z",
    extracted: {
      vendorName: "Acme LLC",
      vendorAddress: "123 Main St, Atlanta, GA 30336",
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
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
  };
}

describe("W-9 document views", () => {
  describe("W-9 edit tab order", () => {
    it("keeps identity before contact fields without positive tab indexes", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <DocumentPanel
          record={makeW9Record()}
          spec={createW9DocumentSpec({ onCreateVendorAndUpload: vi.fn().mockResolvedValue({ status: "created" }) })}
        />,
      );
      fireEvent.change(screen.getByLabelText(/^Tax ID number/), { target: { value: "123456789" } });
      const vendorName = screen.getByRole("textbox", { name: /^Vendor name/ });
      const comboboxes = screen.getAllByRole("combobox");
      const fields = [
        screen.getByRole("button", { name: "tax@example.com" }), vendorName,
        comboboxes[0], comboboxes[1],
        screen.getByRole("button", { name: "SSN" }), screen.getByRole("button", { name: "FEID" }), screen.getByLabelText(/^Tax ID number/),
        screen.getByRole("button", { name: "Hide" }), screen.getByLabelText("Contact name"), screen.getByLabelText("Contact email"),
        screen.getByLabelText("Phone"), screen.getByLabelText("Fax"), screen.getByLabelText("Address line 1"), screen.getByLabelText("Address line 2"),
        screen.getByLabelText("City"), screen.getByLabelText("State"), screen.getByLabelText("ZIP"), screen.getByRole("button", { name: "Create Vendor & Upload" }),
      ];
      expect(screen.getByRole("button", { name: "Create Vendor & Upload" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: /unresolved alerts/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Review details" })).not.toBeInTheDocument();
      expectDomOrder(fields);
      expectNoPositiveTabIndex(container);
      fields[0].focus();
      await user.tab();
      expect(document.activeElement).toBe(fields[1]);
    });
  });

  it("keeps pending and completed history inline and counts only the failed step", () => {
    const onChange = vi.fn();
    const view = (progress: W9ProgressState) => <PanelNoticeProvider documentId="w9-1">
      <div data-testid="inline-progress"><W9ProgressPanel progress={progress} /></div>
      <PanelNoticeOutlet /><PanelNoticeObserver onChange={onChange} />
    </PanelNoticeProvider>;
    const { rerender } = render(view(setW9ActiveStep("tracking")));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByTestId("inline-progress")).toContainElement(screen.getByText("Create tracking item"));
    rerender(view(failW9Progress("upload")));
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: "w9-upload-failed", resolved: false })]);
    expect(screen.getByTestId("panel-notice-outlet")).toContainElement(screen.getByText("Upload W-9 document"));
    expect(screen.getByTestId("inline-progress")).toContainElement(screen.getByText("Create vendor in Spectrum"));
    rerender(view(completeW9Progress()));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByTestId("panel-notice-outlet")).toBeEmptyDOMElement();
    expect(screen.getByTestId("inline-progress")).toContainElement(screen.getByText("Upload W-9 document"));
  });
  it("renders identity fields and emits typed changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    const { container } = render(
      <W9IdentityFields
        vendorName="Acme"
        vendorCode="ACME03"
        vendorType=""
        taxClass=""
        taxIdType="feid"
        taxId="123456789"
        validation={validateW9Identity({ vendorName: "Acme", vendorType: "", taxClass: "", taxId: "123456789" })}
        vendorTypes={W9_VENDOR_TYPES}
        taxClasses={W9_TAX_CLASSES}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("ACME03")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Tax ID number/)).toHaveValue("12-3456789");

    await user.click(screen.getByRole("button", { name: "SSN" }));
    fireEvent.change(screen.getByLabelText(/^Vendor name/), { target: { value: "Acme Electric" } });
    fireEvent.change(screen.getByLabelText(/^Vendor type/), { target: { value: "material" } });

    expect(onChange).toHaveBeenCalledWith({ taxIdType: "ssn" });
    expect(onChange).toHaveBeenCalledWith({ vendorName: "Acme Electric" });
    expect(onChange).toHaveBeenCalledWith({ vendorType: "material" });
    expect(container.querySelector(".sm\\:grid-cols-2")).toBeInTheDocument();
  });

  it("renders contact masks, document status, collapsed summary, and progress states", () => {
    const onChange = vi.fn();

    const { container } = render(
      <div>
        <W9ContactFields
          contactName=""
          contactEmail="tax@example.com"
          phone="4045550100"
          fax=""
          addressLine1=""
          addressLine2=""
          city="Atlanta"
          state="GA"
          zip="303361234"
          states={W9_US_STATES}
          onChange={onChange}
        />
        <W9CollapsedContactSummary email="tax@example.com" phone="4045550100" />
        <W9DocumentStatus fileName="w9.pdf" />
        <W9ProgressPanel progress={setW9ActiveStep("tracking")} />
      </div>,
    );

    expect(screen.getByLabelText(/^Phone/)).toHaveValue("(404) 555-0100");
    expect(screen.getByLabelText(/^ZIP/)).toHaveValue("30336-1234");
    expect(screen.getByText("tax@example.com - (404) 555-0100")).toBeInTheDocument();
    expect(screen.getByText("w9.pdf")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(container.querySelector(".sm\\:flex-row")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Fax/), { target: { value: "4045550101" } });
    expect(onChange).toHaveBeenCalledWith({ fax: "4045550101" });
  });

  it.each(optionalContactTitles)("renders the optional %s field with a plain title", (title) => {
    render(
      <W9ContactFields
        contactName=""
        contactEmail=""
        phone=""
        fax=""
        addressLine1=""
        addressLine2=""
        city=""
        state="GA"
        zip=""
        states={W9_US_STATES}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(title)).not.toBeRequired();
    expect(screen.queryByLabelText(`${title} optional`)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(`${title} (optional)`)).not.toBeInTheDocument();
  });
});
