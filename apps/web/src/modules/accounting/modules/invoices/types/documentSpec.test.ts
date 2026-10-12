import { describe, expect, it } from "vitest";

import {
  getDocumentAlertRevision,
  getDocumentChecklistProgress,
  hasDocumentAlertTarget,
  isDocumentActionDisabled,
  isDocumentAlertDismissible,
  isDocumentAlertNotice,
  isNoticeOnly,
  type DocumentChecklistItem,
} from "@/modules/accounting/modules/invoices/types/documentSpec";

describe("documentSpec helpers", () => {
  it("treats pending and disabled actions as unavailable", () => {
    expect(isDocumentActionDisabled({ pending: true })).toBe(true);
    expect(isDocumentActionDisabled({ disabled: true })).toBe(true);
    expect(isDocumentActionDisabled({ disabled: false, pending: false })).toBe(false);
  });

  it("offers dismissal only to opted-in alerts and alerts with no action and no target", () => {
    const action = { id: "retry", label: "Retry", onClick: () => undefined };
    expect(hasDocumentAlertTarget({ sectionId: "identity" })).toBe(true);
    expect(hasDocumentAlertTarget({ tabId: "details" })).toBe(true);
    expect(hasDocumentAlertTarget({})).toBe(false);
    expect(isDocumentAlertDismissible({})).toBe(true);
    expect(isDocumentAlertDismissible({ action })).toBe(false);
    expect(isDocumentAlertDismissible({ sectionId: "identity" })).toBe(false);
    expect(isDocumentAlertDismissible({ tabId: "details" })).toBe(false);
    expect(isDocumentAlertDismissible({ sectionId: "identity", dismissible: true })).toBe(true);
  });

  it("FIX61-5 a notice is a dismissible non-waiting alert, and notice-only needs at least one item and no non-notice", () => {
    expect(isDocumentAlertNotice({})).toBe(true);
    expect(isDocumentAlertNotice({ waiting: true })).toBe(false);
    expect(isDocumentAlertNotice({ sectionId: "identity" })).toBe(false);
    expect(isDocumentAlertNotice({ sectionId: "identity", dismissible: true })).toBe(true);
    expect(isNoticeOnly([])).toBe(false);
    expect(isNoticeOnly([{ notice: true }, { notice: true }])).toBe(true);
    expect(isNoticeOnly([{ notice: true }, {}])).toBe(false);
  });

  it("changes the alert revision when its label or detail changes", () => {
    const base = getDocumentAlertRevision({ id: "a", label: "Notice", detail: "One" });
    expect(getDocumentAlertRevision({ id: "a", label: "Notice", detail: "One" })).toBe(base);
    expect(getDocumentAlertRevision({ id: "a", label: "Notice", detail: "Two" })).not.toBe(base);
    expect(getDocumentAlertRevision({ id: "a", label: "Notice 2", detail: "One" })).not.toBe(base);
    expect(getDocumentAlertRevision({ id: "b", label: "Notice", detail: "One" })).not.toBe(base);
  });

  it("summarizes checklist completion state", () => {
    const items: DocumentChecklistItem[] = [
      { id: "file", label: "File identified", state: "done" },
      { id: "route", label: "Route selected", state: "todo" },
      { id: "check", label: "Needs review", state: "warning" },
    ];

    expect(getDocumentChecklistProgress(items)).toEqual({
      total: 3,
      done: 1,
      remaining: 2,
    });
  });
});
