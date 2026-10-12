/**
 * Compile-time contract for ResolveCardModel. Vitest does not type-check, so `npx tsc --noEmit` is the
 * arbiter: every `@ts-expect-error` below must be consumed (tsc reports TS2578 when a violation stops
 * being rejected), and the positive shapes must compile with no directive at all.
 */
import { describe, expect, it } from "vitest";
import {
  isResolveCardModel,
  type Action, type PrimaryAction, type ResolveCardModel,
  type ResolveCarouselCard, type SecondaryAction,
} from "./resolveCardModel";

/** The legacy member of the union, derived so the restricted `LegacyResolveCard` name is not imported outside the tray files. */
type LegacyCard = Exclude<ResolveCarouselCard, ResolveCardModel>;

const view: SecondaryAction = { id: "view", label: "View duplicate", icon: "external-link", emphasis: "secondary" };
const discardDialog: PrimaryAction = { id: "discard", label: "Discard", icon: "trash", emphasis: "primary", permission: "accounting.invoices.delete", confirm: "dialog" };
const discardTwoStep: SecondaryAction = { id: "discard", label: "Discard", icon: "trash", emphasis: "secondary", permission: "accounting.invoices.delete", confirm: "two-step", armedLabel: "Confirm discard" };
const bypass: SecondaryAction = { id: "bypass", label: "Bypass", icon: "circle-off", emphasis: "secondary", permission: "accounting.invoices.approve", confirm: "two-step" };
const bypassPrimary: PrimaryAction = { ...bypass, emphasis: "primary" };
const viewLink: PrimaryAction = { id: "view", label: "View duplicate", icon: "external-link", emphasis: "primary", href: "/accounting/invoices/orig-1" };
const viewLinkSecondary: SecondaryAction = { ...viewLink, emphasis: "secondary" };

// ---- TY-P: positive shapes (the four duplicate shapes, other primaries and positions) ----------------
const base = { id: "duplicate", tone: "blocking", title: "Possible duplicate", testid: "duplicate-resolution-card" } as const;
export const spectrumCard: ResolveCardModel = { ...base, actions: [discardDialog, bypass] };
export const spectrumSubmittedCard: ResolveCardModel = { ...base, actions: [discardDialog, view, bypass] };
export const toolboxCard: ResolveCardModel = {
  id: "duplicate", tone: "blocking", title: "Possible duplicate", actions: [{ ...view, emphasis: "primary" }, discardTwoStep, bypass],
  evidence: { layout: "compare", columns: ["This invoice", "Original · Approved"], rows: [
    { label: "Invoice #", a: { kind: "mono", value: "53-477", note: "→ 53477" }, b: { kind: "mono", value: "53477" } },
    { label: "Amount", a: { kind: "money", value: 74877 }, b: { kind: "money", value: 74787 }, differs: true, testid: "duplicate-amounts" },
    { label: "File", a: null, b: { kind: "mono", value: "VANT01_53477.pdf" } },
  ] },
  armedWarning: { bypass: "Clears the duplicate flag.", discard: "Discards this invoice." }, fallback: "Needs an approver",
};
export const linkCard: ResolveCardModel = { ...base, actions: [viewLink, discardTwoStep, bypass] };
export const linkSpectrumCard: ResolveCardModel = { ...base, actions: [discardDialog, viewLinkSecondary, bypass] };
export const staleCard: ResolveCardModel = { ...base, actions: [bypassPrimary] };
export const secondaryFirst: ResolveCardModel = { id: "s", tone: "blocking", title: "t", actions: [view, discardTwoStep, bypassPrimary] };
export const constActions: ResolveCardModel = { id: "c", tone: "failed", title: "t", actions: [discardDialog, view, bypass] as const };
export const oneAny: ResolveCardModel = { id: "o", tone: "blocking", title: "t", actions: [{ id: "p", label: "Go", emphasis: "primary" }] };
export const dateFact: ResolveCardModel = { id: "x", tone: "info", title: "t", evidence: { layout: "facts", rows: [{ label: "Discarded", value: { kind: "date", value: "2026-09-14T16:12:00Z" } }] } };
export const noActions: ResolveCardModel = { id: "n", tone: "waiting", title: "t", actions: [] };
const legacyWaiting: LegacyCard = { id: "w", label: "Waiting", waiting: true, content: null };
export const mixedCards: ResolveCarouselCard[] = [spectrumCard, legacyWaiting];

