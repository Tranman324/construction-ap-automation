import { describe, expect, it } from "vitest";

import type { DuplicateStatusResponse } from "@/modules/accounting/modules/invoices/types/api";
import {
  DUPLICATE_TITLE, duplicateArmedWarnings, duplicateColumns, duplicateContext, duplicateSentence,
} from "./duplicateCardCopy";
import { F_SPEC, F_STALE, F_SUB, F_TBX } from "./duplicateCardFixtures.testUtils";

function spectrumWith(source: string, invoiceNumber: string, amount: number): DuplicateStatusResponse {
  return { ...F_SPEC, spectrum: { source, invoiceNumber, vendorCode: "X", amount } };
}
function stale(originalDiscardedAt: string | null): DuplicateStatusResponse {
  return { ...F_STALE, evidence: { ...F_STALE.evidence!, originalDiscardedAt } };
}
const TAIL = "Bypassing lets it be approved and submitted a second time. Recorded under your name; restorable from Details.";

describe("duplicateSentence by bucket (CPY-01)", () => {
  it.each([
    ["OPEN_ITEMS", "Already posted in Spectrum — unpaid (open items). Confirm it there, then discard."],
    ["APPROVAL", "Already posted in Spectrum — awaiting approval. Confirm it there, then discard."],
    ["PAYMENT_HIST", "Already posted in Spectrum — paid. Confirm it there, then discard."],
  ])("spectrum record %s", (source, expected) => {
    expect(duplicateSentence(spectrumWith(source, "1", 1))).toBe(expected);
  });

  it("an unmapped source reads submitted from Toolbox with its capital T", () => {
    expect(duplicateSentence(spectrumWith("MYSTERY", "1", 1))).toBe("Already posted in Spectrum — submitted from Toolbox. Confirm it there, then discard.");
  });

  it("spectrum null and toolbox sentences", () => {
    expect(duplicateSentence(F_SUB)).toBe("Submitted to Spectrum from Toolbox. Confirm it there, then discard.");
    expect(duplicateSentence(F_TBX)).toBe("Another Toolbox document has this vendor and invoice number.");
    expect(duplicateSentence(undefined)).toBe("Another Toolbox document has this vendor and invoice number.");
  });
});

describe("duplicateArmedWarnings (CPY-02)", () => {
  it.each([
    ["OPEN_ITEMS", "25-907", 9642, "Already posted in Spectrum as #25-907 — unpaid (open items), $9,642.00. "],
    ["APPROVAL", "7310", 1500, "Already posted in Spectrum as #7310 — awaiting approval, $1,500.00. "],
    ["PAYMENT_HIST", "7310", 1500, "Already posted in Spectrum as #7310 — paid, $1,500.00. "],
  ])("spectrum record %s", (source, number, amount, head) => {
    expect(duplicateArmedWarnings(spectrumWith(source, number, amount)).bypass).toBe(`${head}${TAIL}`);
  });

  it("spectrum null record, toolbox and stale", () => {
    expect(duplicateArmedWarnings(F_SUB).bypass).toBe(`Already submitted to Spectrum from Toolbox as #53477 ($74,877.00). ${TAIL}`);
    expect(duplicateArmedWarnings(F_TBX)).toEqual({
      bypass: "Clears the duplicate flag. Recorded under your name; restorable from Details.",
      discard: "Discards this invoice. The original is not changed.",
    });
    expect(duplicateArmedWarnings(F_STALE)).toEqual({ bypass: "Clears the duplicate flag. Recorded under your name; restorable from Details." });
  });

  it("drops the number and amount clauses instead of printing placeholders", () => {
    const bare: DuplicateStatusResponse = { ...F_SPEC, spectrum: { source: "OPEN_ITEMS", invoiceNumber: null, vendorCode: null, amount: null } };
    expect(duplicateArmedWarnings(bare).bypass).toBe(`Already posted in Spectrum — unpaid (open items). ${TAIL}`);
  });
});

describe("duplicateContext (CPY-03)", () => {
  it("covers spectrum, toolbox loaded, original without number, not loaded and stale", () => {
    expect(duplicateContext(F_SPEC)).toBe("already posted in Spectrum");
    expect(duplicateContext(F_SUB)).toBe("already posted in Spectrum");
    expect(duplicateContext(F_TBX)).toBe("of 53477 in Toolbox");
    expect(duplicateContext({ ...F_TBX, original: { ...F_TBX.original!, invoiceNumber: null } })).toBe("in Toolbox");
    expect(duplicateContext(undefined)).toBe("in Toolbox");
    expect(duplicateContext(null)).toBe("in Toolbox");
    expect(duplicateContext(F_STALE)).toBe("the original was discarded");
  });
});

describe("stale sentence date (CPY-04, CPY-05)", () => {
  it("formats the date in UTC even when the local zone is behind", () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(new Date("2026-09-15T00:00:00.000Z").getDate()).toBe(14);
      const sentence = (iso: string) => duplicateSentence(stale(iso));
      const tail = " and has been purged. Nothing to open — bypass to clear the flag.";
      expect(sentence("2026-08-03T14:00:00.000Z")).toBe(`The copy this was flagged against was discarded on Aug 3, 2026${tail}`);
      expect(sentence("2026-09-14T16:12:00.000Z")).toBe(`The copy this was flagged against was discarded on Sep 14, 2026${tail}`);
      expect(sentence("2026-09-15T00:00:00.000Z")).toBe(`The copy this was flagged against was discarded on Sep 15, 2026${tail}`);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it.each([
    ["null", stale(null)],
    ["an unparsable string", stale("not-a-date")],
    ["missing evidence (undefined)", { ...F_STALE, evidence: null }],
  ])("drops the date clause for %s", (_label, status) => {
    const sentence = duplicateSentence(status);
    expect(sentence).toBe("The copy this was flagged against was discarded and has been purged. Nothing to open — bypass to clear the flag.");
    expect(sentence).not.toMatch(/Invalid Date|undefined|null|\s{2}/);
  });
});

describe("duplicateColumns (CPY-06)", () => {
  it("keeps the middle dot and capitalises the original status", () => {
    expect(duplicateColumns(F_SPEC)).toEqual(["This invoice", "In Spectrum · Unpaid (open items)"]);
    expect(duplicateColumns(F_SUB)).toEqual(["This invoice", "In Spectrum · Submitted from Toolbox"]);
    for (const [status, label] of [["approved", "Approved"], ["submitted", "Submitted"], ["pending", "Pending"]]) {
      expect(duplicateColumns({ ...F_TBX, original: { ...F_TBX.original!, status } })).toEqual(["This invoice", `Original · ${label}`]);
    }
  });
});

describe("every copy output (CPY-07)", () => {
  it("separates with an em dash only and keeps one title for all states", () => {
    const statuses = [F_SPEC, F_SUB, F_TBX, F_STALE, undefined, spectrumWith("APPROVAL", "7310", 1500), spectrumWith("PAYMENT_HIST", "7310", 1500)];
    const strings = statuses.flatMap((status) => [
      duplicateContext(status), duplicateSentence(status), ...duplicateColumns(status), ...Object.values(duplicateArmedWarnings(status)),
    ]);
    expect(strings.length).toBeGreaterThan(20);
    for (const text of strings) {
      expect(text).not.toMatch(/ - |--|–/);
      expect(text).not.toMatch(/undefined|null|NaN/);
    }
    expect(strings.some((text) => text.includes(" — "))).toBe(true);
    expect(DUPLICATE_TITLE).toBe("Possible duplicate");
  });
});
