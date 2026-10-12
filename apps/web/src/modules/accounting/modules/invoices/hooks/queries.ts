import { useEffect, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api, isApiError, type ApiError } from "@/modules/shared/lib/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { User } from "@/modules/shared/types/user";
import type {
  InvoiceListResponse,
  InvoiceNeighborsResponse,
  TrashListResponse,
  DashboardStats,
  Vendor,
  Job,
  Subcontract,
  RoutingCodesResponse,
  PhaseCodesResponse,
  GlAccountOption,
  GlAccountsResponse,
  ApprovalState,
  IgnoreRule,
  RetentionRule,
  PipelineStatus,
  ClassificationAssociation,
  ClassificationInfo,
  ClassificationsResponse,
  DocumentDestinationsConfig,
  RuleOptionsResponse,
  ApprovalSchemaResponse,
  CostTypesResponse,
  SpectrumRefreshStatus,
  AuditEntry,
  ActivityResponse,
  ForwardDefaultsResponse,
  ReplyRecipientResponse,
  InvoiceOrphanWaiversResponse,
  LienWaiverOrphanInvoicesResponse,
  SplitQueueResponse,
  SplitDoc,
  ChildStatusResponse,
  PhaseOptionsResponse,
  InvoiceActionsResponse,
  WaiverRecipientResponse,
  InboundAttachmentsResponse,
  DuplicateStatusResponse,
} from "@/modules/accounting/modules/invoices/types/api";
import type { InvoiceFilters, InvoicePanel } from "@/modules/accounting/modules/invoices/types/ui";
import { collaborationApiBase, collaborationQueryKey, type CollaborationRouteFamily } from "./collaborationRoutes";

const CLASSIFICATION_ENDPOINT = "/api/classifications?include=associations&status=all";

export const DEFAULT_CLASSIFICATION_ASSOCIATIONS: ClassificationAssociation[] = [
  { key: "invoice", label: "Invoice Workflow", description: "Opens in the invoice workflow." },
  { key: "receipt", label: "Receipt Panel", description: "Opens in the receipt document panel." },
  { key: "statement", label: "Statement Panel", description: "Opens in the statement document panel." },
  { key: "coi", label: "Certificate of Insurance Panel", description: "Opens in the certificate of insurance panel." },
  { key: "w9", label: "W-9 Panel", description: "Opens in the W-9 document panel." },
  { key: "lien-waiver", label: "Lien Waiver Panel", description: "Opens in the lien waiver document panel." },
  { key: "other", label: "Generic Panel", description: "Opens in the generic document panel." },
];

