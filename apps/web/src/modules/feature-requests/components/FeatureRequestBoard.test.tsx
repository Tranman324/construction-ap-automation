import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureRequestBoard } from "./FeatureRequestBoard";

const testState = vi.hoisted(() => ({
  refetch: vi.fn(),
  requests: [
    {
      id: "req-1",
      title: "Permit Tracking",
      description: "Track permit milestones for field teams.",
      category: "workflow",
      status: "open",
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
    },
    {
      id: "req-2",
      title: "Closeout Photos",
      description: "Bundle closeout photos into a downloadable packet.",
      category: "reporting",
      status: "completed",
      authorName: "Maria Chen",
      authorEmail: "maria@northwindcg.example",
      authorImage: null,
      mustHaveVotes: 1,
      niceToHaveVotes: 2,
      totalVotes: 3,
      currentUserVote: null,
      voters: [],
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    },
  ],
}));

vi.mock("@/modules/feature-requests/hooks/queries", () => ({
  useFeatureRequests: () => ({
    data: {
      requests: testState.requests,
      total: testState.requests.length,
    },
    error: null,
    isError: false,
    isLoading: false,
    refetch: testState.refetch,
  }),
}));

vi.mock("@/modules/feature-requests/components/NewRequestDialog", () => ({
  NewRequestDialog: () => null,
}));

vi.mock("@/modules/feature-requests/components/RequestCard", () => ({
  RequestCard: ({ request }: { request: { title: string } }) => <div>{request.title}</div>,
}));

describe("FeatureRequestBoard", () => {
  beforeEach(() => {
    testState.refetch.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps search inline and filters visible requests after the debounce", async () => {
    render(<FeatureRequestBoard />);

    expect(screen.getByText("Permit Tracking")).toBeInTheDocument();
    expect(screen.getByText("Closeout Photos")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: /search feature requests/i }), {
      target: { value: "permit" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByText("Permit Tracking")).toBeInTheDocument();
    expect(screen.queryByText("Closeout Photos")).not.toBeInTheDocument();
  });
});