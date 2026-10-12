import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AdminHeader } from "@/modules/platform-admin/components/AdminHeader";
import skeletonStyles from "@/modules/shared/components/ui/skeleton.module.css";

describe("AdminHeader", () => {
  it("renders the admin header in the required format", () => {
    render(<AdminHeader sectionId="role-perms" />);

    expect(screen.getByText("ADMIN PANEL")).toBeInTheDocument();
    expect(screen.getByText("// ROLE PERMISSIONS")).toHaveClass("text-ncg-cyan");
    expect(screen.getByTestId("admin-header-pulse")).toHaveClass(
      skeletonStyles.shimmer,
    );
  });
});
