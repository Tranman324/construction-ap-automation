import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findRawColors } from "@/test/rawColorScan";
import { ResolveCardActions } from "./ResolveCardActions";
import type { Actions, PrimaryAction } from "./resolveCardModel";

const perm = vi.hoisted(() => ({ granted: new Set<string>(), admin: false }));
vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: (keys: string[]) => perm.admin || keys.some((key) => perm.granted.has(key)),
  }),
}));

const DEL = "accounting.invoices.delete";
const APPR = "accounting.invoices.approve";

const toolbox: Actions = [
  { id: "view", label: "View duplicate", icon: "external-link", emphasis: "primary" },
  { id: "discard", label: "Discard", icon: "trash", emphasis: "secondary", confirm: "two-step", permission: DEL },
  { id: "bypass", label: "Bypass", icon: "circle-off", emphasis: "secondary", confirm: "two-step", permission: APPR },
];
const spectrum: Actions = [
  { id: "discard", label: "Discard", emphasis: "primary", confirm: "dialog", permission: DEL },
  { id: "bypass", label: "Bypass", emphasis: "secondary", confirm: "two-step", permission: APPR },
];
const stale: Actions = [{ id: "bypass", label: "Bypass", emphasis: "primary", confirm: "two-step", permission: APPR }];
const FALLBACK = "Needs an approver";

const names = () => screen.queryAllByRole("button").map((b) => b.textContent);

beforeEach(() => {
  perm.granted = new Set();
  perm.admin = false;
});

