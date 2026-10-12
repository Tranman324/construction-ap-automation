import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { api, isApiError } from "@/modules/shared/lib/api";
import { toast } from "@/modules/shared/components/ui/toaster";
import { emitInvoiceAuditEvent } from "@/modules/accounting/modules/invoices/lib/auditEvents";
import { useAuth } from "@/modules/shared/lib/auth";
import {
  invalidateInvoiceCollections,
  invalidateInvoiceDetail,
  markInvoiceCollectionsStale,
  markInvoiceListsStale,
} from "@/modules/accounting/modules/invoices/hooks/invalidation";
import { approvalVerdictQueryKey } from "@/modules/accounting/modules/invoices/hooks/queries";
import { collaborationApiBase, collaborationQueryKey, type CollaborationRouteFamily } from "./collaborationRoutes";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type {
  InvoiceListResponse,
  InvoiceUpdateResponse,
  DashboardStats,
  InvoiceUpdatePayload,
  BulkActionPayload,
  BulkActionResponse,
  SubmitPayload,
  SubmitResponse,
  IgnoreRuleCreate,
  IgnoreRule,
  RetentionRule,
  RetentionRuleCreatePayload,
  RetentionRuleUpdatePayload,
  RetentionRuleDeleteResponse,
  ClassificationBatchUpdatePayload,
  ClassificationBatchUpdateResponse,
  ClassificationCreatePayload,
  ClassificationCreateResponse,
  ClassificationDeletePayload,
  ClassificationDeleteResponse,
  DiscardInvoiceResponse,
  DuplicateBypassResponse,
  RejectPayload,
  DiscardPayload,
  ReclassifyPayload,
  ApproveInvoiceResponse,
  ApprovePayload,
  RematchStatementLinesResponse,
  ResolveStatementLinePayload,
  StatementLineResolutionResponse,
  SpectrumRefreshTriggerResponse,
  MarkReviewedResponse,
  DeleteDocumentResponse,
  FileDocumentPayload,
  FileDocumentResponse,
  UndoActionResponse,
  LinkWaiverResponse,
  UnlinkWaiverResponse,
  WaiverOverrideResponse,
  WaiverBypassResponse,
  RequestWaiverPayload,
  RequestWaiverResponse,
  AddWaiverContactPayload,
  AddWaiverContactResponse,
  WaiverRecipientResponse,
  ReconcileDocumentResponse,
  AddStatementLinePayload,
  AddStatementLineResponse,
  DeleteStatementLineResponse,
  UpdateStatementLinePayload,
  UpdateStatementLineResponse,
  UploadCoiToSpectrumPayload,
  UploadCoiToSpectrumResponse,
  ConfirmSplitRequest,
  ConfirmSplitResponse,
  FlagForSplitResponse,
  AnalyzeSplitResponse,
  SetPhaseAllocationsResponse,
  RestoreInvoiceResponse,
  PermanentDeleteResponse,
  AttachFileResponse,
  FlagDocumentResponse,
  UnflagDocumentResponse,
  ApplyCoiOverridePayload,
  ApplyCoiOverrideResponse,
  RevokeCoiOverrideResponse,
  UpdateCoiManualValuesPayload,
  UpdateCoiManualValuesResponse,
  UpdateStatementAttributesPayload,
  UpdateStatementAttributesResponse,
  UpdateWarrantyClassificationPayload,
  UpdateWarrantyClassificationResponse,
  ReprocessInvoiceResponse,
  ActivityViewResponse,
  CreateCommentPayload,
  CreateCommentResponse,
  ActivityResponse,
  DocumentEmailForwardPayload,
  DocumentEmailReplyPayload,
  DocumentEmailSendResponse,
  TrashListResponse,
  ActivityEntry,
  InboundPromotionResponse,
} from "@/modules/accounting/modules/invoices/types/api";
import { waiverRecipientQueryKey } from "@/modules/accounting/modules/invoices/hooks/queries";

interface ActivityUnreadCounts {
  unreadReplies: number;
  unreadComments: number;
}

function updateCachedActivityCounts(queryClient: QueryClient, id: string, counts: ActivityUnreadCounts) {
  const updateInvoice = (current: Invoice | undefined) => current ? { ...current, ...counts } : current;
  queryClient.setQueryData<Invoice>(["invoice", id], updateInvoice);
  queryClient.setQueryData<Invoice>(["invoice", id, "includeDeleted"], updateInvoice);
  queryClient.setQueriesData<InvoiceListResponse>({ queryKey: ["invoices"] }, (current) => current ? {
    ...current,
    invoices: current.invoices.map((invoice) => invoice.id === id ? { ...invoice, ...counts } : invoice),
  } : current);
  queryClient.setQueriesData<TrashListResponse>({ queryKey: ["trash"] }, (current) => current ? {
    ...current,
    invoices: current.invoices.map((invoice) => invoice.id === id ? { ...invoice, ...counts } : invoice),
  } : current);
}

export function useCreateComment() {
  const queryClient = useQueryClient();
  return useMutation<CreateCommentResponse, Error, { id: string; payload: CreateCommentPayload; routeFamily?: CollaborationRouteFamily; optimisticEntryId?: string }>({
    mutationFn: ({ id, payload, routeFamily = "invoice" }) => api.post<CreateCommentResponse>(`${collaborationApiBase(routeFamily)}/${id}/comments`, payload),
    retry: false,
    onSuccess: (response, { id, routeFamily = "invoice", optimisticEntryId }) => {
      const canonicalComment: ActivityEntry & { clientReconciliationId?: string } = optimisticEntryId
        ? { ...response.comment, clientReconciliationId: optimisticEntryId }
        : response.comment;
      queryClient.setQueryData<ActivityResponse>(collaborationQueryKey(routeFamily, id, 0), (current) => {
        const page = current ?? {
          entries: [],
          pagination: { limit: 50, offset: 0, total: 0, hasMore: false },
        };
        const entries = [canonicalComment, ...page.entries.filter((entry) => entry.id !== response.comment.id)];
        return {
          ...page,
          entries,
          pagination: current ? page.pagination : { ...page.pagination, total: entries.length },
        };
      });
      void queryClient.invalidateQueries({ queryKey: ["activity", routeFamily, id] });
      void invalidateInvoiceCollections(queryClient, [id]);
    },
  });
}

export function useMarkActivityViewed() {
  const queryClient = useQueryClient();
  return useMutation<ActivityViewResponse, Error, { id: string; routeFamily?: CollaborationRouteFamily }>({
    mutationFn: ({ id, routeFamily = "invoice" }) => api.post<ActivityViewResponse>(`${collaborationApiBase(routeFamily)}/${id}/activity/view`, {}),
    retry: false,
    onSuccess: (response, { id, routeFamily = "invoice" }) => {
      updateCachedActivityCounts(queryClient, id, response);
      void queryClient.invalidateQueries({ queryKey: ["activity", routeFamily, id] });
      void invalidateInvoiceCollections(queryClient, [id]);
      void queryClient.setQueryData(["activity-view", routeFamily, id], response);
    },
  });
}

type EmailSendVariables<Payload> = {
  id: string;
  payload: Payload;
  routeFamily?: CollaborationRouteFamily;
  sendToken: string;
};

type EmailSendRequest<Payload> = Omit<EmailSendVariables<Payload>, "sendToken"> & { sendToken?: string };

function createSendToken(): string {
  return globalThis.crypto.randomUUID();
}

