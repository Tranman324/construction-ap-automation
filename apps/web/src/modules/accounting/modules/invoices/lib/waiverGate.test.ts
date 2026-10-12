import { describe, expect, it } from "vitest";

import { isManualWaiverLinkingAvailable, isWaiverGateBlocked } from "@/modules/accounting/modules/invoices/lib/waiverGate";

describe("isWaiverGateBlocked", () => {
  it("blocks an explicitly required invoice without a linked waiver or override", () => {
    expect(isWaiverGateBlocked({ lienWaiverRequired: true })).toBe(true);
  });

  it("passes when the required waiver is linked, detected on-document, or manually overridden", () => {
    expect(isWaiverGateBlocked({
      lienWaiverRequired: true,
      linkedLienWaiverId: "waiver-1",
    })).toBe(false);
    expect(isWaiverGateBlocked({
      lienWaiverRequired: true,
      lienWaiverStatus: "attached",
    })).toBe(false);
    expect(isWaiverGateBlocked({
      lienWaiverRequired: true,
      waiverOnDocument: true,
    })).toBe(false);
  });

  it("does not infer a requirement when the authoritative flag is absent", () => {
    expect(isWaiverGateBlocked({})).toBe(false);
    expect(isWaiverGateBlocked({ lienWaiverRequired: false })).toBe(false);
  });
});

describe("isManualWaiverLinkingAvailable", () => {
  it("keeps reverse pairing available when no canonical waiver state exists", () => {
    expect(isManualWaiverLinkingAvailable({})).toBe(true);
  });

  it("offers manual linking only for a required, unsatisfied canonical waiver state", () => {
    expect(isManualWaiverLinkingAvailable({ lienWaiverRequired: true })).toBe(true);
    expect(isManualWaiverLinkingAvailable({ lienWaiverRequired: false })).toBe(false);
    expect(isManualWaiverLinkingAvailable({ lienWaiverRequired: true, waiverOnDocument: true })).toBe(false);
  });
});
