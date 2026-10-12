import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StatusControl } from "@/modules/feature-requests/components/StatusControl";

const testState = vi.hoisted(() => ({
  canManageFeatureRequests: false,
  mutateStatus: vi.fn(),
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: (permissionKey: string) =>
      permissionKey === "feature_requests.manage" && testState.canManageFeatureRequests,
    hasAnyPermission: (permissionKeys: string[]) =>
      permissionKeys.some((permissionKey) =>
        permissionKey === "feature_requests.manage" && testState.canManageFeatureRequests,
      ),
    hasAllPermissions: (permissionKeys: string[]) =>
      permissionKeys.every((permissionKey) =>
        permissionKey === "feature_requests.manage" && testState.canManageFeatureRequests,
      ),
    role: "employee",
    isAdmin: false,
    permissions: testState.canManageFeatureRequests ? ["feature_requests.manage"] : [],
  }),
}));

vi.mock("@/modules/feature-requests/hooks/mutations", () => ({
  useUpdateStatus: () => ({
    isPending: false,
    isError: false,
    error: null,
    mutate: testState.mutateStatus,
  }),
}));

describe("StatusControl", () => {
  beforeEach(() => {
    testState.canManageFeatureRequests = false;
    testState.mutateStatus.mockReset();
  });

  it("default-denies status controls without feature request manage permission", () => {
    const { container } = render(
      <StatusControl requestId="req-1" currentStatus="open" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders status controls for users with feature request manage permission", () => {
    testState.canManageFeatureRequests = true;

    render(<StatusControl requestId="req-1" currentStatus="open" />);

    expect(
      screen.getByRole("button", { name: /change status from open/i }),
    ).toBeInTheDocument();
  });
});