function isAmbiguousSendFailure(cause: unknown): boolean {
  const status = typeof cause === "object" && cause !== null && "status" in cause && typeof cause.status === "number"
    ? cause.status
    : undefined;
  const code = typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : "";
  const message = cause instanceof Error
    ? cause.message
    : typeof cause === "object" && cause !== null && "message" in cause && typeof cause.message === "string"
      ? cause.message
      : "";
  return status === undefined || status === 408 || status === 504 || /ambiguous|may have sent|delivery unknown|timed? ?out/i.test(`${code} ${message}`);
}

function useEmailSendMutation<Payload>(action: "reply" | "forward") {
  const retainedToken = useRef<string | null>(null);
  const mutation = useMutation<DocumentEmailSendResponse, Error, EmailSendVariables<Payload>>({
    mutationFn: ({ id, payload, routeFamily = "invoice", sendToken }) => api.post<DocumentEmailSendResponse>(`${collaborationApiBase(routeFamily)}/${id}/${action}`, payload, {
      headers: { "X-Send-Token": sendToken },
    }),
    retry: false,
  });

  async function mutateAsync(variables: EmailSendRequest<Payload>): Promise<DocumentEmailSendResponse> {
    const sendToken = variables.sendToken ?? retainedToken.current ?? createSendToken();
    retainedToken.current = sendToken;
    const request: EmailSendVariables<Payload> = { ...variables, sendToken };
    try {
      const response = await mutation.mutateAsync(request);
      retainedToken.current = null;
      return response;
    } catch (cause) {
      if (!isAmbiguousSendFailure(cause)) retainedToken.current = null;
      throw cause;
    }
  }

  return { ...mutation, mutateAsync };
}

export function useReplyToDocument() {
  return useEmailSendMutation<DocumentEmailReplyPayload>("reply");
}

export function useForwardDocument() {
  return useEmailSendMutation<DocumentEmailForwardPayload>("forward");
}

/** Promotion is deliberately a separate action from viewing an inbound attachment. */
export function usePromoteInboundAttachment() {
  const queryClient = useQueryClient();
  return useMutation<InboundPromotionResponse, Error, { id: string; attachmentId: string }>({
    mutationFn: ({ id, attachmentId }) => api.post<InboundPromotionResponse>(
      `/api/documents/${id}/inbound-attachments/${attachmentId}/promote`,
      {},
    ),
    retry: false,
    onSuccess: (_response, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ["inbound-attachments", id] });
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
      void invalidateInvoiceCollections(queryClient, [id]);
    },
  });
}

export function useUpdateCoiManualValues() {
  const queryClient = useQueryClient();
  return useMutation<UpdateCoiManualValuesResponse, Error, { id: string; payload: UpdateCoiManualValuesPayload }>({
    mutationFn: ({ id, payload }) => api.patch<UpdateCoiManualValuesResponse>(`/api/invoices/${id}/coi-manual-values`, payload),
    onSuccess: (data, { id }) => queryClient.setQueryData<Invoice | undefined>(["invoice", id], (current) => current ? { ...current, compliance: data.compliance } : current),
  });
}

/** Seeds the detail cache only with the canonical invoice returned by the endpoint. */
export function useUpdateStatementAttributes() {
  const queryClient = useQueryClient();
  return useMutation<UpdateStatementAttributesResponse, Error, { id: string; payload: UpdateStatementAttributesPayload }>({
    mutationFn: ({ id, payload }) => api.patch<UpdateStatementAttributesResponse>(`/api/invoices/${id}/statement-attributes`, payload),
    onSuccess: ({ invoice }, { id }) => {
      queryClient.setQueryData<Invoice>(["invoice", id], (prev) => ({
        ...invoice,
        waiverActions: invoice.waiverActions ?? prev?.waiverActions,
      }));
    },
  });
}

/** Replaces the canonical invoice returned by the warranty correction endpoint. */
export function useUpdateWarrantyClassification() {
  const queryClient = useQueryClient();
  return useMutation<UpdateWarrantyClassificationResponse, Error, { id: string; payload: UpdateWarrantyClassificationPayload }>({
    mutationFn: ({ id, payload }) => api.patch<UpdateWarrantyClassificationResponse>(`/api/invoices/${id}/warranty-classification`, payload),
    onSuccess: ({ invoice }, { id }) => {
      queryClient.setQueryData<Invoice>(["invoice", id], (prev) => ({
        ...invoice,
        waiverActions: invoice.waiverActions ?? prev?.waiverActions,
      }));
    },
  });
}

// ─── useUpdateInvoice ─────────────────────────────────────────────────────────

export function useUpdateInvoice() {
  const queryClient = useQueryClient();
  return useMutation<InvoiceUpdateResponse, Error, { id: string; payload: InvoiceUpdatePayload; suppressErrorToast?: boolean }>({
    mutationFn: async ({ id, payload }: { id: string; payload: InvoiceUpdatePayload; suppressErrorToast?: boolean }) => {
      const response = await api.patch<InvoiceUpdateResponse>(`/api/invoices/${id}`, payload);
      return { ...response.invoice, ...response };
    },
    onSuccess: ({ invoice, approvalVerdict }: InvoiceUpdateResponse, { id, payload }: { id: string; payload: InvoiceUpdatePayload; suppressErrorToast?: boolean }) => {
      queryClient.setQueryData(["invoice", id], (prev: Invoice | undefined) => ({
        ...invoice,
        waiverActions: invoice.waiverActions ?? prev?.waiverActions,
      }));
      queryClient.setQueryData(approvalVerdictQueryKey(invoice), approvalVerdict);
      markInvoiceListsStale(queryClient);
      if (payload.jobNumber) {
        void queryClient.invalidateQueries({ queryKey: ["jobFolders", payload.jobNumber], exact: true });
      }
    },
    // Surface every non-2xx PATCH — autosave failures were silently swallowed.
    // Fires in ADDITION to any per-call onError (which the form uses for the
    // inline locked-field ring). The document-panel `onUpdateDocument` path
    // already toasts in the doc-spec layer, so it opts out via
    // `suppressErrorToast` to avoid double-notifying.
    onError: (err: Error, { suppressErrorToast }: { id: string; payload: InvoiceUpdatePayload; suppressErrorToast?: boolean }) => {
      if (suppressErrorToast) return;
      toast.error(isApiError(err) ? err.message : "Failed to save changes", {
        description: "Your latest edit was not saved.",
      });
    },
  });
}

export function useSaveInvoiceBeforeSpectrumSubmit() {
  return useMutation<Invoice, Error, { id: string; payload: InvoiceUpdatePayload }>({
    mutationFn: ({ id, payload }: { id: string; payload: InvoiceUpdatePayload }) =>
      api.patch<Invoice>(`/api/invoices/${id}`, payload),
  });
}

// ─── useApproveInvoice ────────────────────────────────────────────────────────

