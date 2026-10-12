import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/modules/settings/components/SettingsPage", () => ({
  SettingsPage: () => <div>Profile settings</div>,
}));

import SettingsRoute from "@/app/(dashboard)/settings/page";

describe("SettingsRoute", () => {
  it("renders profile settings without requiring a role permission", () => {
    render(React.createElement(SettingsRoute));

    expect(screen.getByText("Profile settings")).toBeInTheDocument();
  });
});
