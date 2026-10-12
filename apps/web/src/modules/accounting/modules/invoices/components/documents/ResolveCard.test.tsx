import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { findRawColors } from "@/test/rawColorScan";
import { ResolveCard, type ResolveCardProps } from "./ResolveCard";
import type { ResolveCardModel, Tone } from "./resolveCardModel";

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasAnyPermission: () => true }),
}));

const toolbox: ResolveCardModel = {
  id: "duplicate",
  tone: "blocking",
  title: "Possible duplicate",
  testid: "duplicate-resolution-card",
  context: "of 53477 in Toolbox",
  sentence: "Another Toolbox document has this vendor and invoice number.",
  actions: [
    { id: "view", label: "View duplicate", icon: "external-link", emphasis: "primary" },
    { id: "discard", label: "Discard", icon: "trash", emphasis: "secondary", confirm: "two-step" },
    { id: "bypass", label: "Bypass", icon: "circle-off", emphasis: "secondary", confirm: "two-step" },
  ],
  armedWarning: { bypass: "Clears the duplicate flag. Recorded under your name; restorable from Details." },
};
const lwUnsaved: ResolveCardModel = {
  id: "lw-unsaved", tone: "blocking", title: "Unsaved details",
  actions: [{ id: "save", label: "Save", icon: "save", emphasis: "primary" }],
};