export function useApproveInvoice() {
  const queryClient = useQueryClient();

  return useMutation<ApproveInvoiceResponse, Error, { id: string; payload?: ApprovePayload }>({
    mutationFn: ({ id, payload }: { id: string; payload?: ApprovePayload }) =>
      api.post<ApproveInvoiceResponse>(`/api/invoices/${id}/approve`, payload ?? {}),
    onSuccess: (_data: ApproveInvoiceResponse, { id }: { id: string; payload?: ApprovePayload }) => {
      invalidateInvoiceCollections(queryClient, id);
      void queryClient.invalidateQueries({ queryKey: ["invoice-orphan-waivers"] });
      void queryClient.invalidateQueries({ queryKey: ["lien-waiver-orphan-invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["audit", id] });
      void queryClient.invalidateQueries({ queryKey: ["invoiceActions", id] });
    },
  });
}

// ─── useUnapproveInvoice ─────────────────────────────────────────────────────

export function useUnapproveInvoice() {
  const queryClient = useQueryClient();
  return useMutation<Invoice, Error, { id: string }>({
    mutationFn: ({ id }: { id: string }) => api.post<Invoice>(`/api/invoices/${id}/unapprove`),
    onSuccess: (_data: Invoice, { id }: { id: string }) => {
      invalidateInvoiceCollections(queryClient, id);
      void queryClient.invalidateQueries({ queryKey: ["invoice-orphan-waivers"] });
      void queryClient.invalidateQueries({ queryKey: ["lien-waiver-orphan-invoices"] });
    },
  });
}

// ─── useRejectInvoice ─────────────────────────────────────────────────────────

export function useRejectInvoice() {
  const queryClient = useQueryClient();

  return useMutation<Invoice, Error, { id: string } & RejectPayload>({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<Invoice>(`/api/invoices/${id}/reject`, { reason }),
    onSuccess: (_data: Invoice, { id }: { id: string; reason: string }) => {
      invalidateInvoiceCollections(queryClient, id);
    },
  });
}

// ─── useDiscardInvoice ───────────────────────────────────────────────────────

export function useDiscardInvoice() {
  const queryClient = useQueryClient();
  return useMutation<DiscardInvoiceResponse, Error, { id: string } & DiscardPayload>({
    mutationFn: ({ id, reason, duplicateContext }: { id: string } & DiscardPayload) =>
      api.post<DiscardInvoiceResponse>(`/api/invoices/${id}/discard`, buildDiscardBody(reason, duplicateContext)),
    onSuccess: (_data: DiscardInvoiceResponse, { id }: { id: string } & DiscardPayload) => {
      invalidateInvoiceCollections(queryClient, id);
      void queryClient.invalidateQueries({ queryKey: ["audit", id] });
      void queryClient.invalidateQueries({ queryKey: ["invoiceActions", id] });
    },
  });
}

function buildDiscardBody(reason?: string, duplicateContext?: boolean): DiscardPayload | undefined {
  if (!reason && !duplicateContext) return undefined;
  return { ...(reason ? { reason } : {}), ...(duplicateContext ? { duplicateContext: true } : {}) };
}

/** Bypass and revert change the same server state, so they share one invalidation set. */
export function invalidateDuplicateResolution(queryClient: QueryClient, id: string) {
  void queryClient.invalidateQueries({ queryKey: ["duplicate-status", id] });
  invalidateInvoiceCollections(queryClient, id);
  void queryClient.invalidateQueries({ queryKey: ["validate-approval", id] });
  void queryClient.invalidateQueries({ queryKey: ["audit", id] });
}

export function useDuplicateBypass() {
  const queryClient = useQueryClient();
  return useMutation<DuplicateBypassResponse, Error, { id: string }>({
    mutationFn: ({ id }) => api.post<DuplicateBypassResponse>(`/api/invoices/${id}/duplicate-bypass`),
    onSuccess: (_data, { id }) => invalidateDuplicateResolution(queryClient, id),
  });
}

export function useRevertDuplicateBypass() {
  const queryClient = useQueryClient();
  return useMutation<DuplicateBypassResponse, Error, { id: string }>({
    mutationFn: ({ id }) => api.post<DuplicateBypassResponse>(`/api/invoices/${id}/duplicate-bypass/revert`),
    onSuccess: (_data, { id }) => invalidateDuplicateResolution(queryClient, id),
  });
}

// ─── useBulkAction ────────────────────────────────────────────────────────────

export function useBulkAction() {
  const queryClient = useQueryClient();
  return useMutation<BulkActionResponse, Error, BulkActionPayload>({
    mutationFn: (payload: BulkActionPayload) =>
      api.post<BulkActionResponse>("/api/invoices/bulk", payload),
    onSuccess: (_data: BulkActionResponse, payload: BulkActionPayload) => {
      invalidateInvoiceCollections(queryClient, payload.ids);
    },
  });
}

// ─── useSubmitToSpectrum ──────────────────────────────────────────────────────

export function useSubmitToSpectrum() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation<SubmitResponse, Error, SubmitPayload>({
    mutationFn: (payload: SubmitPayload) =>
      api.post<SubmitResponse>("/api/invoices/submit", payload),
    onSuccess: (data: SubmitResponse, payload: SubmitPayload) => {
      invalidateInvoiceCollections(queryClient, payload.ids);

      if (!data.success || data.submitted <= 0) {
        return;
      }

      const successfulResults = data.results?.filter((result) => result.success) ?? [];
      const submittedTargets = successfulResults.length > 0
        ? successfulResults.map((result) => ({
            id: result.id,
            label: result.invoiceNumber ?? result.id,
          }))
        : payload.ids.map((id) => ({ id, label: id }));

      submittedTargets.forEach((target) => {
        emitInvoiceAuditEvent(
          user,
          "invoice.submitted_spectrum",
          target.id,
          `Submitted invoice ${target.label} to Spectrum`,
          target.label,
        );
      });
    },
  });
}

// ─── useAddIgnoreRule ─────────────────────────────────────────────────────────

export function useAddIgnoreRule() {
  const queryClient = useQueryClient();
  return useMutation<IgnoreRule, Error, IgnoreRuleCreate>({
    mutationFn: (payload: IgnoreRuleCreate) =>
      api.post<IgnoreRule>("/api/ignore-rules", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ignoreRules"] });
    },
  });
}

// ─── useDeleteIgnoreRule ──────────────────────────────────────────────────────

export function useDeleteIgnoreRule() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }: { id: string }) => api.del<void>(`/api/ignore-rules/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ignoreRules"] });
    },
  });
}

// ─── Retention rules ─────────────────────────────────────────────────────────

export function useCreateRetentionRule() {
  const queryClient = useQueryClient();
  return useMutation<RetentionRule, Error, RetentionRuleCreatePayload>({
    mutationFn: (payload: RetentionRuleCreatePayload) =>
      api.post<RetentionRule>("/api/retention", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["retentionRules"] });
    },
  });
}

export function useUpdateRetentionRule() {
  const queryClient = useQueryClient();
  return useMutation<RetentionRule, Error, { id: number; payload: RetentionRuleUpdatePayload }>({
    mutationFn: ({ id, payload }: { id: number; payload: RetentionRuleUpdatePayload }) =>
      api.put<RetentionRule>(`/api/retention/${id}`, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["retentionRules"] });
    },
  });
}

export function useDeleteRetentionRule() {
  const queryClient = useQueryClient();
  return useMutation<RetentionRuleDeleteResponse, Error, { id: number }>({
    mutationFn: ({ id }: { id: number }) => api.del<RetentionRuleDeleteResponse>(`/api/retention/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["retentionRules"] });
    },
  });
}

// ─── Classification settings ────────────────────────────────────────────────

export function useCreateClassification() {
  const queryClient = useQueryClient();
  return useMutation<ClassificationCreateResponse, Error, ClassificationCreatePayload>({
    mutationFn: (payload: ClassificationCreatePayload) =>
      api.post<ClassificationCreateResponse>("/api/classifications", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["classifications"] });
    },
  });
}

