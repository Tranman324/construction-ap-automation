import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RequestCard } from "@/modules/feature-requests/components/RequestCard";
import type { FeatureRequest } from "@/modules/feature-requests/types";

const testState = vi.hoisted(() => ({
  canManageFeatureRequests: false,
  createRequest: vi.fn(),
  deleteRequest: vi.fn(),
  editRequest: vi.fn(),
  removeVote: vi.fn(),
  resetDeleteRequest: vi.fn(),
  updateStatus: vi.fn(),
  vote: vi.fn(),
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
  useCreateRequest: () => ({
    isPending: false,
    error: null,
    mutate: testState.createRequest,
  }),
  useDeleteRequest: () => ({
    isPending: false,
    isError: false,
    error: null,
    mutate: testState.deleteRequest,
    reset: testState.resetDeleteRequest,
  }),
  useEditRequest: () => ({
    isPending: false,
    error: null,
    mutate: testState.editRequest,
  }),
  useRemoveVote: () => ({
    isPending: false,
    mutate: testState.removeVote,
  }),
  useUpdateStatus: () => ({
    isPending: false,
    isError: false,
    error: null,
    mutate: testState.updateStatus,
  }),
  useVote: () => ({
    isPending: false,
    mutate: testState.vote,
  }),
}));

const request: FeatureRequest = {
  id: "req-1",
  title: "Permit Tracking",
  description: "Track permit milestones for field teams.",
  category: "workflow",
  status: "in_progress",
  authorName: "Dana Brown",
  authorEmail: "dana@northwindcg.example",
  authorImage: null,
  mustHaveVotes: 3,
  niceToHaveVotes: 1,
  totalVotes: 4,
  currentUserVote: null,
  voters: [],
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
};

describe("RequestCard", () => {
  beforeEach(() => {
    testState.canManageFeatureRequests = false;
    testState.createRequest.mockReset();
    testState.deleteRequest.mockReset();
    testState.editRequest.mockReset();
    testState.removeVote.mockReset();
    testState.resetDeleteRequest.mockReset();
    testState.updateStatus.mockReset();
    testState.vote.mockReset();
  });

  it("keeps status visible but read-only without feature request manage permission", () => {
    render(<RequestCard request={request} index={0} />);

    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /change status/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /actions/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /vote must-have/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /vote nice-to-have/i })).toBeInTheDocument();
  });

  it("shows management status and menu controls with feature request manage permission", () => {
    testState.canManageFeatureRequests = true;

    render(<RequestCard request={request} index={0} />);

    expect(
      screen.getByRole("button", { name: /change status from in progress/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /actions/i })).toBeInTheDocument();
  });
});