describe("ResolveCard", () => {
  it("CARD-01 exposes kind, tone, test id, title, context and sentence", () => {
    render(<ResolveCard model={toolbox} />);
    const root = screen.getByTestId("duplicate-resolution-card");
    expect(root).toHaveAttribute("data-tone", "blocking");
    expect(root).toHaveAttribute("data-resolve-kind", "duplicate");
    expect(within(root).getByText("Possible duplicate")).toBeInTheDocument();
    expect(within(root).getByText(/^· /)).toHaveTextContent("· of 53477 in Toolbox");
    expect(within(root).getByText("Another Toolbox document has this vendor and invoice number.")).toBeInTheDocument();
  });

  it.each([
    ["blocking", "lucide-triangle-alert"],
    ["failed", "lucide-circle-alert"],
    ["waiting", "lucide-mail"],
    ["info", "lucide-info"],
  ] as const satisfies readonly (readonly [Tone, string])[])("CARD-02 %s tone sets data-tone and its icon", (tone, iconClass) => {
    const { container } = render(<ResolveCard model={{ id: `t-${tone}`, tone, title: "T" }} />);
    expect(container.firstElementChild).toHaveAttribute("data-tone", tone);
    const icon = container.querySelector("svg");
    expect(icon).toHaveClass(iconClass);
    expect(icon).toHaveAttribute("width", "14");
    expect(icon?.parentElement).toHaveClass("text-rc-icon");
  });

  it("CARD-08 compact card renders no sentence, evidence or context separator", () => {
    const { container } = render(<ResolveCard model={lwUnsaved} />);
    expect(screen.getByText("Unsaved details")).toBeInTheDocument();
    expect(container.querySelector("p")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(container.querySelector("dl")).toBeNull();
    expect(container).not.toHaveTextContent("·");
  });

  it("CARD-09 sentence-only model renders the sentence and a labelled action", () => {
    render(<ResolveCard model={{ id: "lw-unpaired", tone: "blocking", title: "No invoice paired", sentence: "Pair this waiver with the invoice it releases.", actions: [{ id: "pair", label: "Pair invoice", icon: "link", emphasis: "primary" }] }} />);
    expect(screen.getByText("Pair this waiver with the invoice it releases.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pair invoice" })).toBeInTheDocument();
  });

  it("CARD-10 three actions share the head row with a long title", async () => {
    const onAction = vi.fn();
    const long = { ...toolbox, title: "A very long title that would otherwise push the actions onto their own line" };
    render(<ResolveCard model={long} onAction={onAction} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["View duplicate", "Discard", "Bypass"]);
    const head = screen.getByText(long.title).closest("div")?.parentElement;
    expect(head).toContainElement(buttons[0]);
    expect(head).toHaveClass("flex-wrap");
    await userEvent.click(buttons[0]);
    expect(onAction).toHaveBeenCalledExactlyOnceWith("view");
  });

  it("shows the fallback instead of actions when there are none", () => {
    render(<ResolveCard model={{ id: "dup", tone: "blocking", title: "Possible duplicate", fallback: "Needs an approver" }} />);
    expect(screen.getByText("Needs an approver")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("CARD-11 keeps the armed warning out of the DOM until an action arms", () => {
    render(<ResolveCard model={toolbox} />);
    expect(screen.getByText("Another Toolbox document has this vendor and invoice number.")).toBeInTheDocument();
    expect(screen.queryByText(/Clears the duplicate flag/)).toBeNull();
  });

  it("arming an action swaps the sentence for its armed warning in ink/500, and a second click restores it", async () => {
    const onAction = vi.fn();
    render(<ResolveCard model={toolbox} onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: "Bypass" }));
    const warning = screen.getByText(/Clears the duplicate flag/);
    expect(warning).toHaveClass("text-rc-ink", "font-medium");
    expect(screen.queryByText("Another Toolbox document has this vendor and invoice number.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Confirm bypass" }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith("bypass");
    expect(screen.getByText("Another Toolbox document has this vendor and invoice number.")).toBeInTheDocument();
    expect(screen.queryByText(/Clears the duplicate flag/)).toBeNull();
  });

  it("a changed armed warning disarms the action and restores the sentence without firing (M1)", async () => {
    const onAction = vi.fn();
    const view = render(<ResolveCard model={toolbox} onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: "Bypass" }));
    expect(screen.getByText(/Clears the duplicate flag/)).toBeInTheDocument();
    const stronger = "Already posted in Spectrum. Clears the flag only on your say-so.";
    view.rerender(<ResolveCard model={{ ...toolbox, armedWarning: { bypass: stronger } }} onAction={onAction} />);
    expect(screen.queryByText(stronger)).toBeNull();
    expect(screen.getByText("Another Toolbox document has this vendor and invoice number.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bypass" })).toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("an armed action without a matching warning keeps the sentence; a string warning applies to any action", async () => {
    const first = render(<ResolveCard model={toolbox} />);
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByText("Another Toolbox document has this vendor and invoice number.")).toBeInTheDocument();
    first.unmount();
    render(<ResolveCard model={{ ...toolbox, armedWarning: "Are you sure?" }} />);
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
  });

  it("CARD-12/13 accept no className or style (type controls)", () => {
    const withClass: ResolveCardProps = {
      model: lwUnsaved,
      // @ts-expect-error -- ResolveCard accepts no className
      className: "x",
    };
    const withStyle: ResolveCardProps = {
      model: lwUnsaved,
      // @ts-expect-error -- ResolveCard accepts no style
      style: { color: "red" },
    };
    expect(withClass.model.id).toBe(withStyle.model.id);
  });

  it("frame classes match the design values", () => {
    const { container } = render(<ResolveCard model={toolbox} />);
    const root = container.firstElementChild;
    expect(root).toHaveClass("rounded-[10px]", "border", "border-rc-line", "bg-card", "px-3", "py-2.5", "gap-2", "flex-col");
    const head = screen.getByText("Possible duplicate").closest("div")?.parentElement;
    expect(head).toHaveClass("flex-wrap", "gap-x-2.5", "gap-y-1.5", "items-center");
    expect(screen.getByText("Possible duplicate").closest("div")).toHaveClass("flex-[1_1_240px]", "min-w-0", "gap-[7px]");
    expect(screen.getByText("Possible duplicate")).toHaveClass("text-[12.5px]", "font-semibold", "whitespace-nowrap", "text-foreground");
    expect(screen.getByText(/^· /)).toHaveClass("text-xs", "font-medium", "text-muted-foreground", "truncate");
    expect(screen.getByText(/^Another Toolbox/)).toHaveClass("text-xs", "leading-[1.45]", "text-muted-foreground");
  });

  it("CARD-14 sources contain no raw colors", () => {
    for (const file of ["ResolveCard.tsx", "ResolveCardEvidence.tsx", "ResolveCardActions.tsx"]) {
      const source = readFileSync(join(__dirname, file), "utf8");
      expect(findRawColors(source), file).toEqual([]);
    }
  });
});
