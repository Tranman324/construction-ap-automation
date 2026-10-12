import { describe, expect, it } from "vitest";

import {
  buildSharePointFilename,
  getOtherFilingData,
  getReclassifyOptions,
  getSubcontractFilingData,
  getWarrantyFilingData,
} from "@/modules/accounting/modules/invoices/components/documents/simpleFilingDocumentModel";
import { getDocumentVendor } from "@/modules/accounting/modules/invoices/components/documents/documentSpecLocalModels";
import type { ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

function makeRecord(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "doc-1",
    classification: "subcontract",
    confidence: 0.82,
    file: "subcontract.pdf",
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
    matching: {
      vendor: {
        vendorCode: "APEX01",
        vendorName: "Apex Interior Metals",
        confidence: 0.96,
        method: "domain",
      },
      job: {
        jobNumber: "24-017",
        jobDescription: "North Tower",
        confidence: 0.94,
        method: "subject",
      },
      subcontract: {
        subcontractNumber: "SC-24-017",
        confidence: 0.91,
        method: "number",
      },
      sourceInvoiceTotal: 486500,
    },
    overallConfidence: 0.82,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    ...overrides,
  };
}

describe("simpleFilingDocumentModel", () => {
  it("derives subcontract and warranty display data from invoice fields", () => {
    const record = makeRecord();

    expect(getSubcontractFilingData(record)).toMatchObject({
      subcontractor: "Apex Interior Metals",
      trade: "Drywall and framing subcontract retainage 10%",
      subcontractNumber: "SC-24-017",
      contractSum: 486500,
      retainage: "10%",
    });
    expect(getWarrantyFilingData(record)).toMatchObject({
      provider: "Apex Interior Metals",
      providerKind: null,
      warrantyType: null,
      job: { label: "24-017 / North Tower" },
    });
  });

  it("renders server-resolved filing values when extracted, matching, and email sources conflict", () => {
    const record = makeRecord({
      extracted: {
        ...makeRecord().extracted!,
        vendorName: "Extracted vendor",
        jobNumber: "EXTRACTED-JOB",
        projectName: "Extracted project",
        description: "Extracted scope",
      },
      matching: {
        ...makeRecord().matching!,
        vendor: { vendorCode: "MATCH", vendorName: "Matched vendor", confidence: 0.9, method: "match" },
        job: { jobNumber: "MATCHED-JOB", jobDescription: "Matched project", confidence: 0.9, method: "match" },
      },
      email: { ...makeRecord().email, from: "email-vendor@example.com", subject: "Email scope" },
      filing: {
        fileName: { value: "DOC canonical.pdf", provenance: "computed", permittedActions: [], blockers: [] },
        vendor: { value: "Manual vendor", provenance: "manual", permittedActions: [], blockers: [] },
        job: { value: "MANUAL-JOB", provenance: "manual", permittedActions: [], blockers: [] },
        scope: { value: "Manual scope", provenance: "manual", permittedActions: [], blockers: [] },
        providerKind: { value: "Vendor", provenance: "computed", permittedActions: [], blockers: [] },
        warrantyType: { value: "Warranty certificate", provenance: "computed", permittedActions: [], blockers: [] },
      },
    });

    expect(getSubcontractFilingData(record)).toMatchObject({
      subcontractor: "Manual vendor",
      trade: "Manual scope",
      job: { id: "MANUAL-JOB" },
    });
    expect(getWarrantyFilingData(record)).toMatchObject({
      provider: "Manual vendor",
      providerKind: "Vendor",
      warrantyType: "Warranty certificate",
      scope: "Manual scope",
      job: { id: "MANUAL-JOB" },
    });
    expect(getOtherFilingData(record)).toMatchObject({ source: "Manual vendor", job: { id: "MANUAL-JOB" } });
  });

  it("prefers the matched job description and falls back to extracted project name only without a match", () => {
    const matched = makeRecord({
      extracted: { ...makeRecord().extracted!, jobNumber: "31-112", projectName: "Lakeside Park - Building 21" },
      matching: {
        ...makeRecord().matching!,
        job: { jobNumber: "31-112", jobDescription: "Maple Commons Retail TI", confidence: 0.98, method: "exact" },
      },
    });

    for (const getData of [getOtherFilingData, getSubcontractFilingData, getWarrantyFilingData]) {
      expect(getData(matched).job).toMatchObject({
        id: "31-112",
        name: "Maple Commons Retail TI",
        label: "31-112 / Maple Commons Retail TI",
      });
    }

    const unmatched = makeRecord({
      extracted: { ...makeRecord().extracted!, projectName: "Lakeside Park - Building 21" },
      matching: { ...makeRecord().matching!, job: null },
    });
    expect(getOtherFilingData(unmatched).job).toMatchObject({
      name: "Lakeside Park - Building 21",
      label: "24-017 / Lakeside Park - Building 21",
    });
  });

  it("uses safe fallback labels for generic documents", () => {
    const data = getOtherFilingData(makeRecord({
      classification: "credit-memo",
      extracted: null,
      matching: null,
      file: "credit.pdf",
    }));

    expect(data).toMatchObject({
      source: "contracts@example.com",
      classificationLabel: "Credit Memo",
      fileName: "credit.pdf",
    });
  });

  it("keeps receipt-panel vendor editing outside the filing resolver scope", () => {
    const record = makeRecord({
      filing: {
        fileName: { value: "RCT canonical.pdf", provenance: "computed", permittedActions: [], blockers: [] },
        vendor: { value: "Canonical filing vendor", provenance: "manual", permittedActions: [], blockers: [] },
      },
    });
    expect(getDocumentVendor(record)).toBe("Apex Interior Metals");
  });

  it("filters the current type and invoices from reclassify options", () => {
    const options: ClassificationInfo[] = [
      { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
      { name: "other", label: "Other", opensAs: "other", action: "view-only", builtIn: true, status: "active" },
      { name: "w9", label: "W-9", opensAs: "w9", action: "view-only", builtIn: true, status: "active" },
      { name: "disabled-doc", label: "Disabled Doc", opensAs: "other", action: "view-only", builtIn: false, status: "disabled" },
    ];

    expect(getReclassifyOptions("other", options).map((option) => option.name)).toEqual(["w9"]);
  });

  it("builds concise SharePoint filenames from document fields", () => {
    expect(buildSharePointFilename(makeRecord({
      classification: "receipt",
      file: "Image.jpeg",
      extracted: {
        vendorName: "The Home Depot",
        vendorAddress: null,
        invoiceNumber: "8841",
        invoiceDate: "2026-06-16T12:00:00.000Z",
        dueDate: null,
        amount: 94.47,
        jobNumber: "26-434",
        projectName: "Brightwater North",
        description: null,
        lineItems: [],
      },
    }))).toBe("Receipt The Home Depot 06-16-26 8841.jpeg");

    expect(buildSharePointFilename(makeRecord({
      classification: "building-permit",
      file: "Application Form-BLDG2606070375.pdf",
      extracted: {
        vendorName: "City of Springfield",
        vendorAddress: null,
        invoiceNumber: "BLDG2606070375",
        invoiceDate: "2026-06-09T12:00:00.000Z",
        dueDate: null,
        amount: null,
        jobNumber: "26-434",
        projectName: "Springfield Medical - Lakeshore Vascular",
        description: null,
        lineItems: [],
      },
    }))).toBe("Building Permit City of 06-09-26.pdf");
  });
});
