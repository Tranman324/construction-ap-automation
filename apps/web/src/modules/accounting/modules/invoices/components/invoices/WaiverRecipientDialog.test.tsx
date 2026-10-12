import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isRecipientEmailValid,
  sourceLabel,
  WaiverRecipientDialog,
} from "@/modules/accounting/modules/invoices/components/invoices/WaiverRecipientDialog";
import { directorySourceLabel } from "@/modules/accounting/modules/invoices/components/invoices/WaiverContactDirectory";
import type { WaiverRecipientResponse } from "@/modules/accounting/modules/invoices/types/api";

const parsed: WaiverRecipientResponse = {
  recipientType: "parsed",
  directEmail: null,
  candidates: [
    { email: "body@vendor.test", source: "body" },
    { email: "cached@vendor.test", source: "vendor_record" },
  ],
  cachedVendorEmail: "cached@vendor.test",
  emailFrom: "quickbooks@notification.intuit.com",
  reason: "Billing platform (QuickBooks)",
  directoryContacts: [],
};

const permission = vi.hoisted(() => ({ allowed: true }));

vi.mock("@/modules/shared/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => permission.allowed ? children : null,
}));

describe("WaiverRecipientDialog", () => {
  beforeEach(() => { permission.allowed = true; });

  it("preselects the cached vendor email and sends it", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <WaiverRecipientDialog
        open
        pending={false}
        resolution={parsed}
        onOpenChange={vi.fn()}
        onSend={onSend}
        onAddContact={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox")).toHaveTextContent("cached@vendor.test");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("cached@vendor.test");
  });

  it("requires a valid manually entered recipient", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <WaiverRecipientDialog
        open
        pending={false}
        resolution={{ ...parsed, recipientType: "manual", candidates: [], cachedVendorEmail: null }}
        onOpenChange={vi.fn()}
        onSend={onSend}
        onAddContact={vi.fn()}
      />,
    );

    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("Vendor email"), "ap@vendor.test");
    expect(send).toBeEnabled();
    await user.click(send);
    expect(onSend).toHaveBeenCalledWith("ap@vendor.test");
  });

  it("validates recipient email syntax", () => {
    expect(isRecipientEmailValid("vendor@example.com")).toBe(true);
    expect(isRecipientEmailValid("not-an-email")).toBe(false);
  });

  it("preserves directory order and source labels, and selection does not send", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <WaiverRecipientDialog
        open
        pending={false}
        resolution={{ ...parsed, directoryContacts: [
          { email: "confirmed@vendor.test", name: "Confirmed AP", source: "confirmed_send", lastSeenAt: null },
          { email: "manual@vendor.test", name: null, source: "manual", lastSeenAt: null },
          { email: "seen@vendor.test", name: "Seen AP", source: "observed", lastSeenAt: "2026-07-14T12:00:00.000Z" },
        ] }}
        onOpenChange={vi.fn()}
        onSend={onSend}
        onAddContact={vi.fn()}
      />,
    );

    const contacts = screen.getAllByRole("option");
    expect(contacts.map((contact) => contact.textContent)).toEqual([
      expect.stringContaining("confirmed send"),
      expect.stringContaining("manual"),
      expect.stringContaining("seen"),
    ]);
    await user.click(contacts[2]!);
    expect(onSend).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("seen@vendor.test");
  });

  it("adds a contact with the authoritative normalized directory and selects it without sending", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onAddContact = vi.fn().mockResolvedValue({
      success: true,
      directoryContacts: [
        { email: "normalized@vendor.test", name: "New AP", source: "manual", lastSeenAt: null },
      ],
    });
    render(<WaiverRecipientDialog
      open
      pending={false}
      resolution={{ ...parsed, recipientType: "manual", directoryContacts: [
        { email: "old@vendor.test", name: "Old AP", source: "observed", lastSeenAt: null },
      ] }}
      onOpenChange={vi.fn()}
      onSend={onSend}
      onAddContact={onAddContact}
    />);

    await user.click(screen.getByRole("button", { name: "Add Contact" }));
    await user.type(screen.getByLabelText("Email"), "  NORMALIZED@VENDOR.TEST ");
    await user.type(screen.getByLabelText("Name (optional)"), "New AP");
    await user.click(screen.getByRole("button", { name: "Save Contact" }));

    expect(onAddContact).toHaveBeenCalledWith({ email: "NORMALIZED@VENDOR.TEST", name: "New AP" });
    expect(await screen.findByText("New AP")).toBeInTheDocument();
    expect(screen.queryByText("Old AP")).not.toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("normalized@vendor.test");
  });

  it("does not expose Add Contact without the request-waiver permission", () => {
    permission.allowed = false;
    render(<WaiverRecipientDialog open pending={false} resolution={parsed} onOpenChange={vi.fn()} onSend={vi.fn()} onAddContact={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Add Contact" })).not.toBeInTheDocument();
  });
});

describe("sourceLabel", () => {
  it("labels a sender-sourced candidate as the original sender", () => {
    expect(sourceLabel("sender")).toBe("original sender");
  });

  it("keeps the vendor_record and forwarded_header labels unchanged", () => {
    expect(sourceLabel("vendor_record")).toBe("vendor record");
    expect(sourceLabel("forwarded_header")).toBe("forwarded email");
  });

  it("falls through to email body for body and any unrecognized source", () => {
    expect(sourceLabel("body")).toBe("email body");
    // Unknown/unmapped values must keep the generic fallthrough.
    expect(sourceLabel("unexpected" as WaiverRecipientResponse["candidates"][number]["source"])).toBe(
      "email body",
    );
  });
});

describe("directorySourceLabel", () => {
  it("uses the served directory labels", () => {
    expect(directorySourceLabel("confirmed_send")).toBe("confirmed send");
    expect(directorySourceLabel("manual")).toBe("manual");
    expect(directorySourceLabel("observed")).toBe("seen");
  });
});
