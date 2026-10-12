import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api } from "@/modules/shared/lib/api";
import { useAuth } from "@/modules/shared/lib/auth";
import type {
  Category,
  CreateRequestPayload,
  FeatureRequest,
  FeatureRequestsResponse,
  Status,
  VoteType,
} from "@/modules/feature-requests/types";

type FeatureRequestsQueryClient = ReturnType<typeof useQueryClient>;

interface FeatureRequestsCacheContext {
  previous: Array<[QueryKey, FeatureRequestsResponse | undefined]>;
}

interface EditRequestPayload {
  title?: string;
  description?: string;
  category?: Category;
}

interface EditRequestInput {
  id: string;
  payload: EditRequestPayload;
}

interface UpdateStatusInput {
  id: string;
  status: Status;
}

interface VoteInput {
  id: string;
  voteType: VoteType;
}

interface RemoveVoteInput {
  id: string;
}

interface DeleteRequestInput {
  id: string;
}

function snapshotFeatureRequestLists(
  queryClient: FeatureRequestsQueryClient,
): FeatureRequestsCacheContext["previous"] {
  return queryClient.getQueriesData<FeatureRequestsResponse>({
    queryKey: ["feature-requests"],
  });
}

function restoreFeatureRequestLists(
  queryClient: FeatureRequestsQueryClient,
  previous: FeatureRequestsCacheContext["previous"],
) {
  previous.forEach(([queryKey, data]) => {
    queryClient.setQueryData(queryKey, data);
  });
}

function updateFeatureRequestLists(
  queryClient: FeatureRequestsQueryClient,
  requestId: string,
  updater: (request: FeatureRequest) => FeatureRequest,
) {
  queryClient.setQueriesData<FeatureRequestsResponse>(
    { queryKey: ["feature-requests"] },
    (data) => {
      if (!data) return data;

      let didUpdate = false;
      const requests = data.requests.map((request) => {
        if (request.id !== requestId) return request;
        didUpdate = true;
        return updater(request);
      });

      return didUpdate ? { ...data, requests } : data;
    },
  );
}

function applyVote(
  request: FeatureRequest,
  userName: string,
  userEmail: string,
  userImage: string | null,
  voteType: VoteType,
): FeatureRequest {
  let mustHaveVotes = request.mustHaveVotes;
  let niceToHaveVotes = request.niceToHaveVotes;

  if (request.currentUserVote === "must_have") {
    mustHaveVotes = Math.max(0, mustHaveVotes - 1);
  } else if (request.currentUserVote === "nice_to_have") {
    niceToHaveVotes = Math.max(0, niceToHaveVotes - 1);
  }

  if (voteType === "must_have") {
    mustHaveVotes += 1;
  } else {
    niceToHaveVotes += 1;
  }

  const voters = [
    ...request.voters.filter((voter) => voter.email !== userEmail),
    { name: userName, email: userEmail, voteType, image: userImage },
  ];

  return {
    ...request,
    mustHaveVotes,
    niceToHaveVotes,
    totalVotes: mustHaveVotes + niceToHaveVotes,
    currentUserVote: voteType,
    voters,
  };
}

function removeVote(request: FeatureRequest, userEmail: string): FeatureRequest {
  let mustHaveVotes = request.mustHaveVotes;
  let niceToHaveVotes = request.niceToHaveVotes;

  if (request.currentUserVote === "must_have") {
    mustHaveVotes = Math.max(0, mustHaveVotes - 1);
  } else if (request.currentUserVote === "nice_to_have") {
    niceToHaveVotes = Math.max(0, niceToHaveVotes - 1);
  }

  return {
    ...request,
    mustHaveVotes,
    niceToHaveVotes,
    totalVotes: mustHaveVotes + niceToHaveVotes,
    currentUserVote: null,
    voters: request.voters.filter((voter) => voter.email !== userEmail),
  };
}

// ─── useCreateRequest ───────────────────────────────────────────────────────

export function useCreateRequest() {
  const queryClient = useQueryClient();

  return useMutation<FeatureRequest, Error, CreateRequestPayload>({
    mutationFn: (payload: CreateRequestPayload) =>
      api.post<FeatureRequest>("/api/feature-requests", {
        ...payload,
        category: payload.category ?? "workflow",
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["feature-requests"] });
    },
  });
}

// ─── useEditRequest ─────────────────────────────────────────────────────────

