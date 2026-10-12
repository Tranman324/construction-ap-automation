import { useQuery } from "@tanstack/react-query";
import { api } from "@/modules/shared/lib/api";
import type {
  FeatureRequestsResponse,
  Status,
  Category,
} from "@/modules/feature-requests/types";

// ─── useFeatureRequests ──────────────────────────────────────────────────────

export function useFeatureRequests(params?: { status?: Status; category?: Category }) {
  return useQuery<FeatureRequestsResponse>({
    queryKey: ["feature-requests", params],
    queryFn: () =>
      api.get<FeatureRequestsResponse>(
        "/api/feature-requests",
        params as Record<string, string | number | boolean | undefined>,
      ),
    staleTime: 30_000,
  });
}