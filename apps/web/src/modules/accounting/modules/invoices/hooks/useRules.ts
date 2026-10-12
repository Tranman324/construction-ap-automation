import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/modules/shared/lib/api";
import {
  invalidateInvoiceDetail,
  invalidateInvoiceListNavigation,
} from "@/modules/accounting/modules/invoices/hooks/invalidation";
import type {
  Rule,
  RuleListResponse,
  RuleCreatePayload,
  RuleCreateAndApplyResponse,
  RuleUpdatePayload,
  RuleReorderPayload,
  RuleReorderResponse,
  RuleApplyPayload,
  RuleApplyResponse,
} from "@/modules/accounting/modules/invoices/types/rules";

/** Narrows the create response to the atomic create-and-apply shape. */
export function isRuleCreateAndApplyResponse(
  value: Rule | RuleCreateAndApplyResponse,
): value is RuleCreateAndApplyResponse {
  if (typeof value !== "object" || value === null || !("rule" in value) || !("applied" in value)) {
    return false;
  }
  const { rule, applied } = value;
  return typeof rule === "object" && rule !== null
    && typeof applied === "object" && applied !== null
    && "matchedInvoices" in applied && typeof applied.matchedInvoices === "number"
    && "actionsApplied" in applied && typeof applied.actionsApplied === "number";
}

const RULES_KEY = ["rules"] as const;

// ─── useRules ─────────────────────────────────────────────────────────────────

interface UseRulesOptions {
  enabled?: boolean;
}

export function useRules({ enabled = true }: UseRulesOptions = {}) {
  return useQuery<RuleListResponse>({
    queryKey: RULES_KEY,
    queryFn: () => api.get<RuleListResponse>("/api/rules"),
    staleTime: 30_000,
    enabled,
  });
}

// ─── useCreateRule ────────────────────────────────────────────────────────────

export function useCreateRule() {
  const queryClient = useQueryClient();
  return useMutation<Rule | RuleCreateAndApplyResponse, Error, RuleCreatePayload>({
    // Atomic path: with `apply: true` the backend creates AND applies in one
    // transaction and returns `{ rule, applied }`; otherwise it returns the Rule.
    mutationFn: (payload: RuleCreatePayload) =>
      api.post<Rule | RuleCreateAndApplyResponse>("/api/rules", payload),
    onSuccess: (result, payload) => {
      void queryClient.invalidateQueries({ queryKey: RULES_KEY });
      // Atomic create-and-apply can mutate explicitly targeted documents. Refresh
      // each detail alongside its list/navigation membership.
      if (isRuleCreateAndApplyResponse(result)) {
        invalidateInvoiceListNavigation(queryClient);
        payload.documentIds?.forEach((id) => invalidateInvoiceDetail(queryClient, id));
      }
    },
  });
}

// ─── useUpdateRule ────────────────────────────────────────────────────────────

export function useUpdateRule() {
  const queryClient = useQueryClient();
  return useMutation<Rule, Error, { id: string; payload: RuleUpdatePayload }>({
    mutationFn: ({ id, payload }: { id: string; payload: RuleUpdatePayload }) =>
      api.patch<Rule>(`/api/rules/${id}`, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RULES_KEY });
    },
  });
}

// ─── useDeleteRule ────────────────────────────────────────────────────────────

export function useDeleteRule() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }: { id: string }) => api.del<void>(`/api/rules/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RULES_KEY });
    },
  });
}

// ─── useReorderRules ──────────────────────────────────────────────────────────

export function useReorderRules() {
  const queryClient = useQueryClient();
  return useMutation<RuleReorderResponse, Error, RuleReorderPayload>({
    mutationFn: (payload: RuleReorderPayload) =>
      api.put<RuleReorderResponse>("/api/rules/order", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RULES_KEY });
    },
  });
}

// ─── useApplyRules ────────────────────────────────────────────────────────────

export function useApplyRules() {
  const queryClient = useQueryClient();
  return useMutation<RuleApplyResponse, Error, RuleApplyPayload>({
    mutationFn: (payload: RuleApplyPayload) =>
      api.post<RuleApplyResponse>("/api/rules/apply", payload),
    onSuccess: (_data, payload) => {
      invalidateInvoiceListNavigation(queryClient);
      payload.documentIds?.forEach((id) => invalidateInvoiceDetail(queryClient, id));
    },
  });
}
