import { describe, expect, it } from "vitest";

import filenameGoldenVectors from "../../../../../../../../../test-fixtures/invoices/filename-golden-vectors.json";
import { buildSharePointFilename } from "@/modules/accounting/modules/invoices/components/documents/simpleFilingDocumentModel";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

type FilenameVector = {
  name: string;
  type: Invoice["classification"];
  vendor: string;
  vendorSource?: "email";
  date: string;
  filingDate?: string;
  filingDateProvenance?: "manual" | "extracted" | "matching";
  ref: string | null;
  extension: string | null;
  expected: string;
};

const vectors = filenameGoldenVectors.vectors as FilenameVector[];

function recordFor(vector: FilenameVector): Invoice {
  const sourceFile = vector.extension === null
    ? "extensionless"
    : `source${vector.extension.startsWith(".") ? vector.extension : `.${vector.extension}`}`;
  const emailVendor = vector.vendorSource === "email" ? vector.vendor : "vendor@example.com";

  return {
    id: `golden-${vector.name}`,
    classification: vector.type,
    confidence: 1,
    file: sourceFile,
    email: {
      from: emailVendor,
      subject: "Filename golden vector",
      receivedAt: vector.date,
    },
    status: "pending",
    queuedAt: vector.date,
    extracted: {
      vendorName: vector.vendorSource === "email" ? null : vector.vendor,
      vendorAddress: null,
      invoiceNumber: vector.ref,
      invoiceDate: vector.date,
      dueDate: null,
      amount: null,
      jobNumber: null,
      projectName: null,
      description: null,
      lineItems: [],
    },
    matching: null,
    overallConfidence: 1,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    ...(vector.filingDate ? {
      filing: {
        fileName: {
          value: vector.expected,
          provenance: "computed",
          permittedActions: [],
          blockers: [],
        },
        date: {
          value: vector.filingDate,
          provenance: vector.filingDateProvenance ?? "extracted",
          permittedActions: [],
          blockers: [],
        },
      },
    } : {}),
  };
}

describe("filename golden vectors", () => {
  it("keeps the fixture schema and required C.1 coverage explicit", () => {
    expect(filenameGoldenVectors.schema).toBe("p4-filing-filename-golden-vectors/v1");
    expect(vectors).toHaveLength(35);
    expect(new Set(vectors.map((vector) => vector.type))).toEqual(new Set([
      "invoice",
      "receipt",
      "pay-application",
      "credit-memo",
      "subcontract",
      "warranty",
      "image",
      "other",
      "statement",
      "coi",
      "w9",
      "lien-waiver",
      "building-permit",
      "contract",
      "change-order",
      "purchase-order",
      "no-attachment",
      "error",
      "all-skipped",
      "skipped",
      "unsupported",
    ]));
    expect(vectors.some((vector) => vector.vendorSource === "email")).toBe(true);
    expect(vectors.some((vector) => vector.name.includes("word boundary"))).toBe(true);
    expect(vectors.some((vector) => vector.name.includes("without a usable boundary"))).toBe(true);
    expect(vectors.some((vector) => vector.ref === "1234567890")).toBe(true);
    expect(vectors.some((vector) => vector.ref === "12345678901")).toBe(true);
    expect(vectors.some((vector) => vector.date === "not-a-date")).toBe(true);
    expect(vectors.some((vector) => vector.extension === "JpEg")).toBe(true);
    expect(vectors.some((vector) => vector.extension === ".PDF")).toBe(true);
    expect(vectors.some((vector) => vector.filingDateProvenance === "manual")).toBe(true);
    expect(vectors.some((vector) => vector.filingDateProvenance === "matching")).toBe(true);
  });

  it.each(vectors)("emits the captured bytes for $name", (vector) => {
    expect(buildSharePointFilename(recordFor(vector))).toBe(vector.expected);
  });
});