// ---- NEGATIVE CONTROLS: each violation must be rejected by tsc ---------------------------------------
export const twoPrimary: ResolveCardModel = {
  id: "bad", tone: "blocking", title: "t",
  // @ts-expect-error -- two primary actions must be rejected (at most one primary)
  actions: [discardDialog, bypassPrimary],
};
export const threeActionsTwoPrimary: ResolveCardModel = {
  id: "bad", tone: "blocking", title: "t",
  // @ts-expect-error -- three actions with two primaries must be rejected (at most one primary)
  actions: [discardDialog, view, bypassPrimary],
};
export const fourActions: ResolveCardModel = {
  id: "bad", tone: "blocking", title: "t",
  // @ts-expect-error -- a four-action tuple must be rejected (at most three actions)
  actions: [view, view, view, view],
};
const loose: Action[] = [view, bypass];
export const looseArray: ResolveCardModel = {
  id: "bad", tone: "blocking", title: "t",
  // @ts-expect-error -- a plain Action[] (unknown length) must be rejected; actions must be a literal tuple
  actions: loose,
};
export const moneyAsString: ResolveCardModel = {
  id: "bad", tone: "blocking", title: "t",
  // @ts-expect-error -- money value is a number, never a pre-formatted string
  evidence: { layout: "facts", rows: [{ label: "Amount", value: { kind: "money", value: "$74,877.00" } }] },
};
// @ts-expect-error -- armedLabel needs confirm: "two-step" (tsc reports on the declaration line for union targets)
export const armedLabelNoConfirm: Action = { id: "a", label: "A", emphasis: "secondary", armedLabel: "Confirm a" };
// @ts-expect-error -- dialog actions have no armedLabel
export const armedLabelDialog: Action = { id: "a", label: "A", emphasis: "secondary", confirm: "dialog", armedLabel: "Confirm a" };
export const warnTone: ResolveCardModel = {
  id: "t",
  // @ts-expect-error -- tone is blocking, failed, waiting or info; success notices are never cards
  tone: "warn", title: "t",
};
export const successTone: ResolveCardModel = {
  id: "t",
  // @ts-expect-error -- tone is blocking, failed, waiting or info; success notices are never cards
  tone: "success", title: "t",
};
export const badIcon: SecondaryAction = {
  id: "i", label: "I", emphasis: "secondary",
  // @ts-expect-error -- icon must be a ResolveIconName
  icon: "alert-octagon",
};
export const hrefWithTwoStep: SecondaryAction = {
  id: "v", label: "View duplicate", emphasis: "secondary", href: "/x",
  // @ts-expect-error -- href and confirm are mutually exclusive
  confirm: "two-step",
};
export const hrefWithDialog: PrimaryAction = {
  id: "v", label: "View duplicate", emphasis: "primary", href: "/x",
  // @ts-expect-error -- href and confirm are mutually exclusive
  confirm: "dialog",
};
// @ts-expect-error -- a link action cannot be disabled (tsc reports on the declaration line for union targets)
export const hrefDisabled: SecondaryAction = { id: "v", label: "View duplicate", emphasis: "secondary", href: "/x", disabled: true };
// @ts-expect-error -- a link action cannot be pending (tsc reports on the declaration line for union targets)
export const hrefPending: SecondaryAction = { id: "v", label: "View duplicate", emphasis: "secondary", href: "/x", pending: true };
export const hrefNotString: SecondaryAction = {
  id: "v", label: "View duplicate", emphasis: "secondary",
  // @ts-expect-error -- href is a string target
  href: 42,
};
export const modelWithContent: ResolveCardModel = {
  id: "bad", tone: "blocking", title: "t",
  // @ts-expect-error -- a model has no content (content?: never)
  content: null,
};
// A non-literal value that carries raw content must not be usable as a model: this is what `content?: never` buys
// (an object literal with `content` is rejected by the excess-property check even without it).
const hybrid = { id: "h", tone: "blocking" as const, title: "t", label: "l", content: null };
// @ts-expect-error -- a value carrying content is not a ResolveCardModel (content?: never)
export const hybridAsModel: ResolveCardModel = hybrid;

describe("resolveCardModel type contract (tsc is the arbiter)", () => {
  it("TY-P positive shapes are real models and the guard tells them from legacy cards", () => {
    expect([spectrumCard, spectrumSubmittedCard, toolboxCard, linkCard, linkSpectrumCard, staleCard, secondaryFirst, constActions, oneAny, dateFact, noActions].every(isResolveCardModel)).toBe(true);
    expect(isResolveCardModel(legacyWaiting)).toBe(false);
    expect(mixedCards.filter(isResolveCardModel)).toHaveLength(1);
    expect(spectrumCard.actions?.map((a) => a.id)).toEqual(["discard", "bypass"]);
    expect(toolboxCard.actions?.map((a) => a.emphasis)).toEqual(["primary", "secondary", "secondary"]);
    expect(linkCard.actions?.map((a) => a.href)).toEqual(["/accounting/invoices/orig-1", undefined, undefined]);
  });

  it("TY-01..11 the rejected fixtures still exist at runtime (the compile-time check is tsc's)", () => {
    const rejected = [hybridAsModel, twoPrimary, threeActionsTwoPrimary, fourActions, looseArray, moneyAsString, warnTone, successTone, modelWithContent];
    expect(rejected).toHaveLength(9);
    expect(armedLabelNoConfirm.armedLabel).toBe("Confirm a");
    expect(armedLabelDialog.confirm).toBe("dialog");
    expect(badIcon.icon).toBe("alert-octagon");
    expect([hrefWithTwoStep, hrefWithDialog, hrefDisabled, hrefPending, hrefNotString].every((a) => "href" in a)).toBe(true);
  });
});
