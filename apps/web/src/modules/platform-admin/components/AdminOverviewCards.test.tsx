import { LayoutDashboard } from "lucide-react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  AdminMetricCard,
  HealthPill,
  type HealthSignal,
  type MetricDefinition,
} from "@/modules/platform-admin/components/AdminOverviewCards";

describe("AdminOverviewCards", () => {
  it("renders the metric card error fallback without hiding the metric label", async () => {
    const user = userEvent.setup();
    const metric: MetricDefinition = {
      id: "roles",
      label: "Roles",
      description: "Role inventory",
      value: 0,
      status: "error",
      icon: LayoutDashboard,
      errorMessage: "Role service unavailable",
    };

    render(<AdminMetricCard metric={metric} />);

    expect(screen.getByTestId("overview-metric-roles")).toHaveTextContent("Roles");
    expect(screen.getByTestId("overview-metric-roles")).toHaveTextContent("Unavailable");
    expect(screen.getByText("Role service unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Role inventory")).not.toBeInTheDocument();

    await user.hover(screen.getByRole("button", { name: "Show field help" }));

    expect(await screen.findAllByText("Role inventory")).not.toHaveLength(0);
  });

  it("renders a health pill label from the signal status", () => {
    const signal: HealthSignal = {
      id: "directory",
      label: "Directory sync",
      status: "ready",
      readyLabel: "User inventory ready",
    };

    render(<HealthPill signal={signal} />);

    expect(screen.getByText("Directory sync")).toBeInTheDocument();
    expect(screen.getByText("User inventory ready")).toBeInTheDocument();
  });
});