describe("ResolveCardActions permissions", () => {
  it.each([
    [[], ["View duplicate"]],
    [[DEL], ["View duplicate", "Discard"]],
    [[APPR], ["View duplicate", "Bypass"]],
    [[DEL, APPR], ["View duplicate", "Discard", "Bypass"]],
  ] as const)("ACT-01 toolbox with %j shows %j and removes the rest from the DOM", (granted, expected) => {
    perm.granted = new Set(granted);
    render(<ResolveCardActions tone="blocking" actions={toolbox} fallback={FALLBACK} />);
    expect(names()).toEqual(expected);
    const shown: readonly string[] = expected;
    if (!shown.includes("Discard")) expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
    if (!shown.includes("Bypass")) expect(screen.queryByRole("button", { name: "Bypass" })).toBeNull();
    expect(screen.queryByText(FALLBACK)).toBeNull();
  });

  it.each([
    [[], []],
    [[DEL], ["Discard"]],
    [[APPR], ["Bypass"]],
    [[DEL, APPR], ["Discard", "Bypass"]],
  ] as const)("ACT-02 spectrum with %j shows %j", (granted, expected) => {
    perm.granted = new Set(granted);
    render(<ResolveCardActions tone="blocking" actions={spectrum} fallback={FALLBACK} />);
    expect(names()).toEqual(expected);
    if (expected.length === 0) expect(screen.getByText(FALLBACK)).toBeInTheDocument();
    else expect(screen.queryByText(FALLBACK)).toBeNull();
  });

  it("ACT-03 a stale tuple shows the fallback and no button without approve, Bypass with it, never a link", () => {
    const { unmount } = render(<ResolveCardActions tone="blocking" actions={stale} fallback={FALLBACK} />);
    expect(screen.getByText(FALLBACK)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    perm.granted = new Set([APPR]);
    render(<ResolveCardActions tone="blocking" actions={stale} fallback={FALLBACK} />);
    expect(names()).toEqual(["Bypass"]);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("ACT-04 without a configured fallback an empty slot renders nothing and does not throw", () => {
    const { container } = render(<ResolveCardActions tone="blocking" actions={spectrum} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(FALLBACK)).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("ACT-05 the fallback is 11.5px/500 muted", () => {
    render(<ResolveCardActions tone="blocking" actions={spectrum} fallback={FALLBACK} />);
    expect(screen.getByText(FALLBACK)).toHaveClass("text-[11.5px]", "font-medium", "text-muted-foreground");
  });

  it("ACT-06 an admin (every key allowed) sees all three toolbox buttons", () => {
    perm.admin = true;
    render(<ResolveCardActions tone="blocking" actions={toolbox} />);
    expect(names()).toEqual(["View duplicate", "Discard", "Bypass"]);
  });

  it("BTN-07 buttons are the shared ghost/sm Button with the press feel restored", () => {
    render(<ResolveCardActions tone="blocking" actions={[toolbox[0]]} />);
    const button = screen.getByRole("button", { name: "View duplicate" });
    expect(button).toHaveAttribute("data-slot", "button");
    expect(button).toHaveAttribute("data-variant", "ghost");
    expect(button).toHaveAttribute("data-size", "sm");
    expect(button).toHaveAttribute("data-press", "true");
  });

  it("restyles the button to the design size and reports a plain click once", async () => {
    const onAction = vi.fn();
    render(<ResolveCardActions tone="failed" actions={[{ id: "save", label: "Save", emphasis: "secondary", testid: "save-btn" }]} onAction={onAction} />);
    const button = screen.getByTestId("save-btn");
    expect(button).toHaveClass("h-[28px]", "rounded-[8px]", "px-[11px]", "text-[12px]", "font-semibold", "gap-[5px]");
    await userEvent.click(button);
    expect(onAction).toHaveBeenCalledExactlyOnceWith("save");
  });

  describe("link actions (href)", () => {
    const ORIG = "/accounting/invoices/orig-1";
    const viewLink: PrimaryAction = { id: "view", label: "View duplicate", icon: "external-link", emphasis: "primary", href: ORIG, testid: "duplicate-view" };
    const link: Actions = [viewLink];
    /** One action of the given emphasis, as a link or as a plain button action (the tuple types need the emphasis literal). */
    const single = (emphasis: "primary" | "secondary", href?: string): Actions => {
      const base = href === undefined ? { id: "go", label: "Go" } : { id: "view", label: "Open", href };
      return emphasis === "primary" ? [{ ...base, emphasis }] : [{ ...base, emphasis }];
    };

    it("HREF-01 renders a real link to the target, not a button, and a click never reports an action", async () => {
      const onAction = vi.fn();
      render(<ResolveCardActions tone="blocking" actions={link} onAction={onAction} />);
      const anchor = screen.getByRole("link", { name: "View duplicate" });
      expect(anchor.tagName).toBe("A");
      expect(anchor).toHaveAttribute("href", ORIG);
      expect(anchor).toHaveAttribute("data-slot", "button");
      expect(anchor).toHaveAttribute("data-testid", "duplicate-view");
      expect(anchor.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      expect(screen.queryByRole("button")).toBeNull();
      await userEvent.click(anchor);
      expect(onAction).not.toHaveBeenCalled();
    });

    it.each([["blocking", "primary"], ["blocking", "secondary"], ["failed", "primary"], ["info", "secondary"]] as const)(
      "HREF-02 %s %s: the link carries the same class string and press feel as a button action",
      (tone, emphasis) => {
        const withLink = render(<ResolveCardActions tone={tone} actions={single(emphasis, ORIG)} />);
        const withButton = render(<ResolveCardActions tone={tone} actions={single(emphasis)} />);
        const anchor = withLink.getByRole("link", { name: "Open" });
        const button = withButton.getByRole("button", { name: "Go" });
        expect(anchor.className).toBe(button.className);
        expect(anchor).toHaveAttribute("data-press", button.getAttribute("data-press"));
        expect(anchor).toHaveAttribute("data-variant", "ghost");
        expect(anchor).toHaveAttribute("data-size", "sm");
      },
    );

    it("HREF-02 the blocking primary link has the amber solid and design size literals", () => {
      render(<ResolveCardActions tone="blocking" actions={link} />);
      expect(screen.getByRole("link", { name: "View duplicate" })).toHaveClass(
        "h-[28px]", "rounded-[8px]", "px-[11px]", "text-[12px]", "font-semibold", "bg-rc-blocking-solid", "text-rc-blocking-solid-fg", "hover:bg-rc-blocking-solid-hover",
      );
    });

    it("a link action is permission-filtered like any action, and the fallback shows when it is the only one", () => {
      const gated: Actions = [{ id: "view", label: "View duplicate", emphasis: "primary", href: ORIG, permission: APPR }];
      const { unmount } = render(<ResolveCardActions tone="blocking" actions={gated} fallback={FALLBACK} />);
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText(FALLBACK)).toBeInTheDocument();
      unmount();
      perm.granted = new Set([APPR]);
      render(<ResolveCardActions tone="blocking" actions={gated} fallback={FALLBACK} />);
      expect(screen.getByRole("link", { name: "View duplicate" })).toHaveAttribute("href", ORIG);
    });

    it("a link sits among button actions in order and only the buttons report clicks", async () => {
      perm.admin = true;
      const onAction = vi.fn();
      const mixed: Actions = [viewLink, { id: "discard", label: "Discard", emphasis: "secondary", confirm: "dialog" }];
      const { container } = render(<ResolveCardActions tone="blocking" actions={mixed} onAction={onAction} />);
      expect([...container.querySelectorAll("a, button")].map((e) => e.textContent)).toEqual(["View duplicate", "Discard"]);
      await userEvent.click(screen.getByRole("link", { name: "View duplicate" }));
      await userEvent.click(screen.getByRole("button", { name: "Discard" }));
      expect(onAction).toHaveBeenCalledExactlyOnceWith("discard");
    });
  });

  it("BTN-08 sources contain no raw colors", () => {
    for (const file of ["ResolveCardActions.tsx", "resolveCardButtonClass.ts", "useTwoStepArm.ts"]) {
      expect(findRawColors(readFileSync(join(__dirname, file), "utf8")), file).toEqual([]);
    }
  });
});
