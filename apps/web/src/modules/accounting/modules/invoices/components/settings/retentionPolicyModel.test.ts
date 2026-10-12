import { describe, expect, it } from "vitest";

import type { RetentionRule } from "@/modules/accounting/modules/invoices/types/api";
import {
  retentionStatusOptions,
  statusLabel,
  classificationLabel,
  clampDays,
  hasDuplicateRetentionRule,
  hasDuplicateStaleRule,
  initialStaleCleanupRules,
  sortRetentionRules,
  sortStaleCleanupRules,
} from "@/modules/accounting/modules/invoices/components/settings/retentionPolicyModel";

const retentionRules: RetentionRule[] = [
  { id: 2, classification: "coi", status: "discarded", retentionDays: 30, deletePdf: true, deleteBox: true, updatedAt: "2026-01-02T00:00:00.000Z", updatedBy: "Dana", appliesTo: "coi discarded" },
  { id: 1, classification: "*", status: "submitted", retentionDays: 7, deletePdf: true, deleteBox: false, updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "System", appliesTo: "submitted" },
];

describe("retentionPolicyModel", () => {
  it("sorts wildcard retention rules first and blocks duplicates", () => {
    expect(sortRetentionRules(retentionRules).map((rule) => rule.id)).toEqual([1, 2]);
    expect(hasDuplicateRetentionRule(retentionRules, "*", "submitted")).toBe(true);
    expect(hasDuplicateRetentionRule(retentionRules, "*", "submitted", 1)).toBe(false);
  });

  it("clamps days and excludes pending status where required", () => {
    expect(clampDays(0)).toBe(1);
    expect(clampDays("9.7")).toBe(9);
    expect(retentionStatusOptions({ actions: [], fields: [], operators: [], statuses: [{ value: "approved", label: "Approved" }] }).some((option) => option.value === "pending")).toBe(false);
  });

  it("resolves classification labels from a served lookup with explicit unavailable states", () => {
    const labels = { coi: "Certificate of Insurance" };
    expect(classificationLabel("*", labels)).toBe("All Types");
    expect(classificationLabel("*", labels, "All Non-Invoice Types")).toBe("All Non-Invoice Types");
    expect(classificationLabel("coi", labels)).toBe("Certificate of Insurance");
    expect(classificationLabel("unknown", labels)).toBe("Classification unavailable");
    expect(statusLabel("unknown", {})).toBe("Status unavailable");
  });

  it("seeds and sorts stale cleanup rules deterministically", () => {
    const staleRules = initialStaleCleanupRules();

    expect(sortStaleCleanupRules(staleRules).map((rule) => rule.classification)[0]).toBe("*");
    expect(hasDuplicateStaleRule(staleRules, "coi")).toBe(true);
  });
});
