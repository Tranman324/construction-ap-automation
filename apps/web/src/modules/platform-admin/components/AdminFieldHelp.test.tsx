import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AdminFieldHelp } from "@/modules/platform-admin/components/AdminFieldHelp";

describe("AdminFieldHelp", () => {
  it("shows field guidance from an accessible help trigger", async () => {
    const user = userEvent.setup();

    render(<AdminFieldHelp label="Role name" description="Names appear anywhere this role can be assigned." />);

    await user.hover(screen.getByRole("button", { name: "Show field help" }));

    expect(await screen.findAllByText("Names appear anywhere this role can be assigned.")).not.toHaveLength(0);
  });
});
