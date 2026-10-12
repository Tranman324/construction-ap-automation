import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { DuplicateStatusResponse } from "@/modules/accounting/modules/invoices/types/api";
import { toast } from "@/modules/shared/components/ui/toaster";
import { DuplicateBypassNote } from "./DuplicateBypassNote";

const NM = vi.hoisted(() => ({
  permissions: ["accounting.invoices.approve"] as string[],
  revert: vi.fn(),
  pending: false,
}));

vi.mock("@/modules/shared/components/PermissionGate", () => ({
  PermissionGate: ({ requires, children }: { requires: string; children: React.ReactNode }) =>
    NM.permissions.includes(requires) ? children : null,
}));
vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useRevertDuplicateBypass: () => ({ mutate: NM.revert, isPending: NM.pending }),
}));
vi.mock("@/modules/shared/components/ui/toaster", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "copy-2", classification: "invoice", confidence: 0.9, file: "copy-2.pdf",
    email: { from: "ap@example.com", subject: "Invoice 123", receivedAt: "2026-08-10T00:00:00.000Z" },
    status: "pending", queuedAt: "2026-08-10T00:00:00.000Z", extracted: null, matching: null,
    overallConfidence: 0.9, splitFrom: null, duplicateOf: "original-1", reason: null, error: null,
    reclassifiedFrom: null, reclassifiedAt: null,
    ...overrides,
  };
}

const bypassedStatus: DuplicateStatusResponse = {
  state: "none", spectrum: null, original: null, evidence: null,
  bypassed: { at: "2026-09-01T15:00:00.000Z", by: "Pat Reviewer" },
};

beforeEach(() => {
  NM.permissions = ["accounting.invoices.approve"];
  NM.pending = false;
  NM.revert.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

// F-BYP: the bypassed-duplicate fixture from the content spec.
const fByp: DuplicateStatusResponse = {
  state: "none", spectrum: null, original: null, evidence: null,
  bypassed: { at: "2026-10-02T12:00:00.000Z", by: "Dana Moreno" },
};

describe("DuplicateBypassNote", () => {
  it("shows who bypassed and when, and restores the flag", async () => {
    render(<DuplicateBypassNote invoice={invoice()} duplicateStatus={bypassedStatus} />);

    expect(screen.getByText("by Pat Reviewer on Sep 1, 2026 · Approve is open again")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Restore flag" }));
    expect(NM.revert).toHaveBeenCalledWith({ id: "copy-2" }, expect.any(Object));
  });

  it("falls back to served bypass fields before the live status loads", () => {
    render(<DuplicateBypassNote invoice={invoice({ duplicateBypassed: true, duplicateBypassedBy: "Lee", duplicateBypassedAt: null })} />);
    expect(screen.getByText("by Lee · Approve is open again")).toBeInTheDocument();
  });

  it("hides the restore button without approve permission", () => {
    NM.permissions = [];
    render(<DuplicateBypassNote invoice={invoice()} duplicateStatus={bypassedStatus} />);
    expect(screen.getByTestId("duplicate-bypass-note")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore flag" })).not.toBeInTheDocument();
  });

  it("renders nothing when the flag is active or was never bypassed", () => {
    const { container, rerender } = render(
      <DuplicateBypassNote invoice={invoice()} duplicateStatus={{ ...bypassedStatus, state: "toolbox", bypassed: null }} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<DuplicateBypassNote invoice={invoice()} duplicateStatus={{ ...bypassedStatus, bypassed: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the status card with title, by/when line and Restore flag", () => {
    render(<DuplicateBypassNote invoice={invoice()} duplicateStatus={fByp} />);

    const note = screen.getByTestId("duplicate-bypass-note");
    expect(note).toHaveTextContent("Duplicate flag bypassed");
    expect(screen.getByText("by Dana Moreno on Oct 2, 2026 · Approve is open again")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore flag" })).toBeInTheDocument();
    expect(screen.queryByText(/Duplicate flag bypassed by/)).not.toBeInTheDocument();
  });

  it("formats the bypass date in UTC, not the viewer's time zone", () => {
    process.env.TZ = "America/Los_Angeles";
    const status = { ...fByp, bypassed: { at: "2026-09-01T00:30:00.000Z", by: "Dana Moreno" } };
    render(<DuplicateBypassNote invoice={invoice()} duplicateStatus={status} />);

    expect(screen.getByTestId("duplicate-bypass-note")).toHaveTextContent("on Sep 1, 2026");
    expect(screen.getByTestId("duplicate-bypass-note")).not.toHaveTextContent("Aug 31");
  });

  it.each([
    ["by", { at: "2026-10-02T12:00:00.000Z", by: null }, "on Oct 2, 2026 · Approve is open again"],
    ["date", { at: null, by: "Dana Moreno" }, "by Dana Moreno · Approve is open again"],
    ["both", { at: null, by: null }, "Approve is open again"],
    ["invalid date", { at: "not-a-date", by: "Dana Moreno" }, "by Dana Moreno · Approve is open again"],
  ])("omits the missing %s part without printing placeholders", (_label, bypassed, expected) => {
    render(<DuplicateBypassNote invoice={invoice()} duplicateStatus={{ ...fByp, bypassed }} />);

    const note = screen.getByTestId("duplicate-bypass-note");
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(note).not.toHaveTextContent(/undefined|null|Invalid Date/);
  });

  it("shows the Restore flag button only with approve permission while the note stays visible", () => {
    const { unmount } = render(<DuplicateBypassNote invoice={invoice()} duplicateStatus={fByp} />);
    expect(screen.getByRole("button", { name: "Restore flag" })).toBeInTheDocument();
    unmount();

    NM.permissions = [];
    render(<DuplicateBypassNote invoice={invoice()} duplicateStatus={fByp} />);
    expect(screen.getByTestId("duplicate-bypass-note")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore flag" })).not.toBeInTheDocument();
  });

  it("restores through the existing mutation and reports success and failure", async () => {
    render(<DuplicateBypassNote invoice={invoice()} duplicateStatus={fByp} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Restore flag" }));
    expect(NM.revert).toHaveBeenCalledWith({ id: "copy-2" }, expect.any(Object));

    const callbacks = NM.revert.mock.calls[0][1] as { onSuccess: () => void; onError: (error: Error) => void };
    callbacks.onSuccess();
    expect(toast.success).toHaveBeenCalledWith("Duplicate flag restored");
    callbacks.onError(new Error("Forbidden"));
    expect(toast.error).toHaveBeenCalledWith("Could not restore duplicate flag", { description: "Forbidden" });
  });

  it("shows Restoring… and disables the button while the restore is pending", () => {
    NM.pending = true;
    render(<DuplicateBypassNote invoice={invoice()} duplicateStatus={fByp} />);

    expect(screen.getByRole("button", { name: "Restoring…" })).toBeDisabled();
  });

  it("uses theme tokens only: no hex and no palette utility classes in the component", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/modules/accounting/modules/invoices/components/invoices/DuplicateBypassNote.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(
      /\b(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline|decoration|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
    );
  });
});