export function useEditRequest() {
  const queryClient = useQueryClient();

  return useMutation<FeatureRequest, Error, EditRequestInput>({
    mutationFn: ({ id, payload }: EditRequestInput) =>
      api.patch<FeatureRequest>(`/api/feature-requests/${id}`, payload),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["feature-requests"] });
    },
  });
}

// ─── useDeleteRequest ───────────────────────────────────────────────────────

export function useDeleteRequest() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, DeleteRequestInput, FeatureRequestsCacheContext>({
    mutationFn: ({ id }: DeleteRequestInput) => api.del<void>(`/api/feature-requests/${id}`),
    onMutate: async ({ id }: DeleteRequestInput) => {
      await queryClient.cancelQueries({ queryKey: ["feature-requests"] });

      const previous = snapshotFeatureRequestLists(queryClient);

      queryClient.setQueriesData<FeatureRequestsResponse>(
        { queryKey: ["feature-requests"] },
        (data) => {
          if (!data) return data;

          const requests = data.requests.filter((request) => request.id !== id);
          return { ...data, requests, total: requests.length };
        },
      );

      return { previous };
    },
    onError: (
      _error: Error,
      _variables: DeleteRequestInput,
      context: FeatureRequestsCacheContext | undefined,
    ) => {
      if (context?.previous) {
        restoreFeatureRequestLists(queryClient, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["feature-requests"] });
    },
  });
}

// ─── useUpdateStatus ────────────────────────────────────────────────────────

export function useUpdateStatus() {
  const queryClient = useQueryClient();

  return useMutation<FeatureRequest, Error, UpdateStatusInput, FeatureRequestsCacheContext>({
    mutationFn: ({ id, status }: UpdateStatusInput) =>
      api.patch<FeatureRequest>(`/api/feature-requests/${id}`, { status }),
    onMutate: async ({ id, status }: UpdateStatusInput) => {
      await queryClient.cancelQueries({ queryKey: ["feature-requests"] });

      const previous = snapshotFeatureRequestLists(queryClient);

      updateFeatureRequestLists(queryClient, id, (request) => ({
        ...request,
        status,
      }));

      return { previous };
    },
    onError: (
      _error: Error,
      _variables: UpdateStatusInput,
      context: FeatureRequestsCacheContext | undefined,
    ) => {
      if (context?.previous) {
        restoreFeatureRequestLists(queryClient, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["feature-requests"] });
    },
  });
}

// ─── useVote ────────────────────────────────────────────────────────────────

export function useVote() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userName = user?.name?.trim();
  const userEmail = user?.email?.trim();
  const userImage = user?.image ?? null;

  return useMutation<FeatureRequest, Error, VoteInput, FeatureRequestsCacheContext>({
    mutationFn: ({ id, voteType }: VoteInput) =>
      api.post<FeatureRequest>(`/api/feature-requests/${id}/vote`, { voteType }),
    onMutate: async ({ id, voteType }: VoteInput) => {
      await queryClient.cancelQueries({ queryKey: ["feature-requests"] });

      const previous = snapshotFeatureRequestLists(queryClient);

      if (userName && userEmail) {
        updateFeatureRequestLists(queryClient, id, (request) =>
          applyVote(request, userName, userEmail, userImage, voteType),
        );
      }

      return { previous };
    },
    onError: (
      _error: Error,
      _variables: VoteInput,
      context: FeatureRequestsCacheContext | undefined,
    ) => {
      if (context?.previous) {
        restoreFeatureRequestLists(queryClient, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["feature-requests"] });
    },
  });
}

// ─── useRemoveVote ──────────────────────────────────────────────────────────

export function useRemoveVote() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userEmail = user?.email?.trim();

  return useMutation<FeatureRequest, Error, RemoveVoteInput, FeatureRequestsCacheContext>({
    mutationFn: ({ id }: RemoveVoteInput) =>
      api.del<FeatureRequest>(`/api/feature-requests/${id}/vote`),
    onMutate: async ({ id }: RemoveVoteInput) => {
      await queryClient.cancelQueries({ queryKey: ["feature-requests"] });

      const previous = snapshotFeatureRequestLists(queryClient);

      if (userEmail) {
        updateFeatureRequestLists(queryClient, id, (request) => removeVote(request, userEmail));
      }

      return { previous };
    },
    onError: (
      _error: Error,
      _variables: RemoveVoteInput,
      context: FeatureRequestsCacheContext | undefined,
    ) => {
      if (context?.previous) {
        restoreFeatureRequestLists(queryClient, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["feature-requests"] });
    },
  });
}