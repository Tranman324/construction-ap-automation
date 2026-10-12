import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/shared/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  isApiError: () => false,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { api } from "@/modules/shared/lib/api";
import { useDocumentDestinations } from "@/modules/accounting/modules/invoices/hooks/queries";
import { SEEDED_DESTINATIONS } from "@/modules/accounting/modules/invoices/lib/destinationsFixture";

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useDocumentDestinations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns the served destinations config on success", async () => {
    mockApi.get.mockResolvedValue(SEEDED_DESTINATIONS);

    const { result } = renderHook(() => useDocumentDestinations(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith("/api/document-destinations");
    expect(result.current.data).toEqual(SEEDED_DESTINATIONS);
  });

  it("surfaces isError with no fallback data when the fetch fails", async () => {
    mockApi.get.mockRejectedValue(new Error("destinations endpoint down"));

    const { result } = renderHook(() => useDocumentDestinations(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // No client-side fallback catalog — data stays undefined so consumers can
    // render an explicit unavailable state.
    expect(result.current.data).toBeUndefined();
  });
});
