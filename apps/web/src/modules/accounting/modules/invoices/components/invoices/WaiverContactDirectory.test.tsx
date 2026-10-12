import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { directorySourceLabel, WaiverContactDirectory } from "@/modules/accounting/modules/invoices/components/invoices/WaiverContactDirectory";

vi.mock("@/modules/shared/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("WaiverContactDirectory", () => {
  it("keeps the empty directory visible with Add Contact", () => {
    render(
      <WaiverContactDirectory
        contacts={[]}
        selection=""
        pending={false}
        isEmailValid={(value) => value.includes("@")}
        onSelect={vi.fn()}
        onAddContact={vi.fn()}
      />,
    );

    expect(screen.getByText("No saved vendor contacts yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Contact" })).toBeInTheDocument();
    expect(directorySourceLabel("confirmed_send")).toBe("confirmed send");
  });

  it("replaces a mounted stale list from authoritative contacts without resetting an active add form", async () => {
    const user = userEvent.setup();
    const initialContacts = [
      { email: "old@vendor.test", name: "Old AP", source: "observed" as const, lastSeenAt: null },
    ];
    const updatedContacts = [
      { email: "new@vendor.test", name: "New AP", source: "confirmed_send" as const, lastSeenAt: null },
      { email: "second@vendor.test", name: null, source: "manual" as const, lastSeenAt: null },
    ];
    const { rerender } = render(
      <WaiverContactDirectory
        contacts={initialContacts}
        selection=""
        pending={false}
        isEmailValid={(value) => value.includes("@")}
        onSelect={vi.fn()}
        onAddContact={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add Contact" }));
    await user.type(screen.getByLabelText("Email"), "draft@vendor.test");
    await user.type(screen.getByLabelText("Name (optional)"), "Draft AP");

    rerender(
      <WaiverContactDirectory
        contacts={updatedContacts}
        selection=""
        pending={false}
        isEmailValid={(value) => value.includes("@")}
        onSelect={vi.fn()}
        onAddContact={vi.fn()}
      />,
    );

    expect(await screen.findByText("New AP")).toBeInTheDocument();
    expect(screen.queryByText("Old AP")).not.toBeInTheDocument();
    expect(screen.getAllByRole("option").map((contact) => contact.textContent)).toEqual([
      expect.stringContaining("confirmed send"),
      expect.stringContaining("manual"),
    ]);
    expect(screen.getByLabelText("Email")).toHaveValue("draft@vendor.test");
    expect(screen.getByLabelText("Name (optional)")).toHaveValue("Draft AP");
  });
});
