import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  isResolveCardModel, type ResolveCardModel, type ResolveCarouselCard,
} from "./resolveCardModel";

/** The legacy member of the union, derived so the restricted `LegacyResolveCard` name is not imported outside the tray files. */
type LegacyCard = Exclude<ResolveCarouselCard, ResolveCardModel>;

const model: ResolveCardModel = {
  id: "duplicate", tone: "blocking", title: "Possible duplicate",
  actions: [{ id: "view", label: "View duplicate", emphasis: "secondary" }],
};
const legacy: LegacyCard = { id: "closed-period", label: "Closed period", content: createElement("span") };

function labelOf(card: ResolveCarouselCard): string {
  return isResolveCardModel(card) ? card.title : card.label;
}

describe("isResolveCardModel", () => {
  it("MD-01 accepts a model", () => {
    expect(isResolveCardModel(model)).toBe(true);
  });

  it("MD-02 rejects a legacy card", () => {
    expect(isResolveCardModel(legacy)).toBe(false);
  });

  it("MD-03 treats a legacy card as legacy even when content is undefined or null", () => {
    expect(isResolveCardModel({ id: "a", label: "A", content: undefined })).toBe(false);
    expect(isResolveCardModel({ id: "b", label: "B", content: null })).toBe(false);
  });

  it("MD-04 discriminates on content, never on tone (DocumentResolveTray spreads an alert with tone)", () => {
    const alert = { id: "alert", label: "Alert", tone: "warn" as const };
    const spread: LegacyCard = { ...alert, content: createElement("span") };
    expect(isResolveCardModel(spread)).toBe(false);
  });

  it("MD-05 narrows in both directions", () => {
    expect(labelOf(model)).toBe("Possible duplicate");
    expect(labelOf(legacy)).toBe("Closed period");
  });
});
