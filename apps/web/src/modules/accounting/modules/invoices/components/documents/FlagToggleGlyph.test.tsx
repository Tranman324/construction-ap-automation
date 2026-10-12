import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FlagToggleGlyph } from "@/modules/accounting/modules/invoices/components/documents/FlagToggleGlyph";

const TM = vi.hoisted(() => ({
  flag: vi.fn(),
  unflag: vi.fn(),
  flagPending: false,
  unflagPending: false,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useFlagDocument: () => ({ mutate: TM.flag, isPending: TM.flagPending }),
  useUnflagDocument: () => ({ mutate: TM.unflag, isPending: TM.unflagPending }),
}));

vi.mock("@/modules/shared/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => children,
}));

beforeEach(() => {
  TM.flag.mockReset();
  TM.unflag.mockReset();
  TM.flagPending = false;
  TM.unflagPending = false;
});

describe("FlagToggleGlyph", () => {
  it("shows a pressed (flagged) glyph iff flaggedAt is set — never the legacy boolean", () => {
    const { rerender } = render(
      <FlagToggleGlyph record={{ id: "d", flaggedAt: "2026-07-22T00:00:00.000Z", flagReason: null, flaggedBy: null }} />,
    );
    expect(screen.getByRole("button", { name: "Remove review flag" })).toHaveAttribute("aria-pressed", "true");

    rerender(<FlagToggleGlyph record={{ id: "d", flaggedAt: null, flagReason: null, flaggedBy: null }} />);
    expect(screen.getByRole("button", { name: "Flag for review" })).toHaveAttribute("aria-pressed", "false");
  });

  it("flags an unflagged document with one click (no reason arg) and no toast", async () => {
    const user = userEvent.setup();
    render(<FlagToggleGlyph record={{ id: "doc-1", flaggedAt: null, flagReason: null, flaggedBy: null }} />);

    await user.click(screen.getByRole("button", { name: "Flag for review" }));

    expect(TM.flag).toHaveBeenCalledTimes(1);
    expect(TM.flag.mock.calls[0][0]).toEqual({ id: "doc-1" });
    expect(TM.unflag).not.toHaveBeenCalled();
  });

  it("does not register a flag shortcut when the glyph is outside the shortcut-enabled surface", () => {
    render(<FlagToggleGlyph record={{ id: "doc-1", flaggedAt: null, flagReason: null, flaggedBy: null }} />);
    fireEvent.keyDown(window, { key: "f", ctrlKey: true, shiftKey: true });
    expect(TM.flag).not.toHaveBeenCalled();
  });

  it("shows the flag shortcut hint on shortcut-enabled glyphs", () => {
    render(<FlagToggleGlyph record={{ id: "doc-1", flaggedAt: null, flagReason: null, flaggedBy: null }} shortcutEnabled />);
    expect(screen.getByRole("button", { name: "Flag for review" })).toHaveAttribute("title", expect.stringContaining("Toggle flag •"));
  });

  it("unflags a flagged document with one click", async () => {
    const user = userEvent.setup();
    render(
      <FlagToggleGlyph record={{ id: "doc-1", flaggedAt: "2026-07-22T00:00:00.000Z", flagReason: null, flaggedBy: null }} />,
    );

    await user.click(screen.getByRole("button", { name: "Remove review flag" }));

    expect(TM.unflag).toHaveBeenCalledTimes(1);
    expect(TM.unflag.mock.calls[0][0]).toEqual({ id: "doc-1" });
  });

  it("renders the server error inline when a 403 unflag is refused", async () => {
    const user = userEvent.setup();
    TM.unflag.mockImplementation((_vars, opts) =>
      opts?.onError?.({
        status: 403,
        message: "Only the user who flagged this document or a rules manager can remove the flag",
        code: "FLAG_UNFLAG_FORBIDDEN",
      }),
    );
    render(
      <FlagToggleGlyph record={{ id: "doc-1", flaggedAt: "2026-07-22T00:00:00.000Z", flagReason: null, flaggedBy: null }} />,
    );

    await user.click(screen.getByRole("button", { name: "Remove review flag" }));

    // The 403 message is visible inline (no toast).
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Only the user who flagged this document or a rules manager can remove the flag",
    );
  });

  it("guards rapid double-toggles: a second click while in flight does not fire again", async () => {
    const user = userEvent.setup();
    // mutate captures but never settles → the in-flight ref stays set.
    TM.flag.mockImplementation(() => {});
    render(<FlagToggleGlyph record={{ id: "doc-1", flaggedAt: null, flagReason: null, flaggedBy: null }} />);

    const glyph = screen.getByRole("button", { name: "Flag for review" });
    await user.click(glyph);
    await user.click(glyph);

    expect(TM.flag).toHaveBeenCalledTimes(1);
  });

  it("disables the glyph while a mutation is pending", () => {
    TM.flagPending = true;
    render(<FlagToggleGlyph record={{ id: "doc-1", flaggedAt: null, flagReason: null, flaggedBy: null }} />);
    expect(screen.getByRole("button", { name: "Flag for review" })).toBeDisabled();
  });

  it("stops click propagation so a row click does not navigate", async () => {
    const user = userEvent.setup();
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <FlagToggleGlyph record={{ id: "doc-1", flaggedAt: null, flagReason: null, flaggedBy: null }} />
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "Flag for review" }));

    expect(TM.flag).toHaveBeenCalledTimes(1);
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("shows the reason and flagger in the tooltip when present", () => {
    render(
      <FlagToggleGlyph
        record={{ id: "d", flaggedAt: "2026-07-22T00:00:00.000Z", flagReason: "Possible duplicate", flaggedBy: "amorgan@northwindcg.example" }}
      />,
    );
    expect(screen.getByRole("button", { name: "Remove review flag" })).toHaveAttribute(
      "title",
      "Possible duplicate — amorgan@northwindcg.example",
    );
  });
});
