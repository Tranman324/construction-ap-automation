import { describe, expect, it } from "vitest";

import {
  buildLienWaiverSavePayload,
  getLienWaiverAlerts,
  getLienWaiverChecklist,
  getLienWaiverDocumentData,
  getLienWaiverInitialSnapshot,
  getLienWaiverPanelHeader,
  isLienWaiverSnapshotDirty,
} from "@/modules/accounting/modules/invoices/components/documents/lienWaiverDocumentModel";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

function makeWaiver(): Invoice {
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
    linkedLienWaiverId: "invoice-9",
  };
}

describe("lienWaiverDocumentModel", () => {
  it("derives waiver details from the invoice fields", () => {
    const data = getLienWaiverDocumentData(makeWaiver());

    expect(data.claimant).toBe("Apex Concrete");
    expect(data.jobLabel).toBe("24-017 / North Tower");
    expect(data.amountInput).toBe("2400");
    expect(data.linkedInvoiceId).toBe("invoice-9");
  });

  it("returns the PERSISTED waiverType only — never inferred from filename/subject", () => {
    // Persisted value wins regardless of any filename/subject signals.
    expect(getLienWaiverDocumentData({
      ...makeWaiver(),
      waiverType: "Unconditional progress waiver",
      file: "conditional-final-waiver.pdf",
      email: { ...makeWaiver().email, subject: "Conditional final waiver" },
    }).waiverType).toBe("Unconditional progress waiver");

    // No persisted waiverType → empty, even when filename/subject would have
    // previously triggered an "unconditional final" inference (now deleted).
    expect(getLienWaiverDocumentData({
      ...makeWaiver(),
      waiverType: null,
      file: "unconditional-final-waiver.pdf",
      email: { ...makeWaiver().email, subject: "Unconditional final release" },
    }).waiverType).toBe("");
  });

  it("consumes explicit server state (pairingStatus / filingStatus / releaseStatus), not raw columns", () => {
    const paired = getLienWaiverDocumentData({
      ...makeWaiver(), pairingStatus: "paired", filingStatus: "filed", releaseStatus: "released",
    });
    expect(paired.paired).toBe(true);
    expect(paired.shelved).toBe(false);
    expect(paired.released).toBe(true);

    const shelvedHeld = getLienWaiverDocumentData({
      ...makeWaiver(), pairingStatus: "unpaired", filingStatus: "shelved", releaseStatus: "held",
    });
    expect(shelvedHeld.paired).toBe(false);
    expect(shelvedHeld.shelved).toBe(true);
    expect(shelvedHeld.released).toBe(false);

    // releaseStatus is explicit: a submitted status without releaseStatus="released"
    // must NOT be treated as released (the old spFileUrl||submitted heuristic is gone).
    const notReleased = getLienWaiverDocumentData({
      ...makeWaiver(), status: "submitted", spFileUrl: "https://sp/x", releaseStatus: "held",
    });
    expect(notReleased.released).toBe(false);
  });

  it("keeps lien-waiver display precedence independent of filing envelopes", () => {
    const data = getLienWaiverDocumentData({
      ...makeWaiver(),
      filing: {
        fileName: { value: "LW canonical.pdf", provenance: "computed", permittedActions: [], blockers: [] },
        vendor: { value: "Canonical filing vendor", provenance: "manual", permittedActions: [], blockers: [] },
        job: { value: "CANONICAL-JOB", provenance: "manual", permittedActions: [], blockers: [] },
        scope: { value: "Canonical scope", provenance: "manual", permittedActions: [], blockers: [] },
      },
    });
    expect(data.claimant).toBe("Apex Concrete");
    expect(data.jobLabel).toBe("24-017 / North Tower");
  });

  it("keeps the non-waiverType fallbacks (fileName / waiverNumber) intact", () => {
    const record = makeWaiver();
    const data = getLienWaiverDocumentData({
      ...record,
      file: null as unknown as string,
      email: { ...record.email, subject: null as unknown as string },
      extracted: { ...record.extracted!, invoiceNumber: null },
    });

    expect(data.fileName).toBe("Lien waiver");
    expect(data.waiverNumber).toBe("waiver-1");
    expect(data.waiverType).toBe("");
  });

  it("tracks waiver type edits and includes them in the save payload", () => {
    const saved = getLienWaiverInitialSnapshot(makeWaiver());
    const current = {
      ...saved,
      vendorCode: "V200",
      jobNumber: "24-018",
      amountInput: "2600",
      throughDate: "2026-06-30",
      waiverType: "Unconditional final waiver",
    };
    const payload = buildLienWaiverSavePayload(
      current,
      saved,
    );

    expect(isLienWaiverSnapshotDirty(current, saved)).toBe(true);
    expect(payload).toEqual({
      vendorCode: "V200",
      jobNumber: "24-018",
      amount: 2600,
      invoiceDate: "2026-06-30",
      waiverType: "Unconditional final waiver",
    });
    expect(buildLienWaiverSavePayload(saved, saved)).toBeNull();
  });

  it("keeps an invalid changed amount out of the numeric update contract", () => {
    const saved = getLienWaiverInitialSnapshot(makeWaiver());
    expect(buildLienWaiverSavePayload({ ...saved, amountInput: "" }, saved)).toBeNull();
    expect(buildLienWaiverSavePayload({ ...saved, amountInput: "not-money", jobNumber: "24-020" }, saved)).toEqual({ jobNumber: "24-020" });
  });

  it("maps paired, held, and dirty state into review chrome", () => {
    const data = getLienWaiverDocumentData(makeWaiver());
    const state = {
      vendorCode: null,
      jobNumber: "24-017",
      amountInput: "",
      linkedInvoiceId: null,
      dirty: true,
      paired: false,
      held: true,
      released: false,
    };

    expect(getLienWaiverPanelHeader(data, state)).toMatchObject({ statusLabel: "Held", statusTone: "neutral", readyLabel: "Held" });
    expect(getLienWaiverAlerts(state).map((alert) => alert.id)).toEqual(["dirty"]);
    expect(getLienWaiverAlerts(state)[0].sectionId).toBe("details");
    expect(getLienWaiverChecklist(state).map((item) => item.state)).toEqual([
      "todo",
      "done",
      "todo",
      "warning",
    ]);

    expect(getLienWaiverAlerts({
      ...state,
      dirty: false,
      held: false,
    })).toEqual([
      expect.objectContaining({
        id: "unpaired",
        sectionId: "pairing",
        label: "No invoice paired",
        detail: "Pair the invoice it releases below, or hold it on the shelf to pair later.",
      }),
    ]);
  });
});
