import { beforeAll, describe, expect, it } from "vitest";

import type { DuplicateStatusResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { ResolveCardModel } from "../documents/resolveCardModel";
import { APPR, DEL, F_SPEC, F_STALE, F_SUB, F_TBX, action, amountRow, build, built, ids, makeInvoice } from "./duplicateCardFixtures.testUtils";
import { hasUnresolvedDuplicate } from "./invoiceResolveModel";

const none: DuplicateStatusResponse = { ...F_TBX, state: "none", original: null, evidence: null };
const MEMBERSHIP: Array<[number, ReturnType<typeof makeInvoice>, DuplicateStatusResponse | null | undefined, boolean]> = [
  [1, makeInvoice(), undefined, true],
  [2, makeInvoice({ duplicateBypassed: true }), undefined, false],
  [3, makeInvoice({ duplicateOf: null }), undefined, false],
  [4, makeInvoice(), null, true],
  [5, makeInvoice(), none, false],
  [6, makeInvoice(), F_SPEC, true],
  [7, makeInvoice(), F_TBX, true],
  [8, makeInvoice(), F_STALE, true],
  [9, makeInvoice({ status: "approved" }), F_TBX, false],
  [10, makeInvoice({ status: "approved" }), undefined, false],
  [11, makeInvoice(), { ...none, bypassed: { at: "2026-08-01T00:00:00.000Z", by: "Jo" } }, false],
];

describe("membership (BLD-01, BLD-02)", () => {
  it.each(MEMBERSHIP)("row %i", (_row, invoice, status, expected) => {
    expect(build(invoice, status) !== null).toBe(expected);
  });
  it.each(MEMBERSHIP)("row %i agrees with the tray row rule", (_row, invoice, status) => {
    expect(build(invoice, status) !== null).toBe(hasUnresolvedDuplicate(invoice, status));
  });
});

describe("spectrum with a record (BLD-03)", () => {
  let model: ResolveCardModel;
  beforeAll(() => { model = built(F_SPEC); });
  it("carries the frame fields, copy and evidence", () => {
    expect(model).toMatchObject({
      id: "duplicate", tone: "blocking", title: "Possible duplicate", testid: "duplicate-resolution-card",
      context: "already posted in Spectrum", fallback: "Needs an approver",
      sentence: "Already posted in Spectrum — unpaid (open items). Confirm it there, then discard.",
      evidence: {
        layout: "compare", columns: ["This invoice", "In Spectrum · Unpaid (open items)"],
        rows: [
          { label: "Invoice #", a: { kind: "mono", value: "25-907", note: "→ 25907" }, b: { kind: "mono", value: "25-907" } },
          { label: "Amount", a: { kind: "money", value: 9642 }, b: { kind: "money", value: 9642 }, differs: false, testid: "duplicate-amounts" },
        ],
      },
      armedWarning: { bypass: "Already posted in Spectrum as #25-907 — unpaid (open items), $9,642.00. Bypassing lets it be approved and submitted a second time. Recorded under your name; restorable from Details." },
    });
    expect(model.evidence?.layout === "compare" && model.evidence.rows.map((r) => r.label)).toEqual(["Invoice #", "Amount"]);
  });
  it("orders Discard (dialog, primary) before Bypass (two-step, secondary)", () => {
    expect(ids(model)).toEqual(["discard", "bypass"]);
    expect(action(model, "discard")).toMatchObject({ label: "Discard", icon: "trash", emphasis: "primary", permission: DEL, confirm: "dialog", testid: "duplicate-discard" });
    expect(action(model, "bypass")).toMatchObject({ label: "Bypass", icon: "circle-off", emphasis: "secondary", permission: APPR, confirm: "two-step", testid: "duplicate-bypass" });
  });
});

describe("spectrum record plus a Toolbox original (TG-M2)", () => {
  it("offers no View duplicate link: the Spectrum hit is the match, not the Toolbox original", () => {
    const model = built({ ...F_SPEC, original: { id: "orig-1", status: "approved", amount: 74787, invoiceNumber: "53477", fileName: "VANT01_53477.pdf" } });
    expect(ids(model)).toEqual(["discard", "bypass"]);
    expect((model.actions ?? []).some((a) => "href" in a && a.href !== undefined)).toBe(false);
    expect(action(model, "discard")).toMatchObject({ emphasis: "primary", confirm: "dialog" });
  });
});

describe("spectrum without a record (BLD-04)", () => {
  let model: ResolveCardModel;
  beforeAll(() => { model = built(F_SUB); });
  it("uses the original's values and adds an outline View duplicate", () => {
    expect(model).toMatchObject({
      context: "already posted in Spectrum",
      sentence: "Submitted to Spectrum from Toolbox. Confirm it there, then discard.",
      armedWarning: { bypass: "Already submitted to Spectrum from Toolbox as #53477 ($74,877.00). Bypassing lets it be approved and submitted a second time. Recorded under your name; restorable from Details." },
      evidence: {
        columns: ["This invoice", "In Spectrum · Submitted from Toolbox"],
        rows: [
          { label: "Invoice #", a: { kind: "mono", value: "53477" }, b: { kind: "mono", value: "53477" } },
          { label: "Amount", a: { kind: "money", value: 74877 }, b: { kind: "money", value: 74877 }, differs: false },
          { label: "File", a: null, b: { kind: "mono", value: "VANT01_53477.pdf" } },
        ],
      },
    });
    expect(model.evidence?.layout === "compare" && model.evidence.rows[0].a).not.toHaveProperty("note");
    expect(ids(model)).toEqual(["discard", "view", "bypass"]);
    expect(action(model, "view")).toMatchObject({ label: "View duplicate", icon: "external-link", emphasis: "secondary" });
  });
});

describe("toolbox (BLD-05)", () => {
  let model: ResolveCardModel;
  beforeAll(() => { model = built(F_TBX); });
  it("flags the amount difference and orders View, Discard, Bypass", () => {
    expect(model).toMatchObject({
      context: "of 53477 in Toolbox",
      sentence: "Another Toolbox document has this vendor and invoice number.",
      armedWarning: {
        bypass: "Clears the duplicate flag. Recorded under your name; restorable from Details.",
        discard: "Discards this invoice. The original is not changed.",
      },
      evidence: {
        columns: ["This invoice", "Original · Approved"],
        rows: [
          { label: "Invoice #", a: { kind: "mono", value: "53-477", note: "→ 53477" }, b: { kind: "mono", value: "53477" } },
          { label: "Amount", a: { kind: "money", value: 74877 }, b: { kind: "money", value: 74787 }, differs: true, testid: "duplicate-amounts" },
          { label: "File", a: null, b: { kind: "mono", value: "VANT01_53477.pdf" } },
        ],
      },
    });
    expect(ids(model)).toEqual(["view", "discard", "bypass"]);
    expect(action(model, "view").emphasis).toBe("primary");
    expect(action(model, "discard")).toMatchObject({ emphasis: "secondary", permission: DEL, confirm: "two-step" });
    expect(action(model, "bypass")).toMatchObject({ emphasis: "secondary", permission: APPR, confirm: "two-step" });
  });
});

describe("stale (BLD-06)", () => {
  let model: ResolveCardModel;
  beforeAll(() => { model = built(F_STALE); });
  it("has no evidence and a single primary Bypass", () => {
    expect(model).toMatchObject({
      context: "the original was discarded",
      sentence: "The copy this was flagged against was discarded on Sep 14, 2026 and has been purged. Nothing to open — bypass to clear the flag.",
      armedWarning: { bypass: "Clears the duplicate flag. Recorded under your name; restorable from Details." },
    });
    expect(model.evidence).toBeUndefined();
    expect(ids(model)).toEqual(["bypass"]);
    expect(action(model, "bypass")).toMatchObject({ emphasis: "primary", permission: APPR, confirm: "two-step" });
  });
});

describe("status not loaded (BLD-07)", () => {
  it.each([[undefined], [null]])("falls back to a Toolbox card for %s without leaking the id", (status) => {
    const model = build(makeInvoice({ duplicateOf: "orig-id-77" }), status);
    expect(model).toMatchObject({ context: "in Toolbox", sentence: "Another Toolbox document has this vendor and invoice number." });
    expect(model?.evidence).toBeUndefined();
    expect(ids(model!)).toEqual(["view", "discard", "bypass"]);
    // The id belongs only in the View link target (HREF-03); no visible text carries it.
    expect(action(model!, "view")).toMatchObject({ href: "/accounting/invoices/orig-id-77" });
    expect(JSON.stringify({ ...model, actions: undefined })).not.toContain("orig-id-77");
  });
});

describe("amount mismatch threshold (BLD-08)", () => {
  function toolboxAmounts(ours: number | null, theirs: number | null): ResolveCardModel {
    return built({ ...F_TBX, evidence: { ...F_TBX.evidence!, amount: ours }, original: { ...F_TBX.original!, amount: theirs } });
  }
  it.each([
    [0.005, 0, true], [0.004, 0, false], [0.01, 0, true], [74877, 74787, true], [9642, 9642, false],
    [74877.004, 74877, false], [null, 5, false], [5, null, false],
  ])("ours %s vs theirs %s differs %s", (ours, theirs, expected) => {
    expect(amountRow(toolboxAmounts(ours, theirs))?.differs).toBe(expected);
  });
  it("matches the Spectrum amount first and falls through to the original", () => {
    const spectrum = (amount: number | null) => built({
      ...F_SPEC, evidence: { ...F_SPEC.evidence!, amount: 100 },
      spectrum: { ...F_SPEC.spectrum!, amount }, original: { ...F_TBX.original!, amount: 200 },
    });
    expect(amountRow(spectrum(100))).toMatchObject({ differs: false, b: { value: 100 } });
    expect(amountRow(spectrum(null))).toMatchObject({ differs: true, b: { value: 200 } });
  });
});