export const DEFAULT_MAPPINGS: ClassificationInfo[] = [
  { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
  { name: "receipt", label: "Receipt", opensAs: "receipt", action: "extract-match", builtIn: true, status: "active" },
  { name: "pay-application", label: "Pay Application", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
  { name: "statement", label: "Statement", opensAs: "statement", action: "view-only", builtIn: true, status: "active" },
  { name: "coi", label: "Certificate of Insurance", opensAs: "coi", action: "view-only", builtIn: true, status: "active" },
  { name: "w9", label: "W-9 Tax Form", opensAs: "w9", action: "view-only", builtIn: true, status: "active" },
  { name: "lien-waiver", label: "Lien Waiver", opensAs: "lien-waiver", action: "view-only", builtIn: true, status: "active" },
  { name: "warranty", label: "Warranty", opensAs: "warranty", action: "view-only", builtIn: false, status: "active" },
  { name: "purchase-order", label: "Purchase Order", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
  { name: "credit-memo", label: "Credit Memo / Adjustment", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
  { name: "other", label: "Other / Unclassified", opensAs: "other", action: "view-only", builtIn: true, status: "active" },
];

export interface UseClassificationsResult extends Omit<UseQueryResult<ClassificationsResponse, Error | ApiError>, "data"> {
  data: ClassificationInfo[];
  classifications: ClassificationInfo[];
  availableAssociations: ClassificationAssociation[];
}

function defaultClassificationsResponse(): ClassificationsResponse {
  return {
    classifications: DEFAULT_MAPPINGS,
    availableAssociations: DEFAULT_CLASSIFICATION_ASSOCIATIONS,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isClassificationInfo(value: unknown): value is ClassificationInfo {
  if (!isRecord(value)) return false;
  const opensAs = value.opensAs;

  return (
    typeof value.name === "string" &&
    typeof value.label === "string" &&
    (typeof opensAs === "string" || opensAs === null) &&
    (value.action === "extract-match" || value.action === "view-only") &&
    typeof value.builtIn === "boolean" &&
    (value.status === "active" || value.status === "disabled") &&
    (value.addedAt === undefined || typeof value.addedAt === "string") &&
    (value.updatedAt === undefined || typeof value.updatedAt === "string") &&
    (value.updatedBy === undefined || typeof value.updatedBy === "string")
  );
}

function isClassificationAssociation(value: unknown): value is ClassificationAssociation {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.label === "string" &&
    typeof value.description === "string"
  );
}

function normalizeClassificationsResponse(value: unknown): ClassificationsResponse {
  if (!isRecord(value)) return defaultClassificationsResponse();

  const { classifications, availableAssociations } = value;
  if (!Array.isArray(classifications) || !Array.isArray(availableAssociations)) {
    return defaultClassificationsResponse();
  }

  if (classifications.length === 0 || !classifications.every(isClassificationInfo)) {
    return defaultClassificationsResponse();
  }

  if (!availableAssociations.every(isClassificationAssociation)) {
    return defaultClassificationsResponse();
  }

  return { classifications, availableAssociations };
}

// ─── useInvoices ──────────────────────────────────────────────────────────────

export function useInvoices(
  filters: InvoiceFilters & { splitFrom?: string },
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  // Send sort + sortDir as two separate query params (backend expects this).
  return useQuery<InvoiceListResponse>({
    queryKey: ["invoices", filters],
    queryFn: () =>
      api.get<InvoiceListResponse>("/api/invoices", filters as Record<string, string | number | boolean | undefined>),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

// ─── useInvoice ───────────────────────────────────────────────────────────────

// ─── useInvoiceNeighbors ─────────────────────────────────────────────────────
//
// GET /api/invoices/:id/neighbors — server-computed keyset prev/next for the
// detail-panel arrows and post-action auto-advance. The authoritative
// replacement for deriving neighbors from a large `/nav` page. It accepts the
// SAME filter/sort params as the list family MINUS pagination (page/limit/offset
// are 400s), so we pass exactly the queue's resolved server filters (built with
// `toInvoiceQueryFilters` at the call site) and pick the allowed keys here.
// Keyed on (id + params) so navigation refetches cleanly per document.
export function useInvoiceNeighbors(
  id: string,
  filters: InvoiceFilters & { splitFrom?: string },
  options?: { enabled?: boolean },
) {
  const params: Record<string, string | number | boolean | undefined> = {
    status: filters.status,
    search: filters.search,
    classification: filters.classification,
    panel: filters.panel,
    filed: filters.filed,
    flagged: filters.flagged,
    splitFrom: filters.splitFrom,
    sort: filters.sort,
    sortDir: filters.sortDir,
  };
  return useQuery<InvoiceNeighborsResponse>({
    queryKey: ["invoice-neighbors", id, params],
    queryFn: () => api.get<InvoiceNeighborsResponse>(`/api/invoices/${id}/neighbors`, params),
    enabled: !!id && (options?.enabled ?? true),
    staleTime: 60_000,
  });
}

export function fetchInvoice(id: string, includeDeleted = false) {
  return api.get<Invoice>(`/api/invoices/${id}`, includeDeleted ? { includeDeleted: true } : undefined);
}

export function useInvoice(id: string, options?: { includeDeleted?: boolean }) {
  const includeDeleted = options?.includeDeleted ?? false;
  return useQuery<Invoice>({
    // Preserve the long-standing active-record key: mutations and existing
    // detail consumers write ["invoice", id]. Deleted reads need isolation so
    // a soft-deleted response can never seed that active-record cache entry.
    queryKey: includeDeleted ? ["invoice", id, "includeDeleted"] : ["invoice", id],
    queryFn: () => fetchInvoice(id, includeDeleted),
    enabled: !!id,
  });
}

/** Live duplicate evaluation shared with approval enforcement; never inferred locally. */
export function useDuplicateStatus(id: string, options?: { enabled?: boolean }): UseQueryResult<DuplicateStatusResponse, Error | ApiError> {
  return useQuery<DuplicateStatusResponse, Error | ApiError>({
    queryKey: ["duplicate-status", id],
    queryFn: () => api.get<DuplicateStatusResponse>(`/api/invoices/${id}/duplicate-status`),
    enabled: !!id && (options?.enabled ?? true),
    staleTime: 15_000,
  });
}

// ─── useStats ─────────────────────────────────────────────────────────────────

export function useStats(params?: { filed?: boolean; panel?: InvoicePanel }) {
  return useQuery<DashboardStats>({
    queryKey: ["stats", params],
    queryFn: () => api.get<DashboardStats>("/api/invoices/stats", params as Record<string, string | number | boolean | undefined> | undefined),
    staleTime: 60_000,
  });
}

// ─── useTrash ────────────────────────────────────────────────────────────────

export function useTrash(
  params?: { limit?: number; offset?: number; search?: string; panel?: InvoicePanel },
  options?: { enabled?: boolean },
) {
  return useQuery<TrashListResponse>({
    queryKey: ["trash", params],
    queryFn: () =>
      api.get<TrashListResponse>(
        "/api/invoices/trash",
        params as Record<string, string | number | boolean | undefined> | undefined,
      ),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}

// ─── useVendorSearch ──────────────────────────────────────────────────────────

export function useVendorSearch(term: string) {
  const [debouncedTerm, setDebouncedTerm] = useState(term);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(term), 300);
    return () => clearTimeout(timer);
  }, [term]);

  return useQuery<Vendor[]>({
    queryKey: ["vendors", debouncedTerm],
    queryFn: () => api.get<Vendor[]>("/api/vendors", { search: debouncedTerm || undefined, limit: 100 }),
    staleTime: 60_000,
  });
}

// ─── useJobSearch ─────────────────────────────────────────────────────────────

export function useJobSearch(term: string) {
  const [debouncedTerm, setDebouncedTerm] = useState(term);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(term), 300);
    return () => clearTimeout(timer);
  }, [term]);

  return useQuery<Job[]>({
    queryKey: ["jobs", debouncedTerm],
    queryFn: () => api.get<Job[]>("/api/jobs", { search: debouncedTerm || undefined, limit: 100 }),
    staleTime: 60_000,
  });
}

// ─── useJobByNumber ─────────────────────────────────────────────────────────

export function useJobByNumber(jobNumber?: string | null) {
  return useQuery<Job | null>({
    queryKey: ["jobByNumber", jobNumber],
    queryFn: async () => {
      const jobs = await api.get<Job[]>("/api/jobs", { search: jobNumber ?? undefined, limit: 20 });
      return jobs.find((job: Job) => job.number === jobNumber) ?? null;
    },
    enabled: !!jobNumber,
    staleTime: 5 * 60_000,
  });
}

// ─── useInvoiceEmail ──────────────────────────────────────────────────────────

export function useInvoiceEmail(id: string) {
  return useQuery<{ body: string }>({ 
    queryKey: ["invoiceEmail", id],
    queryFn: () => api.get<{ body: string }>(`/api/invoices/${id}/email`),
    enabled: !!id,
    retry: false,
  });
}

// ─── useSubcontracts ──────────────────────────────────────────────────────────

export function useSubcontracts(vendorCode?: string, jobNumber?: string) {
  return useQuery<Subcontract[]>({
    queryKey: ["subcontracts", vendorCode, jobNumber],
    queryFn: () =>
      api.get<Subcontract[]>("/api/subcontracts", { vendorCode, jobNumber }),
    enabled: !!(vendorCode || jobNumber),
  });
}

// ─── useJobFolders ────────────────────────────────────────────────────────────

export interface JobFolderNode {
  id: string;
  name: string;
  children: JobFolderNode[];
}

export interface JobFoldersResponse {
  jobNumber: string;
  jobFolder: string;
  folders: JobFolderNode[];
}

/** GET /api/jobs/:jobNumber/folders — live SharePoint folder tree for a job.
 * Powers the DestinationPicker (replaces the hardcoded destination tree). */
export function useJobFolders(jobNumber?: string | null) {
  return useQuery<JobFoldersResponse>({
    queryKey: ["jobFolders", jobNumber],
    queryFn: () => api.get<JobFoldersResponse>(`/api/jobs/${jobNumber}/folders`),
    enabled: !!jobNumber,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// ─── useSharePointFolders ─────────────────────────────────────────────────────

export interface SharePointFolderEntry {
  id: string;
  name: string;
  hasChildren: null;
}

export interface SharePointFileEntry {
  id: string;
  name: string;
  webUrl?: string | null;
}

export interface SharePointFoldersResponse {
  path: string;
  folders: SharePointFolderEntry[];
  files?: SharePointFileEntry[];
}

/** GET /api/jobs/sharepoint/folders?path=... — lazy-browse one level of the
 *  Projects drive. Used by the DestinationPicker's live browse mode; folders
 *  are selectable/navigable, files are display-only/openable context.
 *  `path` is drive-relative; empty string = drive root (year buckets). */
export function useSharePointFolders(path?: string) {
  return useQuery<SharePointFoldersResponse>({
    queryKey: ["sharePointFolders", path],
    queryFn: () =>
      api.get<SharePointFoldersResponse>("/api/jobs/sharepoint/folders", {
        path: path ?? "",
      }),
    enabled: path !== undefined,
    staleTime: 15 * 60_000,
    retry: false,
  });
}

// ─── useRoutingCodes ─────────────────────────────────────────────────────────

export function useRoutingCodes() {
  return useQuery<RoutingCodesResponse>({
    queryKey: ["routingCodes"],
    queryFn: () => api.get<RoutingCodesResponse>("/api/routing-codes"),
    staleTime: 5 * 60_000,
  });
}

// ─── usePhaseCodes ──────────────────────────────────────────────────────────

export function usePhaseCodes() {
  return useQuery<PhaseCodesResponse>({
    queryKey: ["phaseCodes"],
    // limit=200 (the endpoint max) fetches the full phase sidecar (~110) in one
    // page — the default page size (50) truncated every phase dropdown. If the
    // catalog ever exceeds 200, walk offset pages here.
    queryFn: () => api.get<PhaseCodesResponse>("/api/phase-codes", { limit: 200 }),
    staleTime: 5 * 60_000,
  });
}

// ─── useGlAccounts ─────────────────────────────────────────────────────────

function filterGlAccounts(data: GlAccountsResponse | GlAccountOption[]): GlAccountOption[] {
  const list = Array.isArray(data) ? data : (data?.gl_accounts ?? []);
  return list.filter((account: GlAccountOption) =>
    typeof account.code === "string" && account.code.trim().length > 0
  );
}

// Server-side GL search typeahead. The GL catalog is 2000+ live-Spectrum rows,
// so it cannot be loaded whole — the debounced `search` term (matches account
// number OR description) fetches a bounded page from the server, mirroring the
// Job/Vendor search dropdowns. `search=""` returns the first page (the default
// list); typing narrows it server-side.
export function useGlAccounts(search = "") {
  const [debouncedTerm, setDebouncedTerm] = useState(search);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  return useQuery<GlAccountOption[]>({
    queryKey: ["glAccounts", debouncedTerm],
    queryFn: async () =>
      filterGlAccounts(
        await api.get<GlAccountsResponse | GlAccountOption[]>("/api/gl-accounts", {
          search: debouncedTerm || undefined,
          limit: 200,
        }),
      ),
    staleTime: 5 * 60_000,
  });
}

// Resolve a single GL account by its exact code so a pre-filled / persisted
// selection keeps its full "code - description" label even when that account is
// NOT on the active search page (mirrors useJobByNumber). The backend search
// matches account number OR description, so `search=<code>` returns the row.
export function useGlAccountByCode(code?: string | null) {
  return useQuery<GlAccountOption | null>({
    queryKey: ["glAccountByCode", code],
    queryFn: async () => {
      const accounts = filterGlAccounts(
        await api.get<GlAccountsResponse | GlAccountOption[]>("/api/gl-accounts", {
          search: code ?? undefined,
          limit: 200,
        }),
      );
      return accounts.find((account: GlAccountOption) => account.code.trim() === code) ?? null;
    },
    enabled: !!code,
    staleTime: 5 * 60_000,
  });
}

// ─── useIgnoreRules ───────────────────────────────────────────────────────────

export function useIgnoreRules() {
  return useQuery<IgnoreRule[]>({
    queryKey: ["ignoreRules"],
    queryFn: () => api.get<IgnoreRule[]>("/api/ignore-rules"),
  });
}

// ─── useRetentionRules ───────────────────────────────────────────────────────

export function useRetentionRules() {
  return useQuery<RetentionRule[]>({
    queryKey: ["retentionRules"],
    queryFn: () => api.get<RetentionRule[]>("/api/retention"),
    staleTime: 60_000,
  });
}

// ─── usePipelineStatus ────────────────────────────────────────────────────────

export function usePipelineStatus(pollingInterval?: number, keepPolling = false) {
  return useQuery<PipelineStatus>({
    queryKey: ["pipelineStatus"],
    queryFn: () => api.get<PipelineStatus>("/api/pipeline/status"),
    refetchInterval: (query) => (
      query.state.data?.running || keepPolling ? pollingInterval ?? 5_000 : false
    ),
  });
}
// ─── useClassifications ────────────────────────────────────────────────

export function useClassifications(): UseClassificationsResult {
  const query = useQuery<ClassificationsResponse, Error | ApiError>({
    queryKey: ["classifications"],
    queryFn: async () => normalizeClassificationsResponse(await api.get<unknown>(CLASSIFICATION_ENDPOINT)),
    staleTime: 5 * 60_000,
  });

  const classifications = query.data?.classifications ?? DEFAULT_MAPPINGS;
  const availableAssociations = query.data?.availableAssociations ?? DEFAULT_CLASSIFICATION_ASSOCIATIONS;

  return {
    ...query,
    data: classifications,
    classifications,
    availableAssociations,
  };
}

// ─── useDocumentDestinations ──────────────────────────────────────────
//
// Shared fetch for the served SharePoint destination catalog (folder tree +
// per-type default paths). There is NO client-side fallback: on failure or an
// unconfigured backend the query surfaces `isError`, and consumers render an
// explicit "destinations unavailable" state — the hardcoded catalog is gone.
export function useDocumentDestinations(): UseQueryResult<DocumentDestinationsConfig, Error | ApiError> {
  return useQuery<DocumentDestinationsConfig, Error | ApiError>({
    queryKey: ["document-destinations"],
    queryFn: () => api.get<DocumentDestinationsConfig>("/api/document-destinations"),
    staleTime: 5 * 60_000,
  });
}

// ─── useRuleOptions ───────────────────────────────────────────────────────────
//
// Shared fetch for the rule-builder catalogs (actions/fields/operators/statuses),
// served from the same backend definitions rule validation uses. No client
// fallback: on failure the query surfaces `isError` and the rule builder renders
// an explicit unusable state — the hardcoded catalogs are gone.
export function useRuleOptions(): UseQueryResult<RuleOptionsResponse, Error | ApiError> {
  return useQuery<RuleOptionsResponse, Error | ApiError>({
    queryKey: ["rule-options"],
    queryFn: () => api.get<RuleOptionsResponse>("/api/rule-options"),
    staleTime: 5 * 60_000,
  });
}

// ─── useCostTypes ─────────────────────────────────────────────────────────────
//
// Shared fetch for the Spectrum cost-type catalog. No client fallback.
export function useCostTypes(): UseQueryResult<CostTypesResponse, Error | ApiError> {
  return useQuery<CostTypesResponse, Error | ApiError>({
    queryKey: ["cost-types"],
    queryFn: () => api.get<CostTypesResponse>("/api/cost-types"),
    staleTime: 5 * 60_000,
  });
}

// ─── useApprovalSchema ────────────────────────────────────────────────────────
//
// The shared approval rules, including the Spectrum cost-type→GL master used to
// pre-fill the GL when a cost type changes. Served from approvalRules.json so
// the pairing table is never duplicated client-side. No client fallback: with
// the schema unavailable the GL simply is not re-derived.
export function useApprovalSchema(): UseQueryResult<ApprovalSchemaResponse, Error | ApiError> {
  return useQuery<ApprovalSchemaResponse, Error | ApiError>({
    queryKey: ["approval-schema"],
    queryFn: () => api.get<ApprovalSchemaResponse>("/api/approval-schema"),
    staleTime: 5 * 60_000,
  });
}

// ─── useSpectrumRefreshStatus ────────────────────────────────────────

export function useSpectrumRefreshStatus(
  pollingInterval?: number,
  options?: { enabled?: boolean },
) {
  return useQuery<SpectrumRefreshStatus>({
    queryKey: ["spectrumRefresh"],
    queryFn: () => api.get<SpectrumRefreshStatus>("/api/vendors/refresh/status"),
    enabled: options?.enabled ?? true,
    refetchInterval: pollingInterval ?? false,
  });
}

// ─── useAuditTrail ─────────────────────────────────────────────────────────

export function useAuditTrail(id: string) {
  return useQuery<AuditEntry[]>({
    queryKey: ["audit", id],
    queryFn: () => api.get<AuditEntry[]>(`/api/invoices/${id}/audit`),
    enabled: !!id,
    retry: false,
  });
}

export function useActivity(id: string, options?: { enabled?: boolean; offset?: number; routeFamily?: CollaborationRouteFamily }) {
  const offset = options?.offset ?? 0;
  const routeFamily = options?.routeFamily ?? "invoice";
  return useQuery<ActivityResponse>({
    queryKey: collaborationQueryKey(routeFamily, id, offset),
    queryFn: () => api.get<ActivityResponse>(`${collaborationApiBase(routeFamily)}/${id}/activity`, { limit: 50, offset }),
    enabled: Boolean(id) && (options?.enabled ?? true),
    retry: false,
  });
}

export function useForwardDefaults(id: string, options?: { enabled?: boolean; routeFamily?: CollaborationRouteFamily }) {
  const routeFamily = options?.routeFamily ?? "invoice";
  return useQuery<ForwardDefaultsResponse>({
    queryKey: ["forward-defaults", routeFamily, id],
    queryFn: () => api.get<ForwardDefaultsResponse>(`${collaborationApiBase(routeFamily)}/${id}/forward-defaults`),
    enabled: Boolean(id) && (options?.enabled ?? true),
    retry: false,
    staleTime: 60_000,
  });
}

export function useReplyRecipient(id: string, options?: { enabled?: boolean; routeFamily?: CollaborationRouteFamily }) {
  const routeFamily = options?.routeFamily ?? "invoice";
  return useQuery<ReplyRecipientResponse>({
    queryKey: ["reply-recipient", routeFamily, id],
    queryFn: () => api.get<ReplyRecipientResponse>(`${collaborationApiBase(routeFamily)}/${id}/reply-recipient`),
    enabled: Boolean(id) && (options?.enabled ?? true), retry: false, staleTime: 60_000,
  });
}

export function useCollaborationDirectory(options?: { enabled?: boolean }) {
  return useQuery<User[]>({
    queryKey: ["collaboration-directory"],
    queryFn: () => api.get<User[]>("/api/users"),
    enabled: options?.enabled ?? true,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** Inbound attachment metadata is served from the shared document route family. */
export function useInboundAttachments(id: string, options?: { enabled?: boolean }) {
  return useQuery<InboundAttachmentsResponse>({
    queryKey: ["inbound-attachments", id],
    queryFn: () => api.get<InboundAttachmentsResponse>(`/api/documents/${id}/inbound-attachments`),
    enabled: Boolean(id) && (options?.enabled ?? true),
    retry: false,
  });
}

// ─── useInvoiceActions ─────────────────────────────────────────────────────

export function useInvoiceActions(
  id: string,
  options?: { enabled?: boolean },
) {
  return useQuery<InvoiceActionsResponse>({
    queryKey: ["invoiceActions", id],
    queryFn: () => api.get<InvoiceActionsResponse>(`/api/invoices/${id}/actions`),
    enabled: Boolean(id) && (options?.enabled ?? true),
    retry: (failureCount, error) => {
      if (isApiError(error) && error.status === 404) return false;
      return failureCount < 2;
    },
  });
}

export const waiverRecipientQueryKey = (invoiceId: string) => ["waiverRecipient", invoiceId] as const;

export function useWaiverRecipient(invoiceId: string) {
  return useQuery<WaiverRecipientResponse>({
    queryKey: waiverRecipientQueryKey(invoiceId),
    queryFn: () => api.get<WaiverRecipientResponse>(`/api/invoices/${invoiceId}/waiver-recipient`),
    enabled: false,
    retry: false,
  });
}

// ─── Scoped manual waiver pairing ──────────────────────────────────────────

export interface OrphanCandidateParams {
  page?: number;
  q?: string;
}

export function useInvoiceOrphanWaivers(
  invoiceId: string,
  params: OrphanCandidateParams = {},
  enabled = true,
) {
  return useQuery<InvoiceOrphanWaiversResponse>({
    queryKey: ["invoice-orphan-waivers", invoiceId, params],
    queryFn: () => api.get<InvoiceOrphanWaiversResponse>(
      `/api/invoices/${invoiceId}/orphan-waivers`,
      params as Record<string, string | number | boolean | undefined>,
    ),
    enabled: Boolean(invoiceId) && enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useLienWaiverOrphanInvoices(
  waiverId: string,
  params: OrphanCandidateParams = {},
  enabled = true,
) {
  return useQuery<LienWaiverOrphanInvoicesResponse>({
    queryKey: ["lien-waiver-orphan-invoices", waiverId, params],
    queryFn: () => api.get<LienWaiverOrphanInvoicesResponse>(
      `/api/lien-waivers/${waiverId}/orphan-invoices`,
      params as Record<string, string | number | boolean | undefined>,
    ),
    enabled: Boolean(waiverId) && enabled,
    staleTime: 30_000,
    retry: false,
  });
}

// ─── useSplitQueue ────────────────────────────────────────────────────────────

export function useSplitQueue(params?: {
  limit?: number;
  offset?: number;
  sort?: string;
  sortDir?: string;
}) {
  return useQuery<SplitQueueResponse>({
    queryKey: ["splits", "queue", params],
    queryFn: () =>
      api.get<SplitQueueResponse>("/api/splits/queue", params as Record<string, string | number | boolean | undefined>),
    staleTime: 30_000,
  });
}

// ─── useSplitDoc ──────────────────────────────────────────────────────────────

export function useSplitDoc(id: string) {
  return useQuery<SplitDoc>({
    queryKey: ["splits", "doc", id],
    queryFn: () => api.get<SplitDoc>(`/api/splits/${id}`),
    enabled: !!id,
  });
}

// ─── useSplitChildStatus ──────────────────────────────────────────────────────

export function useSplitChildStatus(childId: string, enabled = true) {
  return useQuery<ChildStatusResponse>({
    queryKey: ["splits", "child", childId],
    queryFn: () => api.get<ChildStatusResponse>(`/api/splits/child/${childId}/status`),
    enabled: !!childId && enabled,
    refetchInterval: 3_000,
  });
}

// ─── usePhaseOptions ─────────────────────────────────────────────────────────────

/** GET /api/invoices/:id/phase-options — phases on matched subcontract */
export function usePhaseOptions(
  invoiceId: string,
  enabled = true,
  subcontractNumber?: string | null,
  jobMatchNumber?: string | null,
) {
  return useQuery<PhaseOptionsResponse>({
    // Key on the invoice ROW's current subcontract + job (the source of truth
    // that changes when the invoice is corrected) so a subcontract/job change on
    // the SAME invoice id changes the key and TanStack refetches automatically —
    // otherwise the 5-minute staleTime serves the previous subcontract's cached
    // phases. NOT keyed on the served `phaseOpts.subcontractNumber` (circular).
    queryKey: ["phase-options", invoiceId, subcontractNumber ?? null, jobMatchNumber ?? null],
    queryFn: () => api.get<PhaseOptionsResponse>(`/api/invoices/${invoiceId}/phase-options`),
    enabled: !!invoiceId && enabled,
    staleTime: 5 * 60_000,
    // Hold the last-known phases while a key change (subcontract/job correction)
    // refetches, so the page-level Allocation-tab visibility flips only once the
    // new phase-options confirm — no flicker mid-refetch.
    placeholderData: (previous) => previous,
  });
}

// ─── useValidateApproval ─────────────────────────────────────────────────────
//
// GET /api/validate-approval/:id — the server-authoritative approval/coding
// verdict. This is the single source that retires the client-side
// approvalValidation.ts derivation and the derivedGlAccount/derivedCostType
// coding literals. There is NO client fallback: on failure the query surfaces
// isError and consumers disable approve + render an explicit unavailable state.
//
// The query key includes a fingerprint of the saved verdict-relevant fields so
// that persisting an edit (which changes those fields on the invoice prop)
// triggers a refetch. `placeholderData` keeps the prior verdict visible during
// that refetch instead of momentarily reading as unavailable.

/** Fingerprint of the saved fields the backend verdict depends on. */
export function approvalVerdictFingerprint(invoice: Invoice): string {
  const raw = invoice as unknown as Record<string, unknown>;
  const read = (snake: string, camel: string): unknown => raw[snake] ?? raw[camel];
  const parts: unknown[] = [
    invoice.matching?.vendor?.vendorCode ?? read("vendor_code", "vendorCode"),
    invoice.matching?.job?.jobNumber ?? read("job_match_number", "jobMatchNumber"),
    invoice.matching?.subcontract?.subcontractNumber ?? read("subcontract_number", "subcontractNumber"),
    invoice.extracted?.amount ?? read("amount", "amount"),
    read("gl_account", "glAccount"),
    read("cost_type", "costType"),
    read("phase_code", "phaseCode"),
    read("routing_code", "routingCode"),
    read("gl_date", "glDate"),
    read("invoice_date", "invoiceDate"),
    read("multi_phase_candidate", "multiPhaseCandidate"),
    read("phase_allocations", "phaseAllocations"),
  ];
  return parts
    .map((v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)))
    .join("|");
}

/** Exact cache key for a server-computed verdict on a saved invoice row. */
export function approvalVerdictQueryKey(invoice: Invoice) {
  return ["validate-approval", invoice.id, approvalVerdictFingerprint(invoice)] as const;
}

export function useValidateApproval(
  invoice: Invoice | undefined,
  options?: { enabled?: boolean },
): UseQueryResult<ApprovalState, Error | ApiError> {
  const invoiceId = invoice?.id ?? "";
  return useQuery<ApprovalState, Error | ApiError>({
    queryKey: invoice ? approvalVerdictQueryKey(invoice) : ["validate-approval", "", ""],
    queryFn: () => api.get<ApprovalState>(`/api/validate-approval/${invoiceId}`),
    enabled: !!invoiceId && (options?.enabled ?? true),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    retry: (failureCount, error) => {
      if (isApiError(error) && error.status === 404) return false;
      return failureCount < 2;
    },
  });
}
