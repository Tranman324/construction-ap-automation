import { describe, expect, it } from "vitest";

import {
  getInitialW9DocumentData,
  W9_TAX_CLASSES,
  W9_US_STATES,
  W9_VENDOR_TYPES,
} from "@/modules/accounting/modules/invoices/components/documents/w9DocumentData";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

function makeRecord(): Invoice {
  return {
    id: "w9-100",
    classification: "w9",
    confidence: 0.82,
    file: "w9-100.pdf",
    email: {
      from: "tax@millwork.example.com",
      subject: "W-9 material supply vendor",
      receivedAt: "2026-06-12T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-06-12T12:00:00.000Z",
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
    overallConfidence: 0.82,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
  };
}

describe("W-9 document data", () => {
  it("exposes W-9 option sets from the design source", () => {
    expect(W9_VENDOR_TYPES.map((option) => option.value)).toContain("subcontractor");
    expect(W9_TAX_CLASSES.map((option) => option.value)).toContain("llc-s");
    expect(W9_US_STATES.map((option) => option.value)).toContain("GA");
  });

  it("derives initial form data from the invoice record", () => {
    const data = getInitialW9DocumentData(makeRecord());

    expect(data.vendorName).toBe("Millwork & Casework LLC");
    expect(data.vendorType).toBe("material");
    expect(data.taxClass).toBe("llc-s");
    expect(data.taxIdType).toBe("feid");
    expect(data.contactEmail).toBe("tax@millwork.example.com");
    expect(data.addressLine1).toBe("4820 Quarry Bend Rd");
    expect(data.city).toBe("Brookfield");
    expect(data.state).toBe("ST");
    expect(data.zip).toBe("00002");
  });
});