export function useUpdateClassifications() {
  const queryClient = useQueryClient();
  return useMutation<ClassificationBatchUpdateResponse, Error, ClassificationBatchUpdatePayload>({
    mutationFn: (payload: ClassificationBatchUpdatePayload) =>
      api.put<ClassificationBatchUpdateResponse>("/api/classifications", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["classifications"] });
    },
  });
}

export function useDeleteClassification() {
  const queryClient = useQueryClient();
  return useMutation<ClassificationDeleteResponse, Error, ClassificationDeletePayload>({
    mutationFn: ({ name }: ClassificationDeletePayload) =>
      api.del<ClassificationDeleteResponse>(`/api/classifications/${encodeURIComponent(name)}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["classifications"] });
    },
  });
}

// ─── useRunPipeline ───────────────────────────────────────────────────────────

export function useRunPipeline() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => api.post<void>("/api/pipeline/run"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pipelineStatus"] });
    },
  });
}

// ─── useReclassifyInvoice ────────────────────────────────────────────────

export function useReclassifyInvoice() {
  const queryClient = useQueryClient();
  return useMutation<Invoice, Error, { id: string } & ReclassifyPayload>({
    mutationFn: ({ id, classification }: { id: string; classification: string }) =>
      api.post<Invoice>(`/api/invoices/${id}/reclassify`, { classification }),
    onSuccess: (_data: Invoice, { id }: { id: string; classification: string }) => {
      invalidateInvoiceCollections(queryClient, id);
    },
  });
}

// ─── useRetryInvoice ────────────────────────────────────────────────────

export function useRetryInvoice() {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean; id: string; status: string }, Error, { id: string }>({
    mutationFn: ({ id }: { id: string }) =>
      api.post<{ success: boolean; id: string; status: string }>(`/api/invoices/${id}/retry`),
    onSuccess: (_data: { success: boolean; id: string; status: string }, { id }: { id: string }) => {
      invalidateInvoiceCollections(queryClient, id);
    },
  });
}

// ─── useReprocessInvoice ────────────────────────────────────────────────────

/** Requests stored-file pipeline work; the server remains authoritative for completion. */
export function useReprocessInvoice() {
  const queryClient = useQueryClient();
  return useMutation<ReprocessInvoiceResponse, Error, { id: string }>({
    mutationFn: ({ id }: { id: string }) =>
      api.post<ReprocessInvoiceResponse>(`/api/invoices/${id}/reprocess`),
    onSuccess: (_data: ReprocessInvoiceResponse, { id }: { id: string }) => {
      invalidateInvoiceDetail(queryClient, id);
      void queryClient.invalidateQueries({ queryKey: ["audit", id] });
    },
  });
}
// ─── useRefreshSpectrum ───────────────────────────────────────────

export function useRefreshSpectrum() {
  return useMutation<SpectrumRefreshTriggerResponse, Error, void>({
    mutationFn: () => api.post<SpectrumRefreshTriggerResponse>("/api/vendors/refresh"),
  });
}

// ─── useFileDocument ──────────────────────────────────────────────────

/** Filing metadata accepted by POST /api/invoices/:id/file (2026-07-01) */
export interface FileDocumentInput extends FileDocumentPayload {
  id: string;
}

/** Files a record (filed=true → Documents Shelf), optionally persisting the
 * SharePoint destination/note/hold reason and uploading a copy to SharePoint. */
export function useFileDocument() {
  const queryClient = useQueryClient();
  return useMutation<FileDocumentResponse, Error, FileDocumentInput>({
    mutationFn: ({ id, ...body }: FileDocumentInput) =>
      api.post<FileDocumentResponse>(`/api/invoices/${id}/file`, body),
    onSuccess: ({ invoice }: FileDocumentResponse, { id }: FileDocumentInput) => {
      // The filing endpoint returns the canonical invoice, including the
      // successfully uploaded collision-resolved filename. Seed it directly
      // so the detail view never follows a successful mutation with a
      // recovery/readiness GET or briefly renders stale filing state.
      queryClient.setQueryData<Invoice>(["invoice", id], (prev) => ({
        ...invoice,
        waiverActions: invoice.waiverActions ?? prev?.waiverActions,
      }));
      markInvoiceCollectionsStale(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["audit", id] });
      void queryClient.invalidateQueries({ queryKey: ["invoiceActions", id] });
    },
  });
}

// ─── useUndoInvoiceAction ──────────────────────────────────────────────────

export function useUndoInvoiceAction() {
  const queryClient = useQueryClient();
  return useMutation<UndoActionResponse, Error, { id: string; actionId: string }>({
    mutationFn: ({ id, actionId }: { id: string; actionId: string }) =>
      api.post<UndoActionResponse>(`/api/invoices/${id}/actions/${actionId}/undo`),
    onSuccess: (_data: UndoActionResponse, { id }: { id: string; actionId: string }) => {
      invalidateInvoiceCollections(queryClient, id);
      void queryClient.invalidateQueries({ queryKey: ["audit", id] });
      void queryClient.invalidateQueries({ queryKey: ["invoiceActions", id] });
    },
  });
}

// ─── useReconcileStatement ──────────────────────────────────────────────────

type StatementReconciliationAction = "reconcile" | "unreconcile";

function useStatementReconciliation(action: StatementReconciliationAction) {
  const queryClient = useQueryClient();
  return useMutation<ReconcileDocumentResponse, Error, { id: string }>({
    mutationFn: async ({ id }: { id: string }) => {
      const response = await api.post<ReconcileDocumentResponse>(`/api/invoices/${id}/${action}`);
      if (!response.invoice) throw new Error("Reconcile endpoint returned no statement.");
      return response;
    },
    onSuccess: ({ invoice }: ReconcileDocumentResponse, { id }: { id: string }) => {
      queryClient.setQueryData(["invoice", id], (prev: Invoice | undefined) => ({
        ...invoice,
        waiverActions: invoice.waiverActions ?? prev?.waiverActions,
      }));
      markInvoiceListsStale(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["audit", id] });
      void queryClient.invalidateQueries({ queryKey: ["invoiceActions", id] });
    },
  });
}

/** Marks a statement reconciled via POST /api/invoices/:id/reconcile. */
export function useReconcileStatement() {
  return useStatementReconciliation("reconcile");
}

/** Marks a statement unreconciled via POST /api/invoices/:id/unreconcile. */
export function useUnreconcileStatement() {
  return useStatementReconciliation("unreconcile");
}

// ─── useFlagDocument / useUnflagDocument ─────────────────────────────────────

interface FlagDocumentVariables {
  id: string;
  reason?: string;
}

type QueryEntry<T> = [readonly unknown[], T | undefined];

interface FlagOptimisticContext {
  lists: QueryEntry<InvoiceListResponse>[];
  detailKey: readonly unknown[];
  detailSnapshot: Invoice | undefined;
  stats: QueryEntry<DashboardStats>[];
}

/**
 * Optimistically flip a document's review flag across every affected cache —
 * list rows, the detail record, and `stats.flaggedCount` — and return the
 * pre-change snapshots for rollback. The glyph reads `flaggedAt` from these
 * caches, so writing them here makes the glyph flip on click without waiting on
 * the request. Unflagging inside the server-filtered "Flagged" view removes the
 * row from that list immediately (it no longer belongs); other lists just clear
 * `flaggedAt`. Rollback restores the exact snapshots, so the server stays the
 * authority (e.g. a refused 403 unflag reverts).
 */
async function applyOptimisticFlag(
  queryClient: QueryClient,
  id: string,
  flag: boolean,
): Promise<FlagOptimisticContext> {
  // Cancel in-flight refetches so they can't clobber the optimistic writes.
  await Promise.all([
    queryClient.cancelQueries({ queryKey: ["invoices"] }),
    queryClient.cancelQueries({ queryKey: ["invoice", id] }),
    queryClient.cancelQueries({ queryKey: ["stats"] }),
  ]);

  const nextFlaggedAt = flag ? new Date().toISOString() : null;

  const lists = queryClient.getQueriesData<InvoiceListResponse>({ queryKey: ["invoices"] });
  for (const [key, data] of lists) {
    if (!data || !data.invoices.some((row) => row.id === id)) continue;
    const filters = (key[1] ?? {}) as { flagged?: boolean };
    const isFlaggedView = filters.flagged === true;

    if (!flag && isFlaggedView) {
      // Unflag inside the Flagged view → the row leaves the list immediately.
      queryClient.setQueryData<InvoiceListResponse>(key, {
        ...data,
        invoices: data.invoices.filter((row) => row.id !== id),
        total: typeof data.total === "number" ? Math.max(0, data.total - 1) : data.total,
      });
    } else {
      queryClient.setQueryData<InvoiceListResponse>(key, {
        ...data,
        invoices: data.invoices.map((row) =>
          row.id === id ? { ...row, flaggedAt: nextFlaggedAt } : row,
        ),
      });
    }
  }

  const detailKey = ["invoice", id] as const;
  const detailSnapshot = queryClient.getQueryData<Invoice>(detailKey);
  if (detailSnapshot) {
    queryClient.setQueryData<Invoice>(detailKey, { ...detailSnapshot, flaggedAt: nextFlaggedAt });
  }

  const stats = queryClient.getQueriesData<DashboardStats>({ queryKey: ["stats"] });
  for (const [key, data] of stats) {
    if (!data) continue;
    const current = data.flaggedCount ?? 0;
    queryClient.setQueryData<DashboardStats>(key, {
      ...data,
      flaggedCount: Math.max(0, current + (flag ? 1 : -1)),
    });
  }

  return { lists, detailKey, detailSnapshot, stats };
}

function rollbackOptimisticFlag(queryClient: QueryClient, context: FlagOptimisticContext | undefined) {
  if (!context) return;
  context.lists.forEach(([key, data]) => queryClient.setQueryData(key, data));
  if (context.detailSnapshot) {
    queryClient.setQueryData(context.detailKey, context.detailSnapshot);
  }
  context.stats.forEach(([key, data]) => queryClient.setQueryData(key, data));
}

// Targeted reconciliation after the request settles. The UI never waits on
// this — the optimistic caches already reflect the change; this only re-syncs
// with the server-authoritative state (and drops an unflagged row from the
// Flagged view if it had not been removed optimistically).
function settleOptimisticFlag(queryClient: QueryClient, id: string) {
  invalidateInvoiceCollections(queryClient, id);
  void queryClient.invalidateQueries({ queryKey: ["audit", id] });
  void queryClient.invalidateQueries({ queryKey: ["invoiceActions", id] });
}

/**
 * Flags a document for review ("needs attention") via POST /api/invoices/:id/flag.
 * Optimistic: the glyph and flaggedCount flip on click; a failed request rolls
 * back to the snapshot. The server remains authoritative via the onSettled
 * reconciliation.
 */
export function useFlagDocument() {
  const queryClient = useQueryClient();
  return useMutation<FlagDocumentResponse, unknown, FlagDocumentVariables, FlagOptimisticContext>({
    mutationFn: ({ id, reason }: FlagDocumentVariables) => {
      const trimmed = reason?.trim();
      return api.post<FlagDocumentResponse>(
        `/api/invoices/${id}/flag`,
        trimmed ? { reason: trimmed } : undefined,
      );
    },
    onMutate: ({ id }: FlagDocumentVariables) => applyOptimisticFlag(queryClient, id, true),
    onError: (_error: unknown, _vars: FlagDocumentVariables, context) =>
      rollbackOptimisticFlag(queryClient, context),
    onSettled: (_data, _error, { id }: FlagDocumentVariables) => settleOptimisticFlag(queryClient, id),
  });
}

/**
 * Removes a document's review flag via POST /api/invoices/:id/unflag.
 * Optimistic in BOTH directions: the glyph clears on click and the row leaves
 * the Flagged view immediately. Unflag authorization is server-decided (only the
 * original flagger or a manage_rules holder), so a non-flagger's 403 rolls the
 * optimistic change back — the server stays the authority and the flag returns.
 */
export function useUnflagDocument() {
  const queryClient = useQueryClient();
  return useMutation<UnflagDocumentResponse, unknown, { id: string }, FlagOptimisticContext>({
    mutationFn: ({ id }: { id: string }) =>
      api.post<UnflagDocumentResponse>(`/api/invoices/${id}/unflag`),
    onMutate: ({ id }: { id: string }) => applyOptimisticFlag(queryClient, id, false),
    onError: (_error: unknown, _vars: { id: string }, context) =>
      rollbackOptimisticFlag(queryClient, context),
    onSettled: (_data, _error, { id }: { id: string }) => settleOptimisticFlag(queryClient, id),
  });
}

// ─── useAddStatementLine ─────────────────────────────────────────────────────

/** Adds and rematches one statement line via POST /api/invoices/:id/statement-lines */
export function useAddStatementLine() {
  const queryClient = useQueryClient();
  return useMutation<AddStatementLineResponse, Error, { id: string; payload: AddStatementLinePayload }>({
    mutationFn: ({ id, payload }: { id: string; payload: AddStatementLinePayload }) =>
      api.post<AddStatementLineResponse>(`/api/invoices/${id}/statement-lines`, payload),
    onSuccess: (_data: AddStatementLineResponse, { id }: { id: string; payload: AddStatementLinePayload }) => {
      invalidateInvoiceDetail(queryClient, id);
      void queryClient.invalidateQueries({ queryKey: ["audit", id] });
      void queryClient.invalidateQueries({ queryKey: ["invoiceActions", id] });
    },
  });
}

// ─── useUpdateStatementLine ──────────────────────────────────────────────────

/** Updates and rematches one statement line via PATCH /api/invoices/:id/statement-lines/:lineId */
export function useUpdateStatementLine() {
  const queryClient = useQueryClient();
  return useMutation<UpdateStatementLineResponse, Error, { id: string; lineId: string; payload: UpdateStatementLinePayload }>({
    mutationFn: ({ id, lineId, payload }: { id: string; lineId: string; payload: UpdateStatementLinePayload }) =>
      api.patch<UpdateStatementLineResponse>(`/api/invoices/${id}/statement-lines/${encodeURIComponent(lineId)}`, payload),
    onSuccess: (_data: UpdateStatementLineResponse, { id }: { id: string; lineId: string; payload: UpdateStatementLinePayload }) => {
      invalidateInvoiceDetail(queryClient, id);
      void queryClient.invalidateQueries({ queryKey: ["audit", id] });
      void queryClient.invalidateQueries({ queryKey: ["invoiceActions", id] });
    },
  });
}

// ─── useDeleteStatementLine ──────────────────────────────────────────────────

/** Removes and rematches one statement line via DELETE /api/invoices/:id/statement-lines/:lineId */
export function useDeleteStatementLine() {
  const queryClient = useQueryClient();
  return useMutation<DeleteStatementLineResponse, Error, { id: string; lineId: string }>({
    mutationFn: ({ id, lineId }: { id: string; lineId: string }) =>
      api.del<DeleteStatementLineResponse>(`/api/invoices/${id}/statement-lines/${encodeURIComponent(lineId)}`),
    onSuccess: (_data: DeleteStatementLineResponse, { id }: { id: string; lineId: string }) => {
      invalidateInvoiceDetail(queryClient, id);
      void queryClient.invalidateQueries({ queryKey: ["audit", id] });
      void queryClient.invalidateQueries({ queryKey: ["invoiceActions", id] });
    },
  });
}

// ─── useResolveStatementLine ─────────────────────────────────────────────────

export function useResolveStatementLine() {
  const queryClient = useQueryClient();
  return useMutation<StatementLineResolutionResponse, Error, { id: string; lineId: string; payload: ResolveStatementLinePayload }>({
    mutationFn: ({ id, lineId, payload }) =>
      api.post<StatementLineResolutionResponse>(`/api/invoices/${id}/statement-lines/${encodeURIComponent(lineId)}/resolve`, payload),
    onSuccess: (_data, { id }) => {
      invalidateInvoiceDetail(queryClient, id);
      void queryClient.invalidateQueries({ queryKey: ["audit", id] });
    },
  });
}

export function useUnresolveStatementLine() {
  const queryClient = useQueryClient();
  return useMutation<StatementLineResolutionResponse, Error, { id: string; lineId: string }>({
    mutationFn: ({ id, lineId }) =>
      api.post<StatementLineResolutionResponse>(`/api/invoices/${id}/statement-lines/${encodeURIComponent(lineId)}/unresolve`),
    onSuccess: (_data, { id }) => {
      invalidateInvoiceDetail(queryClient, id);
      void queryClient.invalidateQueries({ queryKey: ["audit", id] });
    },
  });
}

// ─── useRematchStatementLines ────────────────────────────────────────────────

/** Re-checks all statement lines via POST /api/invoices/:id/statement-lines/rematch */
export function useRematchStatementLines() {
  const queryClient = useQueryClient();
  return useMutation<RematchStatementLinesResponse, Error, { id: string }>({
    mutationFn: ({ id }: { id: string }) =>
      api.post<RematchStatementLinesResponse>(`/api/invoices/${id}/statement-lines/rematch`),
    onSuccess: ({ invoice }: RematchStatementLinesResponse, { id }: { id: string }) => {
      queryClient.setQueryData<Invoice>(["invoice", id], (prev) => ({
        ...invoice,
        waiverActions: invoice.waiverActions ?? prev?.waiverActions,
      }));
      void queryClient.invalidateQueries({ queryKey: ["audit", id] });
      void queryClient.invalidateQueries({ queryKey: ["invoiceActions", id] });
    },
  });
}

// ─── useUploadCoiToSpectrum ─────────────────────────────────────────────────

/** Queues a COI document for asynchronous Spectrum upload. */
export function useUploadCoiToSpectrum() {
  const queryClient = useQueryClient();
  return useMutation<UploadCoiToSpectrumResponse, Error, { id: string; payload: UploadCoiToSpectrumPayload }>({
    mutationFn: ({ id, payload }: { id: string; payload: UploadCoiToSpectrumPayload }) =>
      api.post<UploadCoiToSpectrumResponse>(`/api/documents/${id}/upload-to-spectrum`, payload),
    onSuccess: (_data: UploadCoiToSpectrumResponse, { id }: { id: string; payload: UploadCoiToSpectrumPayload }) => {
      invalidateInvoiceCollections(queryClient, id);
      void queryClient.invalidateQueries({ queryKey: ["audit", id] });
      void queryClient.invalidateQueries({ queryKey: ["invoiceActions", id] });
    },
  });
}

function replaceActiveCoiOverrides(
  queryClient: QueryClient,
  id: string,
  activeOverrides: Invoice["coiOverrides"],
  compliance: Invoice["compliance"],
) {
  queryClient.setQueryData<Invoice>(["invoice", id], (current) => (
    current ? { ...current, coiOverrides: activeOverrides ?? [], compliance } : current
  ));
}

/** Applies a persisted COI override; server response is the only local state authority. */
export function useApplyCoiOverride() {
  const queryClient = useQueryClient();
  return useMutation<ApplyCoiOverrideResponse, Error, { id: string; payload: ApplyCoiOverridePayload }>({
    mutationFn: ({ id, payload }) => api.post<ApplyCoiOverrideResponse>(`/api/invoices/${id}/coi-overrides`, payload),
    onSuccess: (data, { id }) => replaceActiveCoiOverrides(queryClient, id, data.activeOverrides, data.compliance),
  });
}

/** Revokes a persisted COI override; retained history remains server-owned. */
export function useRevokeCoiOverride() {
  const queryClient = useQueryClient();
  return useMutation<RevokeCoiOverrideResponse, Error, { id: string; checkId: string }>({
    mutationFn: ({ id, checkId }) => api.del<RevokeCoiOverrideResponse>(`/api/invoices/${id}/coi-overrides/${checkId}`),
    onSuccess: (data, { id }) => replaceActiveCoiOverrides(queryClient, id, data.activeOverrides, data.compliance),
  });
}

// ─── useMarkReviewed ─────────────────────────────────────────────────

export function useMarkReviewed() {
  const queryClient = useQueryClient();
  return useMutation<MarkReviewedResponse, Error, { id: string }>({
    mutationFn: ({ id }: { id: string }) =>
      api.post<MarkReviewedResponse>(`/api/invoices/${id}/review`),
    onSuccess: (_data: MarkReviewedResponse, { id }: { id: string }) => {
      invalidateInvoiceCollections(queryClient, id);
    },
  });
}

// ─── useDeleteInvoice ────────────────────────────────────────────────

export function useDeleteInvoice() {
  const queryClient = useQueryClient();

  return useMutation<DeleteDocumentResponse, Error, { id: string }>({
    mutationFn: ({ id }: { id: string }) =>
      api.del<DeleteDocumentResponse>(`/api/invoices/${id}`),
    onSuccess: (_data: DeleteDocumentResponse, { id }: { id: string }) => {
      invalidateInvoiceCollections(queryClient, id);
    },
  });
}

// ─── useRestoreInvoice ───────────────────────────────────────────────────────

export function useRestoreInvoice() {
  const queryClient = useQueryClient();

  return useMutation<RestoreInvoiceResponse, Error, { id: string }>({
    mutationFn: ({ id }: { id: string }) =>
      api.post<RestoreInvoiceResponse>(`/api/invoices/${id}/restore`),
    onSuccess: (_data: RestoreInvoiceResponse, { id }: { id: string }) => {
      invalidateInvoiceCollections(queryClient, id);
    },
  });
}

// ─── usePermanentDelete ──────────────────────────────────────────────────────

export function usePermanentDelete() {
  const queryClient = useQueryClient();

  return useMutation<PermanentDeleteResponse, Error, { id: string }>({
    mutationFn: ({ id }: { id: string }) =>
      api.del<PermanentDeleteResponse>(`/api/invoices/${id}/permanent`),
    onSuccess: (_data: PermanentDeleteResponse, { id }: { id: string }) => {
      invalidateInvoiceCollections(queryClient, id);
    },
  });
}

// ─── useLinkWaiver ───────────────────────────────────────────────────

export function useLinkWaiver() {
  const queryClient = useQueryClient();
  return useMutation<LinkWaiverResponse, Error, { invoiceId: string; waiverId: string }>({
    mutationFn: ({ invoiceId, waiverId }: { invoiceId: string; waiverId: string }) =>
      api.post<LinkWaiverResponse>(`/api/invoices/${invoiceId}/link-waiver`, { waiverId }),
    onSuccess: (_data: LinkWaiverResponse, { invoiceId, waiverId }: { invoiceId: string; waiverId: string }) => {
      // Linking also shelves the waiver on the server. Refresh both detail
      // records plus queue/navigation/stats/shelf collections as one lifecycle.
      invalidateInvoiceCollections(queryClient, [invoiceId, waiverId]);
      void queryClient.invalidateQueries({ queryKey: ["invoice-orphan-waivers", invoiceId] });
      void queryClient.invalidateQueries({ queryKey: ["lien-waiver-orphan-invoices", waiverId] });
      // Re-fetch the approval verdict: linking a waiver clears the "Lien Waiver
      // is required" blocker, but the waiver state is not in the verdict's
      // queryKey fingerprint, so it does not refetch on its own. Prefix key
      // matches all fingerprints.
      void queryClient.invalidateQueries({ queryKey: ["validate-approval", invoiceId] });
    },
  });
}

// ─── useUnlinkWaiver ─────────────────────────────────────────────────

export function useUnlinkWaiver() {
  const queryClient = useQueryClient();
  return useMutation<UnlinkWaiverResponse, Error, { invoiceId: string; waiverId?: string }>({
    mutationFn: ({ invoiceId }: { invoiceId: string; waiverId?: string }) =>
      api.del<UnlinkWaiverResponse>(`/api/invoices/${invoiceId}/link-waiver`),
    onSuccess: (_data: UnlinkWaiverResponse, { invoiceId, waiverId }: { invoiceId: string; waiverId?: string }) => {
      // Unlinking removes the waiver from the shelf and returns it to the
      // active queue, so refresh every collection that owns that lifecycle.
      invalidateInvoiceCollections(queryClient, waiverId ? [invoiceId, waiverId] : invoiceId);
      void queryClient.invalidateQueries({ queryKey: ["invoice-orphan-waivers", invoiceId] });
      if (waiverId) {
        void queryClient.invalidateQueries({ queryKey: ["lien-waiver-orphan-invoices", waiverId] });
      }
      // Unlinking a waiver may re-add the "Lien Waiver is required" blocker — refetch the verdict.
      void queryClient.invalidateQueries({ queryKey: ["validate-approval", invoiceId] });
    },
  });
}

// ─── useSetWaiverOverride ──────────────────────────────────────────────────

export function useSetWaiverOverride() {
  const queryClient = useQueryClient();
  return useMutation<WaiverOverrideResponse, Error, { invoiceId: string }>({
    mutationFn: ({ invoiceId }: { invoiceId: string }) =>
      api.post<WaiverOverrideResponse>(`/api/invoices/${invoiceId}/waiver-override`),
    onSuccess: ({ invoice }: WaiverOverrideResponse, { invoiceId }: { invoiceId: string }) => {
      queryClient.setQueryData<Invoice>(["invoice", invoiceId], (prev) => ({
        ...invoice,
        waiverActions: invoice.waiverActions ?? prev?.waiverActions,
      }));
      void queryClient.invalidateQueries({ queryKey: ["audit", invoiceId] });
      void queryClient.invalidateQueries({ queryKey: ["invoiceActions", invoiceId] });
      // Marking "waiver on document" clears the required-waiver blocker — refetch the verdict.
      void queryClient.invalidateQueries({ queryKey: ["validate-approval", invoiceId] });
    },
  });
}

// ─── useRequestWaiver ─────────────────────────────────────────────────────

interface RequestWaiverVariables {
  invoiceId: string;
  resend?: boolean;
  recipientOverride?: string;
}

export function useRequestWaiver() {
  const queryClient = useQueryClient();
  return useMutation<RequestWaiverResponse, Error, RequestWaiverVariables>({
    mutationFn: ({ invoiceId, resend = false, recipientOverride }: RequestWaiverVariables) => {
      const path = `/api/invoices/${invoiceId}/request-waiver`;
      const payload: RequestWaiverPayload | undefined = resend || recipientOverride
        ? { ...(resend ? { resend: true } : {}), ...(recipientOverride ? { recipientOverride } : {}) }
        : undefined;
      return payload
        ? api.post<RequestWaiverResponse>(path, payload)
        : api.post<RequestWaiverResponse>(path);
    },
    onSuccess: ({ invoice }: RequestWaiverResponse, { invoiceId }: RequestWaiverVariables) => {
      queryClient.setQueryData<Invoice>(["invoice", invoiceId], (prev) => ({
        ...invoice,
        waiverActions: invoice.waiverActions ?? prev?.waiverActions,
      }));
      void queryClient.invalidateQueries({ queryKey: ["waiverRecipient", invoiceId] });
      void queryClient.invalidateQueries({ queryKey: ["audit", invoiceId] });
      void queryClient.invalidateQueries({ queryKey: ["invoiceActions", invoiceId] });
    },
  });
}

/** Adds a contact and replaces the recipient directory with the server's array. */
export function useAddWaiverContact() {
  const queryClient = useQueryClient();
  return useMutation<AddWaiverContactResponse, Error, { invoiceId: string } & AddWaiverContactPayload>({
    mutationFn: ({ invoiceId, email, name }) => {
      const payload: AddWaiverContactPayload = {
        email: email.trim(),
        ...(name?.trim() ? { name: name.trim() } : {}),
      };
      return api.post<AddWaiverContactResponse>(`/api/invoices/${invoiceId}/waiver-contacts`, payload);
    },
    onSuccess: ({ directoryContacts }, { invoiceId }) => {
      queryClient.setQueryData<WaiverRecipientResponse>(waiverRecipientQueryKey(invoiceId), (current) => (
        current ? { ...current, directoryContacts } : current
      ));
    },
  });
}

// ─── useAttachFile ─────────────────────────────────────────────────────────

interface AttachFileVariables {
  invoiceId: string;
  file: File;
}

export function useAttachFile() {
  const queryClient = useQueryClient();
  return useMutation<AttachFileResponse, unknown, AttachFileVariables>({
    mutationFn: ({ invoiceId, file }: AttachFileVariables) => {
      const body = new FormData();
      body.append("file", file);
      return api.postForm<AttachFileResponse>(`/api/invoices/${invoiceId}/attach-file`, body);
    },
    onSuccess: (_data: AttachFileResponse, { invoiceId }: AttachFileVariables) => {
      invalidateInvoiceDetail(queryClient, invoiceId);
      markInvoiceListsStale(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["audit", invoiceId] });
      void queryClient.invalidateQueries({ queryKey: ["invoiceActions", invoiceId] });
    },
    onError: (error: unknown, { invoiceId }: AttachFileVariables) => {
      if (isApiError(error) && error.status === 409) {
        invalidateInvoiceDetail(queryClient, invoiceId);
      }
    },
  });
}

// ─── useRevertWaiverOverride ────────────────────────────────────────────────

export function useRevertWaiverOverride() {
  const queryClient = useQueryClient();
  return useMutation<WaiverOverrideResponse, Error, { invoiceId: string }>({
    mutationFn: ({ invoiceId }: { invoiceId: string }) =>
      api.post<WaiverOverrideResponse>(`/api/invoices/${invoiceId}/waiver-override/revert`),
    onSuccess: ({ invoice }: WaiverOverrideResponse, { invoiceId }: { invoiceId: string }) => {
      queryClient.setQueryData<Invoice>(["invoice", invoiceId], (prev) => ({
        ...invoice,
        waiverActions: invoice.waiverActions ?? prev?.waiverActions,
      }));
      void queryClient.invalidateQueries({ queryKey: ["audit", invoiceId] });
      void queryClient.invalidateQueries({ queryKey: ["invoiceActions", invoiceId] });
      // Reverting "waiver on document" re-adds the required-waiver blocker —
      // refetch the verdict so the approve gate re-blocks (money-path safety).
      void queryClient.invalidateQueries({ queryKey: ["validate-approval", invoiceId] });
    },
  });
}

// ─── useSetWaiverBypass ────────────────────────────────────────────────────

export function useSetWaiverBypass() {
  const queryClient = useQueryClient();
  return useMutation<WaiverBypassResponse, Error, { invoiceId: string }>({
    mutationFn: ({ invoiceId }) => api.post<WaiverBypassResponse>(`/api/invoices/${invoiceId}/waiver-bypass`),
    onSuccess: ({ invoice }, { invoiceId }) => {
      queryClient.setQueryData<Invoice>(["invoice", invoiceId], (prev) => ({
        ...invoice,
        waiverActions: invoice.waiverActions ?? prev?.waiverActions,
      }));
      void queryClient.invalidateQueries({ queryKey: ["audit", invoiceId] });
      void queryClient.invalidateQueries({ queryKey: ["invoiceActions", invoiceId] });
      void queryClient.invalidateQueries({ queryKey: ["validate-approval", invoiceId] });
    },
  });
}

// ─── useRevertWaiverBypass ─────────────────────────────────────────────────

export function useRevertWaiverBypass() {
  const queryClient = useQueryClient();
  return useMutation<WaiverBypassResponse, Error, { invoiceId: string }>({
    mutationFn: ({ invoiceId }) => api.post<WaiverBypassResponse>(`/api/invoices/${invoiceId}/waiver-bypass/revert`),
    onSuccess: ({ invoice }, { invoiceId }) => {
      queryClient.setQueryData<Invoice>(["invoice", invoiceId], (prev) => ({
        ...invoice,
        waiverActions: invoice.waiverActions ?? prev?.waiverActions,
      }));
      void queryClient.invalidateQueries({ queryKey: ["audit", invoiceId] });
      void queryClient.invalidateQueries({ queryKey: ["invoiceActions", invoiceId] });
      void queryClient.invalidateQueries({ queryKey: ["validate-approval", invoiceId] });
    },
  });
}

// ─── useConfirmSplit ──────────────────────────────────────────────────────────

export function useConfirmSplit() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation<ConfirmSplitResponse, Error, { id: string; payload: ConfirmSplitRequest }>({
    mutationFn: ({ id, payload }: { id: string; payload: ConfirmSplitRequest }) =>
      api.post<ConfirmSplitResponse>(`/api/splits/${id}/confirm`, payload),
    onSuccess: (data: ConfirmSplitResponse, { id }: { id: string; payload: ConfirmSplitRequest }) => {
      void queryClient.invalidateQueries({ queryKey: ["splits", "queue"] });
      invalidateInvoiceCollections(queryClient, [id, ...data.childIds]);

      data.childIds.forEach((childId) => {
        emitInvoiceAuditEvent(
          user,
          "invoice.split_created",
          childId,
          `Created split invoice ${childId} from ${data.parentId || id}`,
          childId,
        );
      });
    },
  });
}

// ─── useCancelSplit ───────────────────────────────────────────────────────────

export function useCancelSplit() {
  const queryClient = useQueryClient();
  return useMutation<{ id: string; status: string }, Error, { id: string }>({
    mutationFn: ({ id }: { id: string }) =>
      api.post<{ id: string; status: string }>(`/api/splits/${id}/cancel`),
    onSuccess: (_data: { id: string; status: string }, { id }: { id: string }) => {
      void queryClient.invalidateQueries({ queryKey: ["splits", "queue"] });
      invalidateInvoiceCollections(queryClient, id);
    },
  });
}

// ─── useRejectSplit ───────────────────────────────────────────────────────────

export function useRejectSplit() {
  const queryClient = useQueryClient();
  return useMutation<{ id: string; status: string }, Error, { id: string; reason: string }>({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<{ id: string; status: string }>(`/api/splits/${id}/reject`, { reason }),
    onSuccess: (_data: { id: string; status: string }, { id }: { id: string; reason: string }) => {
      void queryClient.invalidateQueries({ queryKey: ["splits", "queue"] });
      invalidateInvoiceCollections(queryClient, id);
    },
  });
}

// ─── useAnalyzeSplit ──────────────────────────────────────────────────────────

/** Triggers fresh Haiku analysis on a needs-split doc. ~10-20s. */
export function useAnalyzeSplit() {
  const queryClient = useQueryClient();
  return useMutation<AnalyzeSplitResponse, Error, string>({
    mutationFn: (id: string) =>
      api.post<AnalyzeSplitResponse>(`/api/splits/${id}/analyze`),
    onSuccess: (data: AnalyzeSplitResponse) => {
      void queryClient.invalidateQueries({ queryKey: ["splits", "doc", data.id] });
    },
  });
}

// ─── useFlagForSplit ─────────────────────────────────────────────────────────────

/** Flags a pending invoice for split review, transitions to `needs-split`. */
export function useFlagForSplit() {
  const queryClient = useQueryClient();
  return useMutation<FlagForSplitResponse, Error, { id: string }>({
    mutationFn: ({ id }: { id: string }) =>
      api.post<FlagForSplitResponse>(`/api/invoices/${id}/flag-for-split`),
    onSuccess: (_data: FlagForSplitResponse, { id }: { id: string }) => {
      invalidateInvoiceCollections(queryClient, id);
    },
  });
}

// ─── useSetPhaseAllocations ─────────────────────────────────────────────────────

/** PATCH /api/invoices/:id/phase-allocations — set or clear phase allocation */
export function useSetPhaseAllocations() {
  const queryClient = useQueryClient();
  return useMutation<
    SetPhaseAllocationsResponse,
    Error,
    {
      invoiceId: string;
      allocations: Array<{ phase_code: string; amount: number; description?: string }> | null;
    }
  >({
    mutationFn: ({ invoiceId, allocations }: { invoiceId: string; allocations: Array<{ phase_code: string; amount: number; description?: string }> | null }) =>
      api.patch<SetPhaseAllocationsResponse>(
        `/api/invoices/${invoiceId}/phase-allocations`,
        { allocations },
      ),
    onSuccess: (_data: SetPhaseAllocationsResponse, { invoiceId }: { invoiceId: string }) => {
      invalidateInvoiceDetail(queryClient, invoiceId);
      void queryClient.invalidateQueries({ queryKey: ["phase-options", invoiceId] });
    },
  });
}
