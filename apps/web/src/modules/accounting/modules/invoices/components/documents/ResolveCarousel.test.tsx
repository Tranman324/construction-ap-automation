import { fireEvent, render, screen } from "@testing-library/react";
import { within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PanelNotice, PanelNoticeProvider } from "./PanelNotice";
import { DocumentResolveTray } from "./DocumentResolveTray";
import motionStyles from "@/modules/shared/components/motion/ActionMotion.module.css";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findRawColors } from "@/test/rawColorScan";
import { ResolveCarousel } from "./ResolveCarousel";
import type { ResolveCardModel, ResolveCarouselCard, Tone } from "./resolveCardModel";

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasAnyPermission: () => true }),
}));

describe("unified resolve carousel", () => {
  it("omits a resolved-only tray entirely", () => {
    render(<PanelNoticeProvider documentId="A"><PanelNotice id="waiver" label="Not needed" resolved>Linking not needed</PanelNotice><DocumentResolveTray alerts={[]} /></PanelNoticeProvider>);
    expect(screen.queryByTestId("document-resolve-tray")).not.toBeInTheDocument();
    expect(screen.queryByText("Linking not needed")).not.toBeInTheDocument();
  });

  it("counts and cycles notices and domain cards as one list; dismissal does not call domain actions", () => {
    const resolve = vi.fn();
    render(<PanelNoticeProvider documentId="A">
      <PanelNotice id="overage" label="Overage" dismissible>Amount exceeds balance</PanelNotice>
      <PanelNotice id="resolved" label="Resolved" resolved>Linking not needed</PanelNotice>
      <DocumentResolveTray alerts={[
        { id: "duplicate", label: "Duplicate", tone: "warn", action: { id: "resolve", label: "Resolve duplicate", onClick: resolve } },
        { id: "waiver", label: "Waiting for waiver", tone: "info", waiting: true },
      ]} />
    </PanelNoticeProvider>);
    expect(screen.getByText("1 of 3")).toBeVisible();
    expect(screen.queryByText("Previous")).not.toBeInTheDocument();
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse tray" })).toBeInTheDocument();
    expect(screen.getByTestId("document-resolve-tray")).toHaveClass(motionStyles.resolveTray);
    expect(screen.getByText("Amount exceeds balance").closest("[data-panel-notice]")?.className).toContain("items-center");
    expect(screen.getByText("Amount exceeds balance")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Resolve duplicate" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next issue" }));
    expect(screen.getByText("2 of 3")).toBeVisible();
    expect(screen.getByText("Amount exceeds balance")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Resolve duplicate" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next issue" }));
    expect(screen.getByText("3 of 3")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next issue" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous issue" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous issue" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByText("1 of 2")).toBeVisible();
    expect(screen.queryByText("Amount exceeds balance")).not.toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("keeps the caret at the tray edge and inverts its direction when collapsed", () => {
    render(<PanelNoticeProvider documentId="A"><PanelNotice id="overage" label="Overage">Amount exceeds balance</PanelNotice><DocumentResolveTray alerts={[]} /></PanelNoticeProvider>);

    const collapseButton = screen.getByRole("button", { name: "Collapse tray" });
    expect(collapseButton.parentElement).toHaveClass("ml-auto");
    expect(collapseButton.querySelector("svg")).not.toHaveClass("rotate-180");

    fireEvent.click(collapseButton);

    const expandButton = screen.getByRole("button", { name: "Expand tray" });
    expect(expandButton.parentElement).toHaveClass("ml-auto");
    expect(expandButton.querySelector("svg")).toHaveClass("rotate-180");
  });

  it("retains dismissal during refresh, reopens on changed evidence, and resets for a new review", () => {
    function Review({ revision = "100:0" }: { revision?: string }) {
      return <PanelNoticeProvider documentId="A"><PanelNotice id="overage" label="Overage" dismissible revision={revision}>Warning</PanelNotice><DocumentResolveTray alerts={[]} /></PanelNoticeProvider>;
    }
    const view = render(<Review />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    view.rerender(<Review />);
    expect(screen.queryByTestId("document-resolve-tray")).not.toBeInTheDocument();
    view.rerender(<Review revision="200:0" />);
    expect(screen.getByText("Warning")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    view.unmount();
    render(<Review revision="200:0" />);
    expect(screen.getByText("Warning")).toBeVisible();
  });

  it("shows only the actionable closed-period equivalent when a resolved notice accompanies it", () => {
    render(<PanelNoticeProvider documentId="A"><PanelNotice id="resolved" label="Not needed" resolved>Linking not needed</PanelNotice><DocumentResolveTray alerts={[{ id: "period", label: "Closed period", tone: "warn", action: { id: "use-date", label: "Use date", onClick: vi.fn() } }]} /></PanelNoticeProvider>);
    expect(screen.getByText("1 of 1")).toBeVisible();
    expect(screen.queryByText("Linking not needed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });
});

const model = (id: string, tone: Tone): ResolveCardModel => ({ id, tone, title: `Title ${id}`, sentence: `Sentence ${id}` });
const legacy = (id: string, waiting?: boolean): ResolveCarouselCard => ({ id, label: `Label ${id}`, waiting, content: <p>{`Legacy ${id}`}</p> });
const lwUnsaved: ResolveCardModel = {
  id: "lw-unsaved", tone: "blocking", title: "Unsaved details",
  actions: [{ id: "save", label: "Save", icon: "save", emphasis: "primary" }],
};
const shellOf = (testId: string) => screen.getByTestId(testId).querySelector("[data-tone]");
// createElement, not JSX: lint allows `<ResolveCarousel>` JSX only in the two tray files, and this test drives the carousel directly.
const tray = (cards: readonly ResolveCarouselCard[], testId: "invoice-resolve-tray" | "document-resolve-tray" = "invoice-resolve-tray") =>
  createElement(ResolveCarousel, { cards, testId });

describe("resolve carousel with model cards", () => {
  it.each<Tone>(["blocking", "failed", "waiting", "info"])("CAR-01 a lone %s model card sets the tray shell tone", (tone) => {
    render(tray([model("only", tone)]));
    expect(shellOf("invoice-resolve-tray")).toHaveAttribute("data-tone", tone);
  });

  it("CAR-02 a legacy card or a panel notice at the front yields the blocking tone", () => {
    const first = render(tray([legacy("old"), model("later", "failed")]));
    expect(shellOf("invoice-resolve-tray")).toHaveAttribute("data-tone", "blocking");
    first.unmount();
    render(<PanelNoticeProvider documentId="A"><PanelNotice id="overage" label="Overage">Amount exceeds balance</PanelNotice>{tray([model("later", "failed")])}</PanelNoticeProvider>);
    expect(screen.getByText("1 of 2")).toBeVisible();
    expect(shellOf("invoice-resolve-tray")).toHaveAttribute("data-tone", "blocking");
  });

  it("CAR-03 the tray tone follows the selected card", () => {
    render(tray([model("a", "blocking"), model("b", "failed")]));
    expect(shellOf("invoice-resolve-tray")).toHaveAttribute("data-tone", "blocking");
    fireEvent.click(screen.getByRole("button", { name: "Next issue" }));
    expect(shellOf("invoice-resolve-tray")).toHaveAttribute("data-tone", "failed");
    fireEvent.click(screen.getByRole("button", { name: "Previous issue" }));
    expect(shellOf("invoice-resolve-tray")).toHaveAttribute("data-tone", "blocking");
  });

  it("CAR-04 the waiting chip counts waiting models and waiting legacy cards", () => {
    render(tray([model("w", "waiting"), model("b", "blocking"), legacy("lw", true), legacy("ln", false), model("f", "failed")]));
    const header = screen.getByTestId("resolve-tray-header").parentElement as HTMLElement;
    expect(within(header).getByText(/waiting/)).toHaveTextContent("2 waiting");
  });

  it("CAR-05 no waiting chip without waiting cards", () => {
    render(tray([model("b", "blocking"), legacy("ln", false)]));
    const header = screen.getByTestId("resolve-tray-header").parentElement as HTMLElement;
    expect(within(header).queryByText(/waiting/)).toBeNull();
  });

  it("CAR-06 model cards get no legacy wrapper chrome; legacy cards keep it on rc tokens", () => {
    render(tray([model("m", "blocking"), legacy("l")]));
    const modelWrapper = screen.getByText("Title m").closest("[data-waiting]") as HTMLElement;
    expect(modelWrapper).toHaveClass("mx-2.5", "mb-2.5");
    expect(modelWrapper).not.toHaveClass("border", "rounded-[10px]", "bg-card", "px-[13px]", "py-2.5");
    fireEvent.click(screen.getByRole("button", { name: "Next issue" }));
    const legacyWrapper = screen.getByText("Legacy l").closest("[data-waiting]") as HTMLElement;
    expect(legacyWrapper).toBeVisible();
    expect(legacyWrapper).toHaveClass("mx-2.5", "mb-2.5", "rounded-[10px]", "border", "bg-card", "px-[13px]", "py-2.5", "text-xs");
    expect(legacyWrapper.className).not.toMatch(/amber/);
  });

  it("CAR-07 onAction receives the card id and the action id", () => {
    const onAction = vi.fn();
    render(createElement(ResolveCarousel, { cards: [lwUnsaved], testId: "invoice-resolve-tray", onAction }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("lw-unsaved", "save");
  });

  it("CAR-08 keeps the tray test ids, header text, count, pager and collapse controls", () => {
    for (const [testId, headerId, cards] of [
      ["invoice-resolve-tray", "resolve-tray-header", [model("m", "blocking")]],
      ["document-resolve-tray", "document-resolve-tray-header", [legacy("l")]],
    ] as const) {
      const view = render(tray(cards, testId));
      expect(screen.getByTestId(testId).tagName).toBe("ASIDE");
      expect(screen.getByTestId(headerId)).toHaveTextContent("To resolve 1");
      expect(screen.getByTestId("resolve-tray-count")).toHaveTextContent("1");
      expect(screen.getByRole("navigation", { name: "Issue cards" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Previous issue" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Next issue" })).toBeInTheDocument();
      expect(screen.getByText("1 of 1")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Collapse tray" }));
      expect(screen.getByRole("button", { name: "Expand tray" })).toBeInTheDocument();
      view.unmount();
    }
  });

  it("CAR-09 ResolveCarousel.tsx has no raw colors or palette classes", () => {
    expect(findRawColors(readFileSync(join(__dirname, "ResolveCarousel.tsx"), "utf8"))).toEqual([]);
  });

  it("CAR-10 shell, header, count pill and waiting chip use rc tokens", () => {
    render(tray([model("w", "waiting")]));
    expect(shellOf("invoice-resolve-tray")).toHaveClass("border-rc-line", "bg-rc-wash");
    const header = screen.getByTestId("resolve-tray-header").parentElement as HTMLElement;
    expect(header).toHaveClass("text-rc-ink");
    expect(within(header).getByText("1")).toHaveClass("bg-rc-tint");
    expect(within(header).getByText("1 waiting")).toHaveClass("bg-rc-waiting-tint", "text-rc-waiting-ink");
  });

  it("CAR-10b the translucent tone wash sits on an opaque surface and an opaque gutter for every tone", () => {
    for (const tone of ["blocking", "failed", "waiting", "info"] as const) {
      const view = render(tray([model(tone, tone)]));
      const aside = screen.getByTestId("invoice-resolve-tray");
      const surface = screen.getByTestId("resolve-tray-surface");
      expect(aside).toHaveClass("bg-background");
      expect(surface.parentElement).toBe(aside);
      expect(surface).toHaveClass("bg-card", "rounded-xl");
      expect(shellOf("invoice-resolve-tray")?.parentElement).toBe(surface);
      expect(shellOf("invoice-resolve-tray")).toHaveAttribute("data-tone", tone);
      view.unmount();
    }
    // Both surfaces resolve to solid 6-digit hex (no alpha) in light and dark themes.
    const css = readFileSync(join(__dirname, "../../../../../../app/globals.css"), "utf8");
    expect(css).toMatch(/:root \{[^}]*--background: #F8FAFC;[^}]*--card: #ffffff;/);
    expect(css).toMatch(/\.dark \{[^}]*--background: #0F172A;[^}]*--card: #1E293B;/);
  });

  it("CAR-10c a legacy notice card is info on the tray and the card; other legacy cards stay blocking", () => {
    render(tray([{ ...legacy("n"), notice: true }, legacy("b")], "document-resolve-tray"));
    expect(shellOf("document-resolve-tray")).toHaveAttribute("data-tone", "info");
    expect(screen.getByText("Legacy n").closest("[data-tone]")).toHaveAttribute("data-tone", "info");
    expect(screen.getByTestId("document-resolve-tray-header")).toHaveTextContent("To resolve 2");
    fireEvent.click(screen.getByRole("button", { name: "Next issue" }));
    expect(shellOf("document-resolve-tray")).toHaveAttribute("data-tone", "blocking");
    expect(screen.getByText("Legacy b").closest("[data-tone]")).toHaveAttribute("data-tone", "blocking");
  });

  it("FIX5-4 the invoice tray always reads To resolve, even for a notice-flagged card", () => {
    render(tray([{ ...legacy("n"), notice: true }], "invoice-resolve-tray"));
    expect(screen.getByTestId("resolve-tray-header")).toHaveTextContent(/^To resolve 1$/);
  });

  it("CAR-11 accepts a mixed readonly union and rejects a card that is neither kind", () => {
    const mixed: readonly ResolveCarouselCard[] = [model("m", "info"), legacy("l")];
    // @ts-expect-error -- neither a model (no tone/title) nor a legacy card (no content)
    const neither: ResolveCarouselCard = { id: "x", label: "y" };
    expect(mixed).toHaveLength(2);
    expect(neither.id).toBe("x");
  });
});
