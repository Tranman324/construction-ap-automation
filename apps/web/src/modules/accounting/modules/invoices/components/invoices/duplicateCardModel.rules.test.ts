import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { DuplicateStatusResponse } from "@/modules/accounting/modules/invoices/types/api";
import { buildSpectrumConfirmEvidence } from "./duplicateCardModel";
import { F_SPEC, F_STALE, F_SUB, F_TBX, action, build, built, ids, makeInvoice } from "./duplicateCardFixtures.testUtils";

describe("permissions and pending (BLD-09, BLD-10)", () => {
  it("keeps the delete and approve keys exact and gives View none", () => {
    for (const status of [F_SPEC, F_SUB, F_TBX, F_STALE]) {
      const model = built(status);
      for (const a of model.actions ?? []) {
        if (a.id === "discard") expect(a.permission).toBe("accounting.invoices.delete");
        if (a.id === "bypass") expect(a.permission).toBe("accounting.invoices.approve");
        if (a.id === "view") expect(a).not.toHaveProperty("permission");
      }
    }
  });
  it("marks the matching action pending with its label", () => {
    expect(action(built(F_TBX, { discardPending: true }), "discard")).toMatchObject({ pending: true, pendingLabel: "Discarding…" });
    expect(action(built(F_TBX, { bypassPending: true }), "bypass")).toMatchObject({ pending: true, pendingLabel: "Bypassing…" });
    const idle = built(F_TBX);
    for (const a of idle.actions ?? []) {
      expect(a).not.toHaveProperty("pending");
      expect(a).not.toHaveProperty("pendingLabel");
    }
    expect(action(built(F_TBX, { discardPending: true }), "bypass")).not.toHaveProperty("pending");
  });
});

describe("spectrum confirm evidence (BLD-11)", () => {
  it("is a compact Vendor, Invoice #, Amount compare with no File row", () => {
    const spec = buildSpectrumConfirmEvidence(F_SPEC);
    expect(spec.columns).toEqual(["This invoice", "In Spectrum · Unpaid (open items)"]);
    expect(spec.rows.map((r) => r.label)).toEqual(["Vendor", "Invoice #", "Amount"]);
    expect(spec.rows[0]).toMatchObject({ a: { value: "ZCON92" }, b: { value: "ZCON92" } });
    expect(spec.rows[2]).toMatchObject({ a: { value: 9642 }, b: { value: 9642 } });
    const sub = buildSpectrumConfirmEvidence(F_SUB);
    expect(sub.columns[1]).toBe("In Spectrum · Submitted from Toolbox");
    expect(sub.rows.map((r) => r.label)).toEqual(["Vendor", "Invoice #", "Amount"]);
    expect(sub.rows[0]).toMatchObject({ b: { value: "VANT01" } });
    expect(sub.rows[2]).toMatchObject({ a: { value: 74877 }, b: { value: 74877 } });
  });
});

describe("View duplicate is a link action to the original (HREF-03, BLD-12)", () => {
  const dupOf = (duplicateOf: string | null) => makeInvoice({ duplicateOf });

  it("links to the loaded original, ahead of the served duplicateOf (toolbox)", () => {
    const view = action(build(dupOf("served-id"), F_TBX)!, "view");
    expect(view).toMatchObject({ id: "view", label: "View duplicate", icon: "external-link", emphasis: "primary", href: "/accounting/invoices/orig-1" });
    for (const key of ["confirm", "permission", "pending", "disabled"]) expect(view).not.toHaveProperty(key);
  });

  it("falls back to duplicateOf in the toolbox when the status is not loaded", () => {
    for (const status of [undefined, null]) {
      expect(action(build(dupOf("served-id"), status)!, "view")).toMatchObject({ href: "/accounting/invoices/served-id" });
    }
  });

  it("links a Spectrum match with no Spectrum record to its Toolbox original, as a secondary action", () => {
    const view = action(build(dupOf("served-id"), F_SUB)!, "view");
    expect(view).toMatchObject({ emphasis: "secondary", href: "/accounting/invoices/orig-9" });
  });

  it("has no View when there is nothing to open", () => {
    expect(ids(built(F_SPEC))).toEqual(["discard", "bypass"]);
    expect(ids(build(dupOf("served-id"), F_STALE)!)).toEqual(["bypass"]);
    for (const a of built(F_SPEC).actions ?? []) expect(a).not.toHaveProperty("href");
    for (const a of built(F_STALE).actions ?? []) expect(a).not.toHaveProperty("href");
  });

  it("gives only the View action an href", () => {
    for (const status of [F_SPEC, F_TBX, F_SUB, F_STALE]) {
      for (const a of built(status).actions ?? []) expect("href" in a && a.href !== undefined).toBe(a.id === "view");
    }
  });
});

describe("purity (BLD-13)", () => {
  it.each(["duplicateCardModel.ts", "duplicateCardCopy.ts"])("%s has no clock, hooks, JSX or router", (file) => {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const pattern of [/Date\.now/, /new Date\(\)/, /\buse[A-Z]\w*\(/, /<[A-Z]\w*[ />]/, /useRouter/, /from "react"/]) {
      expect(text).not.toMatch(pattern);
    }
  });
});

describe("missing data (BLD-14)", () => {
  function strings(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (value && typeof value === "object") return Object.values(value).flatMap(strings);
    return [];
  }
  it("never prints null, NaN or undefined and degrades rows to empty values", () => {
    const bare: DuplicateStatusResponse = { ...F_SPEC, spectrum: { source: "OPEN_ITEMS", invoiceNumber: null, vendorCode: null, amount: null }, original: null, evidence: null };
    for (const status of [bare, { ...F_TBX, evidence: null }, { ...F_STALE, evidence: null }]) {
      const model = built(status);
      for (const text of strings(model)) expect(text).not.toMatch(/null|NaN|undefined/);
    }
    expect(built(bare).evidence).toMatchObject({ rows: [{ a: null, b: null }, { a: null, b: null, differs: false }] });
  });
});
