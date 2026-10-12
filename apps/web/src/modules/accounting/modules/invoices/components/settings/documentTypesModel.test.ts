import { describe, expect, it } from "vitest";

import {
  buildChangedClassificationPayload,
  canEditClassificationLabel,
  canEditClassificationStatus,
  canEditOpensAs,
  canMutateClassification,
  deriveDocumentTypeStatus,
  documentTypesSignature,
  getAssociationLabel,
  getDirtyClassificationNames,
  getSurfaceTone,
  needsInput,
  validateAddType,
  validateClassificationLabel,
} from "@/modules/accounting/modules/invoices/components/settings/documentTypesModel";
import type { ClassificationAssociation, ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";

const rows: ClassificationInfo[] = [
  { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
  { name: "receipt", label: "Receipt", opensAs: "receipt", action: "extract-match", builtIn: true, status: "active" },
  { name: "custom-doc", label: "Custom Doc", opensAs: "other", action: "view-only", builtIn: false, status: "active" },
  { name: "unmapped-doc", label: "Unmapped Doc", opensAs: null, action: "view-only", builtIn: false, status: "active" },
];

const associations: ClassificationAssociation[] = [
  { key: "invoice", label: "Invoice Workflow", description: "Invoice flow" },
  { key: "receipt", label: "Receipt Panel", description: "Receipt flow" },
  { key: "other", label: "Generic Panel", description: "Generic flow" },
];

describe("documentTypesModel", () => {
  it("derives needs-input and row mutability state", () => {
    expect(canMutateClassification(rows[0])).toBe(false);
    expect(canEditOpensAs(rows[0])).toBe(false);
    expect(canMutateClassification(rows[1])).toBe(true);
    expect(canEditOpensAs(rows[1])).toBe(true);
    expect(canEditClassificationLabel(rows[1])).toBe(false);
    expect(canEditClassificationStatus(rows[1])).toBe(false);
    expect(canEditClassificationLabel(rows[2])).toBe(true);
    expect(needsInput(rows[3])).toBe(true);
    expect(deriveDocumentTypeStatus(rows[3])).toBe("needs-input");
  });

  it("builds changed-row payloads for custom rows and built-in opensAs overrides", () => {
    const changed = [
      { ...rows[0], opensAs: "other" },
      { ...rows[1], label: "Ignored Built-in Label", opensAs: "other", status: "disabled" as const },
      { ...rows[2], label: "Updated Custom Doc", opensAs: "receipt" },
      { ...rows[3], status: "disabled" as const },
    ];

    expect(getDirtyClassificationNames(changed, rows)).toEqual(["receipt", "custom-doc", "unmapped-doc"]);
    expect(buildChangedClassificationPayload(changed, rows)).toEqual({
      updates: [
        { name: "receipt", opensAs: "other" },
        { name: "custom-doc", label: "Updated Custom Doc", opensAs: "receipt" },
        { name: "unmapped-doc", status: "disabled" },
      ],
    });
  });

  it("uses only sorted names for the structural document types signature", () => {
    const refetched = [
      { ...rows[3], label: "Server Changed Label", status: "disabled" as const },
      { ...rows[0], label: "Server Invoice Label" },
      { ...rows[2], opensAs: "receipt" },
      { ...rows[1], opensAs: "other" },
    ];

    expect(documentTypesSignature(refetched)).toBe(documentTypesSignature(rows));
  });

  it("validates add type backend rules", () => {
    expect(validateAddType({ name: "", label: "", opensAs: "" }, rows).errors).toEqual({
      name: "Name is required.",
      label: "Label is required.",
      opensAs: "Choose a destination.",
    });
    expect(validateAddType({ name: "Bad Name", label: "Valid", opensAs: "other" }, rows).errors.name).toContain("kebab-case");
    expect(validateAddType({ name: "a".repeat(51), label: "Valid", opensAs: "other" }, rows).errors.name).toContain("50");
    expect(validateAddType({ name: "custom-doc", label: "Valid", opensAs: "other" }, rows).errors.name).toContain("reserved");
    expect(validateAddType({ name: "document", label: "Valid", opensAs: "other" }, rows).errors.name).toContain("reserved");
    expect(validateAddType({ name: "new-doc", label: "x".repeat(101), opensAs: "other" }, rows).errors.label).toContain("100");
    expect(validateAddType({ name: "new-doc", label: "New Doc", opensAs: "other" }, rows).valid).toBe(true);
    expect(validateClassificationLabel("")).toBe("Label is required.");
    expect(validateClassificationLabel("x".repeat(101))).toBe("Label must be 100 characters or fewer.");
    expect(validateClassificationLabel("Valid Label")).toBeNull();
  });

  it("looks up association labels and surface tone display", () => {
    expect(getAssociationLabel(associations, "receipt")).toBe("Receipt Panel");
    expect(getAssociationLabel(associations, null)).toBe("Choose destination...");
    expect(getSurfaceTone("invoice")).toBe("invoice");
    expect(getSurfaceTone("coi")).toBe("document");
    expect(getSurfaceTone(null)).toBe("generic");
  });
});
