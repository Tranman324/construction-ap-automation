import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PANEL_SKELETON_SHAPES, PanelSkeleton, panelSkeletonTypeForClassification } from "./PanelSkeleton";

describe("PanelSkeleton", () => {
  it("keeps a shape contract for all nine panel types", () => {
    expect(Object.keys(PANEL_SKELETON_SHAPES)).toEqual([
      "invoice", "receipt", "statement", "coi", "w9", "lien-waiver", "subcontract", "warranty", "other",
    ]);
  });

  it("renders status, tabs, body, and footer in order", () => {
    render(<PanelSkeleton type="receipt" />);

    const panel = screen.getByTestId("panel-skeleton");
    expect([...panel.querySelectorAll("[data-panel-stage]")].map((node) => node.getAttribute("data-panel-stage")))
      .toEqual(["status", "tabs", "body", "footer"]);
    expect(panelSkeletonTypeForClassification("unknown-classification")).toBe("other");
  });
});
