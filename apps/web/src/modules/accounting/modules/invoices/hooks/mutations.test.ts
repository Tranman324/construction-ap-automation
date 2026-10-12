import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import React from "react";

import { makeInvoice, makeMutationWrapper } from "@/modules/accounting/modules/invoices/hooks/mutations.testUtils";

const TM = vi.hoisted(() => ({
  api: {
    del: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    postForm: vi.fn(),
    put: vi.fn(),
  },
  toast: { error: vi.fn(), success: vi.fn() },
  emitAuditEvent: vi.fn(),
  authUser: {
    userId: "admin-1",
    name: "Alex Admin",
    email: "admin@example.com",
    role: "admin",
  },
}));

vi.mock("@/modules/shared/lib/api", () => ({
  api: TM.api,
  isApiError: (e: unknown): boolean =>
    typeof e === "object" && e !== null && "status" in e && "message" in e,
}));

vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: TM.toast,
}));

vi.mock("@/modules/shared/lib/auditEmitter", () => ({
  emitAuditEvent: TM.emitAuditEvent,
}));

vi.mock("@/modules/shared/lib/auth", () => ({
  useAuth: () => ({ user: TM.authUser }),
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasAnyPermission: () => true, hasAllPermissions: () => true }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import {
  useApproveInvoice,
  useUnapproveInvoice,
  useAttachFile,
  useAddStatementLine,
  useBulkAction,
  useConfirmSplit,
  useCreateClassification,
  useDeleteClassification,
  useDeleteInvoice,
  useDeleteStatementLine,
  useDiscardInvoice,
  useFlagDocument,
  useLinkWaiver,
  useUnlinkWaiver,
  usePermanentDelete,
  useRejectInvoice,
  useUnflagDocument,
  useRequestWaiver,
  useAddWaiverContact,
  useRevertWaiverBypass,
  useRematchStatementLines,
  useResolveStatementLine,
  useRestoreInvoice,
  useRevertWaiverOverride,
  useReconcileStatement,
  useSetWaiverOverride,
  useSetWaiverBypass,
  useSubmitToSpectrum,
  useUndoInvoiceAction,
  useUpdateInvoice,
  useUpdateClassifications,
  useUpdateStatementLine,
  useUnresolveStatementLine,
  useUnreconcileStatement,
  useUploadCoiToSpectrum,
  useFileDocument,
  useApplyCoiOverride,
  useRevokeCoiOverride,
  useUpdateCoiManualValues,
  useUpdateStatementAttributes,
  useUpdateWarrantyClassification,
  useCreateComment,
  useMarkActivityViewed,
  useReplyToDocument,
  useForwardDocument,
} from "@/modules/accounting/modules/invoices/hooks/mutations";
import { collaborationQueryKey } from "@/modules/accounting/modules/invoices/hooks/collaborationRoutes";
import {
  approvalVerdictQueryKey,
  waiverRecipientQueryKey,
  useValidateApproval,
} from "@/modules/accounting/modules/invoices/hooks/queries";
import { InvoiceActionBar } from "@/modules/accounting/modules/invoices/components/invoices/InvoiceActionBar";
import { WaiverChip } from "@/modules/accounting/modules/invoices/components/invoices/renderers/WaiverChip";
import type { InvoiceDetailFormHandle } from "@/modules/accounting/modules/invoices/components/invoices/InvoiceDetailForm";
import type { Invoice, WaiverActionState } from "@/modules/accounting/modules/invoices/types/invoice";
import type { WaiverRecipientResponse } from "@/modules/accounting/modules/invoices/types/api";

beforeEach(() => {
  TM.api.del.mockReset();
  TM.api.get.mockReset();
  TM.api.patch.mockReset();
  TM.api.post.mockReset();
  TM.api.postForm.mockReset();
  TM.api.put.mockReset();
  TM.toast.error.mockReset();
  TM.emitAuditEvent.mockReset();
});

function waiverActions(overrides: Partial<WaiverActionState> = {}): WaiverActionState {
  return {
    request: { permitted: true, blockers: [] },
    resend: { permitted: false, blockers: [{ code: "WAIVER_REQUEST_NOT_SENT", message: "No request to resend." }] },
    markOnDocument: { permitted: true, blockers: [] },
    clearOnDocument: { permitted: false, blockers: [{ code: "WAIVER_NOT_ON_DOCUMENT", message: "No waiver is marked." }] },
    bypass: { permitted: true, blockers: [] },
    revertBypass: { permitted: false, blockers: [{ code: "WAIVER_ALREADY_REQUIRED", message: "A waiver is required." }] },
    bypassHint: { count: 0, show: false },
    ...overrides,
  };
}

function CachedWaiverChip({ invoiceId }: { invoiceId: string }) {
  const { data: invoice } = useQuery<Invoice>({
    queryKey: ["invoice", invoiceId],
    queryFn: async () => {
      throw new Error("Cached invoice harness must not fetch.");
    },
    enabled: false,
  });

  return invoice
    ? React.createElement(WaiverChip, {
      status: invoice.waiverStatus,
      waiverBypassed: invoice.waiverBypassed,
      waiverBypassedAt: invoice.waiverBypassedAt,
      waiverBypassedBy: invoice.waiverBypassedBy,
    })
    : null;
}

describe("collaboration route-family mutations", () => {
  it.each([
    ["invoice", "/api/invoices"],
    ["document", "/api/documents"],
  ] as const)("posts comments to the %s endpoint and updates only its activity key", async (routeFamily, apiBase) => {
    const comment = { kind: "comment", id: `${routeFamily}-comment`, documentId: "doc-1", body: "Synthetic comment", timestamp: "2026-09-16T12:00:00.000Z", actor: { name: "Synthetic User" } };
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(collaborationQueryKey(routeFamily, "doc-1", 0), { entries: [], pagination: { limit: 50, offset: 0, hasMore: false } });
    TM.api.post.mockResolvedValueOnce({ comment });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateComment(), { wrapper: Wrapper });

    await act(async () => { await result.current.mutateAsync({ id: "doc-1", routeFamily, payload: { body: "Synthetic comment" } }); });

    expect(TM.api.post).toHaveBeenCalledWith(`${apiBase}/doc-1/comments`, { body: "Synthetic comment" });
    expect(queryClient.getQueryData<{ entries: typeof comment[] }>(collaborationQueryKey(routeFamily, "doc-1", 0))?.entries).toEqual([comment]);
    expect(queryClient.getQueryData(collaborationQueryKey(routeFamily === "invoice" ? "document" : "invoice", "doc-1", 0))).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["activity", routeFamily, "doc-1"] });
  });

  it("marks the cached canonical comment with its client reconciliation identity", async () => {
    const comment = { kind: "comment" as const, id: "canonical-comment", documentId: "doc-1", body: "Comment", timestamp: "2026-09-16T12:00:01.000Z", actor: { userId: "canonical-user", name: "Dana Canonical", avatarUrl: "/avatar" } };
    const { queryClient, Wrapper } = makeMutationWrapper();
    const key = collaborationQueryKey("document", "doc-1", 0);
    queryClient.setQueryData(key, { entries: [], pagination: { limit: 50, offset: 0, hasMore: false } });
    TM.api.post.mockResolvedValueOnce({ comment });
    const { result } = renderHook(() => useCreateComment(), { wrapper: Wrapper });

    await act(async () => { await result.current.mutateAsync({ id: "doc-1", routeFamily: "document", payload: { body: "Comment" }, optimisticEntryId: "optimistic-doc-1" }); });

    expect(queryClient.getQueryData<{ entries: Array<typeof comment & { clientReconciliationId?: string }> }>(key)?.entries).toEqual([
      { ...comment, clientReconciliationId: "optimistic-doc-1" },
    ]);
  });

  it("seeds a missing page-zero cache with the canonical comment response", async () => {
    const comment = { kind: "comment" as const, id: "canonical-comment", documentId: "doc-1", body: "Comment", timestamp: "2026-09-16T12:00:01.000Z", actor: { userId: "canonical-user", name: "Dana Canonical", avatarUrl: "/avatar" } };
    const { queryClient, Wrapper } = makeMutationWrapper();
    const key = collaborationQueryKey("document", "doc-1", 0);
    TM.api.post.mockResolvedValueOnce({ comment });
    const { result } = renderHook(() => useCreateComment(), { wrapper: Wrapper });

    await act(async () => { await result.current.mutateAsync({ id: "doc-1", routeFamily: "document", payload: { body: "Comment" }, optimisticEntryId: "optimistic-doc-1" }); });

    expect(queryClient.getQueryData<{ entries: Array<typeof comment & { clientReconciliationId?: string }>; pagination: { limit: number; offset: number; total: number; hasMore: boolean } }>(key)).toEqual({
      entries: [{ ...comment, clientReconciliationId: "optimistic-doc-1" }],
      pagination: { limit: 50, offset: 0, total: 1, hasMore: false },
    });
  });

  it.each([
    ["invoice", "/api/invoices"],
    ["document", "/api/documents"],
  ] as const)("does not update activity state or invalidate caches after an unauthorized %s comment", async (routeFamily, apiBase) => {
    const { queryClient, Wrapper } = makeMutationWrapper();
    const key = collaborationQueryKey(routeFamily, "doc-1", 0);
    const cached = { entries: [], pagination: { limit: 50, offset: 0, hasMore: false } };
    queryClient.setQueryData(key, cached);
    TM.api.post.mockRejectedValueOnce({ status: 403, message: "Forbidden" });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateComment(), { wrapper: Wrapper });

    await act(async () => { await expect(result.current.mutateAsync({ id: "doc-1", routeFamily, payload: { body: "Should not persist" } })).rejects.toMatchObject({ status: 403 }); });

    expect(TM.api.post).toHaveBeenCalledWith(`${apiBase}/doc-1/comments`, { body: "Should not persist" });
    expect(queryClient.getQueryData(key)).toEqual(cached);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each([
    ["invoice", "/api/invoices"],
    ["document", "/api/documents"],
  ] as const)("posts viewed state to the %s endpoint and records its family key", async (routeFamily, apiBase) => {
    const response = { priorActivityViewedAt: "2026-09-16T11:00:00.000Z", unreadReplies: 0, unreadComments: 0 };
    const { queryClient, Wrapper } = makeMutationWrapper();
    TM.api.post.mockResolvedValueOnce(response);
    const { result } = renderHook(() => useMarkActivityViewed(), { wrapper: Wrapper });

    await act(async () => { await result.current.mutateAsync({ id: "doc-1", routeFamily }); });

    expect(TM.api.post).toHaveBeenCalledWith(`${apiBase}/doc-1/activity/view`, {});
    expect(queryClient.getQueryData(["activity-view", routeFamily, "doc-1"])).toEqual(response);
    expect(queryClient.getQueryData(["activity-view", routeFamily === "invoice" ? "document" : "invoice", "doc-1"])).toBeUndefined();
  });

  it.each([
    ["invoice", "/api/invoices"],
    ["document", "/api/documents"],
  ] as const)("does not update counts or activity-view state after an unauthorized %s viewed mutation", async (routeFamily, apiBase) => {
    const { queryClient, Wrapper } = makeMutationWrapper();
    const invoice = { ...makeInvoice("doc-1", "Synthetic Vendor"), unreadReplies: 4, unreadComments: 3 };
    queryClient.setQueryData(["invoice", "doc-1"], invoice);
    TM.api.post.mockRejectedValueOnce({ status: 403, message: "Forbidden" });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useMarkActivityViewed(), { wrapper: Wrapper });

    await act(async () => { await expect(result.current.mutateAsync({ id: "doc-1", routeFamily })).rejects.toMatchObject({ status: 403 }); });

    expect(TM.api.post).toHaveBeenCalledWith(`${apiBase}/doc-1/activity/view`, {});
    expect(queryClient.getQueryData(["invoice", "doc-1"])).toEqual(invoice);
    expect(queryClient.getQueryData(["activity-view", routeFamily, "doc-1"])).toBeUndefined();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each([
    ["invoice", "/api/invoices", "/api/documents"],
    ["document", "/api/documents", "/api/invoices"],
  ] as const)("posts email reply and forward mutations to the %s family", async (routeFamily, apiBase, oppositeApiBase) => {
    const { Wrapper } = makeMutationWrapper();
    TM.api.post.mockResolvedValue({ sent: true });
    const reply = renderHook(() => useReplyToDocument(), { wrapper: Wrapper });
    const forward = renderHook(() => useForwardDocument(), { wrapper: Wrapper });

    await act(async () => {
      await reply.result.current.mutateAsync({ id: "doc-1", routeFamily, payload: { body: "Reply" } });
      await forward.result.current.mutateAsync({ id: "doc-1", routeFamily, payload: { recipients: ["user-1"], body: "Forward" } });
    });

    expect(TM.api.post).toHaveBeenNthCalledWith(1, `${apiBase}/doc-1/reply`, { body: "Reply" }, expect.objectContaining({ headers: expect.objectContaining({ "X-Send-Token": expect.any(String) }) }));
    expect(TM.api.post).toHaveBeenNthCalledWith(2, `${apiBase}/doc-1/forward`, { recipients: ["user-1"], body: "Forward" }, expect.objectContaining({ headers: expect.objectContaining({ "X-Send-Token": expect.any(String) }) }));
    expect(TM.api.post.mock.calls.map(([path]) => path)).not.toContain(`${oppositeApiBase}/doc-1/reply`);
    expect(TM.api.post.mock.calls.map(([path]) => path)).not.toContain(`${oppositeApiBase}/doc-1/forward`);
  });

  it("reuses a generated send token after an ambiguous reply outcome", async () => {
    const { Wrapper } = makeMutationWrapper();
    TM.api.post.mockRejectedValueOnce({ status: 504, message: "Gateway timeout" }).mockResolvedValueOnce({ ok: true, sentTo: "user-1" });
    const { result } = renderHook(() => useReplyToDocument(), { wrapper: Wrapper });

    await act(async () => { await expect(result.current.mutateAsync({ id: "doc-1", payload: { body: "Reply" } })).rejects.toMatchObject({ status: 504 }); });
    await act(async () => { await result.current.mutateAsync({ id: "doc-1", payload: { body: "Edited reply" } }); });

    const firstToken = TM.api.post.mock.calls[0]?.[2]?.headers?.["X-Send-Token"];
    const secondToken = TM.api.post.mock.calls[1]?.[2]?.headers?.["X-Send-Token"];
    expect(firstToken).toBeTypeOf("string");
    expect(secondToken).toBe(firstToken);
  });

  it("rotates the send token after a terminal reply failure", async () => {
    const { Wrapper } = makeMutationWrapper();
    TM.api.post.mockRejectedValueOnce({ status: 422, message: "Invalid recipient" }).mockResolvedValueOnce({ ok: true, sentTo: "user-1" });
    const { result } = renderHook(() => useReplyToDocument(), { wrapper: Wrapper });

    await act(async () => { await expect(result.current.mutateAsync({ id: "doc-1", payload: { body: "Reply" } })).rejects.toMatchObject({ status: 422 }); });
    await act(async () => { await result.current.mutateAsync({ id: "doc-1", payload: { body: "Retry reply" } }); });

    const firstToken = TM.api.post.mock.calls[0]?.[2]?.headers?.["X-Send-Token"];
    const secondToken = TM.api.post.mock.calls[1]?.[2]?.headers?.["X-Send-Token"];
    expect(firstToken).not.toBe(secondToken);
  });

  it("rotates the send token for a second logical reply after success", async () => {
    const { Wrapper } = makeMutationWrapper();
    TM.api.post.mockResolvedValue({ ok: true, sentTo: "user-1" });
    const { result } = renderHook(() => useReplyToDocument(), { wrapper: Wrapper });

    await act(async () => { await result.current.mutateAsync({ id: "doc-1", payload: { body: "First reply" } }); });
    await act(async () => { await result.current.mutateAsync({ id: "doc-1", payload: { body: "Second reply" } }); });

    const firstToken = TM.api.post.mock.calls[0]?.[2]?.headers?.["X-Send-Token"];
    const secondToken = TM.api.post.mock.calls[1]?.[2]?.headers?.["X-Send-Token"];
    expect(firstToken).not.toBe(secondToken);
  });
});

describe("invoice mutations", () => {
  it("invalidates only the new job's folders after an accepted job edit", async () => {
    const invoice = makeInvoice("job-edit", "Synthetic Vendor");
    const { queryClient, Wrapper } = makeMutationWrapper();
    for (const key of [["jobFolders", "31-112"], ["jobFolders", "26-SVC412"], ["document-destinations"]]) {
      queryClient.setQueryData(key, { folders: [] });
    }
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    TM.api.patch.mockResolvedValueOnce({ invoice, approvalVerdict: {} });
    const { result } = renderHook(() => useUpdateInvoice(), { wrapper: Wrapper });
    await act(async () => { await result.current.mutateAsync({ id: invoice.id, payload: { jobNumber: "26-SVC412" } }); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["jobFolders", "26-SVC412"], exact: true });
    expect(queryClient.getQueryState(["jobFolders", "26-SVC412"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["jobFolders", "31-112"])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(["document-destinations"])?.isInvalidated).toBe(false);
    // Preserve existing invoice-list bookkeeping; no new broad invalidations.
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("does not invalidate folders after a rejected job edit or an unrelated accepted edit", async () => {
    const invoice = makeInvoice("job-rejected", "Synthetic Vendor");
    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateInvoice(), { wrapper: Wrapper });
    TM.api.patch.mockRejectedValueOnce(new Error("Rejected"));
    await act(async () => {
      await expect(result.current.mutateAsync({ id: invoice.id, payload: { jobNumber: "26-SVC412" } })).rejects.toThrow("Rejected");
    });
    expect(invalidate).not.toHaveBeenCalled();
    TM.api.patch.mockResolvedValueOnce({ invoice, approvalVerdict: {} });
    await act(async () => { await result.current.mutateAsync({ id: invoice.id, payload: { invoiceNumber: "SYNTHETIC-1" } }); });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["invoices"], refetchType: "none" });
  });

  it("adopts canonical field origins on save and never retains cleared origin entries", async () => {
    const existing = makeInvoice("origin-cache", "Synthetic Vendor");
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoice", existing.id], existing);
    const { result } = renderHook(() => useUpdateInvoice(), { wrapper: Wrapper });
    const manual = { invoiceNumber: { origin: "manual" as const, at: "2026-09-07T12:00:00Z", by: "synthetic@example.test" } };
    for (const fieldOrigins of [manual, {}, undefined]) {
      TM.api.patch.mockResolvedValueOnce({ invoice: { ...existing, fieldOrigins }, approvalVerdict: {} });
      await act(async () => { await result.current.mutateAsync({ id: existing.id, payload: { invoiceNumber: "SYNTHETIC-1" } }); });
      expect(queryClient.getQueryData<Invoice>(["invoice", existing.id])?.fieldOrigins).toEqual(fieldOrigins);
    }
  });

  it("uses the inline waiver-action preservation updater at exactly the 11 wholesale invoice cache writers", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/accounting/modules/invoices/hooks/mutations.ts"), "utf8");

    expect(source.match(/waiverActions: invoice\.waiverActions \?\? prev\?\.waiverActions/g)).toHaveLength(11);
  });

  it("preserves cached waiver actions when a non-waiver mutation response omits them", async () => {
    const existing = { ...makeInvoice("cache-preserve", "Cached Vendor"), waiverActions: waiverActions() };
    const responseInvoice = { ...existing, extracted: { ...existing.extracted, vendorName: "Renamed Vendor" } };
    Reflect.deleteProperty(responseInvoice, "waiverActions");
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoice", existing.id], existing);
    TM.api.patch.mockResolvedValueOnce({ invoice: responseInvoice, approvalVerdict: {} });
    const { result } = renderHook(() => useUpdateInvoice(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: existing.id, payload: { vendorName: "Renamed Vendor" } });
    });

    expect(queryClient.getQueryData(["invoice", existing.id])).toEqual({
      ...responseInvoice,
      waiverActions: existing.waiverActions,
    });
  });

  it("retains persisted bypass attribution through an unrelated canonical invoice update", async () => {
    const initial = makeInvoice("cache-bypass-attribution", "Before update");
    initial.waiverStatus = "bypassed";
    initial.waiverBypassed = true;
    initial.waiverBypassedBy = "approver@example.com";
    initial.waiverBypassedAt = "2026-08-06T12:00:00.000Z";
    const canonical = makeInvoice(initial.id, "Renamed Vendor");
    canonical.waiverStatus = "bypassed";
    canonical.waiverBypassed = true;
    canonical.waiverBypassedBy = initial.waiverBypassedBy;
    canonical.waiverBypassedAt = initial.waiverBypassedAt;
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoice", initial.id], initial);
    TM.api.patch.mockResolvedValueOnce({ invoice: canonical, approvalVerdict: {} });
    const { result } = renderHook(() => useUpdateInvoice(), { wrapper: Wrapper });
    render(React.createElement(CachedWaiverChip, { invoiceId: initial.id }), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: initial.id, payload: { vendorName: "Renamed Vendor" } });
    });

    expect(queryClient.getQueryData(["invoice", initial.id])).toEqual(canonical);
    const expectedDate = new Date(canonical.waiverBypassedAt).toLocaleDateString();
    await waitFor(() => expect(screen.getByLabelText(`Bypassed by approver@example.com · ${expectedDate}`)).toBeInTheDocument());
  });

  it("uses waiver actions returned by a waiver mutation instead of the cached actions", async () => {
    const existing = { ...makeInvoice("cache-waiver", "Waiver Vendor"), waiverActions: waiverActions() };
    const returnedActions = waiverActions({ bypass: { permitted: false, blockers: [{ code: "WAIVER_BYPASSED", message: "Already bypassed." }] } });
    const invoice = { ...existing, lienWaiverRequired: false, waiverActions: returnedActions };
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoice", existing.id], existing);
    TM.api.post.mockResolvedValueOnce({ invoice });
    const { result } = renderHook(() => useSetWaiverBypass(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ invoiceId: existing.id });
    });

    expect(queryClient.getQueryData(["invoice", existing.id])).toEqual(invoice);
  });

  it("seeds the exact canonical filing invoice without a recovery GET", async () => {
    const original = makeInvoice("filing-cache", "Filing Vendor");
    const canonical = {
      ...original,
      filed: true,
      sharePointFilename: "DOC Filing Vendor (1).pdf",
      filing: {
        fileName: {
          value: "DOC Filing Vendor.pdf",
          provenance: "computed" as const,
          permittedActions: [],
          blockers: [],
        },
      },
    };
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoice", original.id], original);
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    TM.api.post.mockResolvedValueOnce({ invoice: canonical, action: { actionId: "file-1", type: "file", undoable: true } });
    const { result } = renderHook(() => useFileDocument(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: original.id, filename: "DOC Filing Vendor.pdf" });
    });

    expect(TM.api.post).toHaveBeenCalledWith(`/api/invoices/${original.id}/file`, { filename: "DOC Filing Vendor.pdf" });
    expect(queryClient.getQueryData(["invoice", original.id])).toEqual(canonical);
    expect(TM.api.get).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoice", original.id] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoices"], refetchType: "none" });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice-neighbors"], refetchType: "none" });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["stats"], refetchType: "none" });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["trash"], refetchType: "none" });
  });

  it.each([403, 409, 422])("preserves the cached invoice on literal filing refusal %i", async (status) => {
    const original = makeInvoice(`filing-refusal-${status}`, "Filing Vendor");
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoice", original.id], original);
    TM.api.post.mockRejectedValueOnce({ status, message: `Filing ${status} refusal` });
    const { result } = renderHook(() => useFileDocument(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync({ id: original.id, filename: "server-candidate.pdf" }))
      .rejects.toEqual({ status, message: `Filing ${status} refusal` });
    expect(queryClient.getQueryData(["invoice", original.id])).toEqual(original);
    expect(TM.api.get).not.toHaveBeenCalled();
  });

  it("preserves the cached invoice if an older server returns a stale-preview conflict", async () => {
    const original = {
      ...makeInvoice("filing-stale", "Filing Vendor"),
      filing: {
        fileName: {
          value: "DOC Filing Vendor.pdf",
          provenance: "computed" as const,
          permittedActions: [],
          blockers: [],
        },
      },
    };
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoice", original.id], original);
    TM.api.post.mockRejectedValueOnce({
      status: 409,
      code: "FILING_FILENAME_STALE",
      message: "Filing filename preview is stale.",
      details: {
        filing: {
          fileName: {
            value: "DOC Filing Vendor refreshed.pdf",
            provenance: "computed",
            permittedActions: [],
            blockers: [],
          },
        },
      },
    });
    const { result } = renderHook(() => useFileDocument(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync({ id: original.id, filename: "DOC Filing Vendor.pdf" }))
      .rejects.toMatchObject({ code: "FILING_FILENAME_STALE" });
    expect(queryClient.getQueryData<typeof original>(["invoice", original.id])).toEqual(original);
    expect(TM.api.get).not.toHaveBeenCalled();
  });

  it("patches statement attributes and replaces only the exact detail cache with the canonical invoice", async () => {
    const { queryClient, Wrapper } = makeMutationWrapper();
    const original = {
      ...makeInvoice("statement-attributes", "Statement Vendor"),
      classification: "statement" as const,
      statementAttributes: {
        statementPeriod: { value: "June 2026", source: "extracted" as const },
        balance: { value: 1000, source: "computed" as const },
      },
      reconcile: { blockers: [], counts: { total: 1, clear: 1, unresolved: 0 }, canReconcile: true, permittedActions: ['reconcile'] },
    };
    const canonical = {
      ...original,
      status: "reviewed",
      statementAttributes: {
        statementPeriod: { value: "July 2026", source: "manual" as const },
        balance: { value: 1200.5, source: "manual" as const },
      },
      reconcile: { blockers: [], counts: { total: 1, clear: 1, unresolved: 0 }, canReconcile: true, permittedActions: ['reconcile'] },
    };
    queryClient.setQueryData(["invoice", original.id], original);
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    TM.api.patch.mockResolvedValueOnce({ invoice: canonical });
    const { result } = renderHook(() => useUpdateStatementAttributes(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: original.id,
        payload: { statementPeriod: "July 2026", balance: 1200.5 },
      });
    });

    expect(TM.api.patch).toHaveBeenCalledWith(
      `/api/invoices/${original.id}/statement-attributes`,
      { statementPeriod: "July 2026", balance: 1200.5 },
    );
    expect(queryClient.getQueryData(["invoice", original.id])).toEqual(canonical);
    expect((queryClient.getQueryData<typeof canonical>(["invoice", original.id])?.reconcile)).toEqual(canonical.reconcile);
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(TM.api.get).not.toHaveBeenCalled();
  });

  it.each([403, 409, 422])("preserves the exact statement cache on a literal %s refusal", async (status) => {
    const { queryClient, Wrapper } = makeMutationWrapper();
    const invoice = { ...makeInvoice("statement-refusal", "Statement"), classification: "statement" as const };
    queryClient.setQueryData(["invoice", invoice.id], invoice);
    TM.api.patch.mockRejectedValueOnce({ status, message: `Statement ${status} refusal` });
    const { result } = renderHook(() => useUpdateStatementAttributes(), { wrapper: Wrapper });
    await expect(result.current.mutateAsync({ id: invoice.id, payload: { balance: 10 } })).rejects.toEqual({ status, message: `Statement ${status} refusal` });
    expect(queryClient.getQueryData(["invoice", invoice.id])).toEqual(invoice);
    expect(TM.api.get).not.toHaveBeenCalled();
  });

  it("replaces only the exact detail cache after warranty classification correction", async () => {
    const original = makeInvoice("warranty-correction", "Warranty Vendor");
    const canonical = {
      ...original,
      filing: {
        fileName: { value: "WTY canonical.pdf", provenance: "computed" as const, permittedActions: [], blockers: [] },
        providerKind: { value: "Subcontractor", provenance: "manual" as const, permittedActions: [], blockers: [] },
        warrantyType: { value: "Extended warranty", provenance: "manual" as const, permittedActions: [], blockers: [] },
      },
    };
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoice", original.id], original);
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    TM.api.patch.mockResolvedValueOnce({ invoice: canonical });
    const { result } = renderHook(() => useUpdateWarrantyClassification(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: original.id,
        payload: { providerKind: "Subcontractor", warrantyType: "Extended warranty" },
      });
    });

    expect(TM.api.patch).toHaveBeenCalledWith(
      `/api/invoices/${original.id}/warranty-classification`,
      { providerKind: "Subcontractor", warrantyType: "Extended warranty" },
    );
    expect(queryClient.getQueryData(["invoice", original.id])).toEqual(canonical);
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(TM.api.get).not.toHaveBeenCalled();
  });

  it.each([403, 409, 422])("preserves warranty cache and returns canonical error on %s refusal", async (status) => {
    const original = makeInvoice(`warranty-refusal-${status}`, "Warranty Vendor");
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoice", original.id], original);
    const error = { status, message: `Warranty ${status} refusal` };
    TM.api.patch.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useUpdateWarrantyClassification(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync({ id: original.id, payload: { providerKind: null } })).rejects.toEqual(error);
    expect(queryClient.getQueryData(["invoice", original.id])).toEqual(original);
    expect(TM.api.get).not.toHaveBeenCalled();
  });
  it("seeds the exact canonical invoice after reconcile and unreconcile without a recovery GET", async () => {
    const original = Object.assign(makeInvoice("statement-cache", "Statement Vendor"), { classification: "statement" as const, reconciled: false });
    const reconciled = { ...original, reconciled: true, reconciledAt: "2026-07-30T12:00:00.000Z" };
    const unreconciled = { ...reconciled, reconciled: false, reconciledAt: null };
    TM.api.post
      .mockResolvedValueOnce({ invoice: reconciled })
      .mockResolvedValueOnce({ invoice: unreconciled });

    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoice", original.id], original);
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => ({ reconcile: useReconcileStatement(), unreconcile: useUnreconcileStatement() }), { wrapper: Wrapper });

    await act(async () => {
      await result.current.reconcile.mutateAsync({ id: original.id });
    });
    expect(queryClient.getQueryData(["invoice", original.id])).toEqual(reconciled);
    expect(TM.api.post).toHaveBeenCalledWith(`/api/invoices/${original.id}/reconcile`);

    await act(async () => {
      await result.current.unreconcile.mutateAsync({ id: original.id });
    });
    expect(queryClient.getQueryData(["invoice", original.id])).toEqual(unreconciled);
    expect(TM.api.post).toHaveBeenLastCalledWith(`/api/invoices/${original.id}/unreconcile`);
    expect(TM.api.get).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoice", original.id] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoices"], refetchType: "none" });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["audit", original.id] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoiceActions", original.id] });
  });

  it.each([403, 409])("preserves the cached invoice when reconciliation is refused with %i", async (status) => {
    const original = Object.assign(makeInvoice(`statement-${status}`, "Statement Vendor"), { classification: "statement" as const, reconciled: false });
    TM.api.post.mockRejectedValueOnce({ status, message: `Canonical ${status} message` });
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoice", original.id], original);
    const { result } = renderHook(() => useReconcileStatement(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync({ id: original.id })).rejects.toEqual({ status, message: `Canonical ${status} message` });
    expect(queryClient.getQueryData(["invoice", original.id])).toEqual(original);
    expect(TM.api.get).not.toHaveBeenCalled();
  });

  it("updates COI manual cache only from the returned server compliance and preserves cache on errors", async () => {
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoice", "coi-manual"], { ...makeInvoice("coi-manual", "COI"), compliance: { vendorCode: { value: "EXTRACTED", provenance: "extracted" } } });
    TM.api.patch.mockResolvedValueOnce({ manualValues: { vendorCode: { value: "MANUAL", setBy: "Alex", setAt: "2026-07-30" } }, compliance: { vendorCode: { value: "MANUAL", provenance: "manual" } } });
    const { result } = renderHook(() => useUpdateCoiManualValues(), { wrapper: Wrapper });
    await act(async () => { await result.current.mutateAsync({ id: "coi-manual", payload: { vendorCode: "MANUAL" } }); });
    expect(TM.api.patch).toHaveBeenCalledWith("/api/invoices/coi-manual/coi-manual-values", { vendorCode: "MANUAL" });
    expect(queryClient.getQueryData<{ compliance: { vendorCode: { value: string } } }>(["invoice", "coi-manual"])?.compliance.vendorCode.value).toBe("MANUAL");
    TM.api.patch.mockRejectedValueOnce(Object.assign(new Error("Vendor master is unavailable"), { status: 503 }));
    await expect(result.current.mutateAsync({ id: "coi-manual", payload: { vendorCode: null } })).rejects.toThrow("Vendor master is unavailable");
    expect(queryClient.getQueryData<{ compliance: { vendorCode: { value: string } } }>(["invoice", "coi-manual"])?.compliance.vendorCode.value).toBe("MANUAL");
  });
  it("attaches a file as multipart and refreshes the processed document state", async () => {
    TM.api.postForm.mockResolvedValueOnce({
      success: true,
      documentId: "doc-link-only",
      classification: "invoice",
      flagged: false,
      notes: null,
      emailAttached: true,
      extracted: { vendorName: "Skynova Vendor" },
      matching: null,
    });
    const file = new File(["pdf"], "invoice.pdf", { type: "application/pdf" });
    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useAttachFile(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ invoiceId: "doc-link-only", file });
    });

    expect(TM.api.postForm).toHaveBeenCalledTimes(1);
    const [path, body] = TM.api.postForm.mock.calls[0] as [string, FormData];
    expect(path).toBe("/api/invoices/doc-link-only/attach-file");
    expect(body.get("file")).toBe(file);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice", "doc-link-only"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoices"], refetchType: "none" });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["audit", "doc-link-only"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoiceActions", "doc-link-only"] });
  });

  // ── Waiver mutations re-fetch the approval verdict (QA 4.13, Cause 2) ─────────
  // The verdict query key fingerprint carries NO waiver fields, so a waiver
  // change does not refetch the verdict on its own. Each waiver mutation must
  // invalidate ["validate-approval", invoiceId] on success (prefix key → every
  // fingerprint), otherwise Approve keeps showing a stale "Lien Waiver is
  // required" blocker (or stays wrongly enabled after a revert) until a hard
  // refresh. Sabotage check: drop the invalidate line from any one mutation and
  // its case below goes red.
  it("useLinkWaiver invalidates the approval verdict on success", async () => {
    TM.api.post.mockResolvedValueOnce({});
    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useLinkWaiver(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ invoiceId: "inv-wv", waiverId: "wv-1" });
    });

    expect(TM.api.post).toHaveBeenCalledWith("/api/invoices/inv-wv/link-waiver", { waiverId: "wv-1" });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice", "inv-wv"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice", "wv-1"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice-neighbors"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["stats"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["trash"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice-orphan-waivers", "inv-wv"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["lien-waiver-orphan-invoices", "wv-1"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["validate-approval", "inv-wv"] });
  });

  it("keeps waiver invalidation on the GET verdict-refetch path", async () => {
    const invoice = makeInvoice("inv-wv", "Waiver Vendor");
    const key = approvalVerdictQueryKey(invoice);
    const initialVerdict = {
      path: "1" as const,
      requiredFields: [], blockers: ["Lien Waiver is required."], unbilledBalance: null,
      asOf: "2026-07-28T00:00:00.000Z",
      codingDefaults: { glAccount: "5450", costType: "S", phaseCode: null, routingCode: "D", glDate: null },
      suggestedRoutingCode: null, suggestedRoutingPm: null,
    };
    const refreshedVerdict = { ...initialVerdict, blockers: [] };
    TM.api.post.mockResolvedValueOnce({});
    TM.api.get.mockResolvedValueOnce(refreshedVerdict);
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(key, initialVerdict);
    const { result } = renderHook(() => ({
      verdict: useValidateApproval(invoice),
      link: useLinkWaiver(),
    }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.verdict.data).toEqual(initialVerdict));
    await act(async () => {
      await result.current.link.mutateAsync({ invoiceId: "inv-wv", waiverId: "wv-1" });
    });

    await waitFor(() => expect(TM.api.get).toHaveBeenCalledWith("/api/validate-approval/inv-wv"));
    await waitFor(() => expect(result.current.verdict.data).toEqual(refreshedVerdict));
  });

  it("useUnlinkWaiver refreshes the queue, shelf, and approval verdict on success", async () => {
    TM.api.del.mockResolvedValueOnce({});
    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUnlinkWaiver(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ invoiceId: "inv-wv", waiverId: "wv-1" });
    });

    expect(TM.api.del).toHaveBeenCalledWith("/api/invoices/inv-wv/link-waiver");
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice", "inv-wv"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice", "wv-1"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice-neighbors"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["stats"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["trash"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice-orphan-waivers", "inv-wv"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["lien-waiver-orphan-invoices", "wv-1"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["validate-approval", "inv-wv"] });
  });

  it("useSetWaiverOverride invalidates the approval verdict on success", async () => {
    TM.api.post.mockResolvedValueOnce({ invoice: makeInvoice("inv-wv", "Waiver Vendor"), waiverOverride: { active: true, at: null, by: null } });
    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSetWaiverOverride(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ invoiceId: "inv-wv" });
    });

    expect(TM.api.post).toHaveBeenCalledWith("/api/invoices/inv-wv/waiver-override");
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["validate-approval", "inv-wv"] });
  });

  it("useRevertWaiverOverride invalidates the approval verdict on success", async () => {
    TM.api.post.mockResolvedValueOnce({ invoice: makeInvoice("inv-wv", "Waiver Vendor"), waiverOverride: { active: false, at: null, by: null } });
    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRevertWaiverOverride(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ invoiceId: "inv-wv" });
    });

    expect(TM.api.post).toHaveBeenCalledWith("/api/invoices/inv-wv/waiver-override/revert");
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["validate-approval", "inv-wv"] });
  });

  it("flags a document and invalidates lists, detail, and stats", async () => {
    TM.api.post.mockResolvedValueOnce({ invoice: makeInvoice("doc-9", "Vendor"), auditId: "audit-9" });
    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useFlagDocument(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "doc-9", reason: "Duplicate?" });
    });

    expect(TM.api.post).toHaveBeenCalledWith("/api/invoices/doc-9/flag", { reason: "Duplicate?" });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice", "doc-9"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["stats"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["audit", "doc-9"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoiceActions", "doc-9"] });
  });

  it("flags without a reason body when none is given, and unflags via POST", async () => {
    TM.api.post.mockResolvedValueOnce({ invoice: makeInvoice("doc-9", "Vendor"), auditId: null });
    const { Wrapper } = makeMutationWrapper();
    const flag = renderHook(() => useFlagDocument(), { wrapper: Wrapper });
    await act(async () => {
      await flag.result.current.mutateAsync({ id: "doc-9" });
    });
    expect(TM.api.post).toHaveBeenCalledWith("/api/invoices/doc-9/flag", undefined);

    TM.api.post.mockResolvedValueOnce({ invoice: makeInvoice("doc-9", "Vendor") });
    const unflag = renderHook(() => useUnflagDocument(), { wrapper: Wrapper });
    await act(async () => {
      await unflag.result.current.mutateAsync({ id: "doc-9" });
    });
    expect(TM.api.post).toHaveBeenCalledWith("/api/invoices/doc-9/unflag");
  });

  it("optimistically flags the list row, detail, and flaggedCount before the request resolves", async () => {
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoices", { status: "all" }], {
      invoices: [{ ...makeInvoice("doc-1", "Acme"), flaggedAt: null }],
      total: 1, page: 1, limit: 25, pages: 1,
    });
    queryClient.setQueryData(["invoice", "doc-1"], { ...makeInvoice("doc-1", "Acme"), flaggedAt: null });
    queryClient.setQueryData(["stats", { filed: false }], { flaggedCount: 2 });

    let resolvePost: (value: unknown) => void = () => {};
    TM.api.post.mockImplementationOnce(() => new Promise((res) => { resolvePost = res; }));

    const { result } = renderHook(() => useFlagDocument(), { wrapper: Wrapper });
    act(() => { result.current.mutate({ id: "doc-1" }); });

    // Optimistic flip lands BEFORE the request resolves.
    await waitFor(() => {
      const list = queryClient.getQueryData(["invoices", { status: "all" }]) as { invoices: Array<{ flaggedAt: string | null }> };
      expect(list.invoices[0].flaggedAt).toEqual(expect.any(String));
    });
    expect((queryClient.getQueryData(["invoice", "doc-1"]) as { flaggedAt: string | null }).flaggedAt).toEqual(expect.any(String));
    expect((queryClient.getQueryData(["stats", { filed: false }]) as { flaggedCount: number }).flaggedCount).toBe(3);

    await act(async () => { resolvePost({ invoice: makeInvoice("doc-1", "Acme") }); await Promise.resolve(); });
  });

  it("rolls the optimistic unflag back (flag + count restored) when the server refuses (403)", async () => {
    const FLAGGED_AT = "2026-07-01T00:00:00.000Z";
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoices", { status: "all" }], {
      invoices: [{ ...makeInvoice("doc-1", "Acme"), flaggedAt: FLAGGED_AT }],
      total: 1, page: 1, limit: 25, pages: 1,
    });
    queryClient.setQueryData(["stats", { filed: false }], { flaggedCount: 5 });

    let rejectPost: (error: unknown) => void = () => {};
    TM.api.post.mockImplementationOnce(() => new Promise((_res, rej) => { rejectPost = rej; }));

    const { result } = renderHook(() => useUnflagDocument(), { wrapper: Wrapper });
    act(() => { result.current.mutate({ id: "doc-1" }); });

    // Optimistic unflag: flag cleared + count decremented.
    await waitFor(() => {
      const list = queryClient.getQueryData(["invoices", { status: "all" }]) as { invoices: Array<{ flaggedAt: string | null }> };
      expect(list.invoices[0].flaggedAt).toBeNull();
    });
    expect((queryClient.getQueryData(["stats", { filed: false }]) as { flaggedCount: number }).flaggedCount).toBe(4);

    // Server refuses → rollback restores the flag and the count.
    await act(async () => { rejectPost({ status: 403, message: "forbidden" }); await Promise.resolve(); });
    await waitFor(() => {
      const list = queryClient.getQueryData(["invoices", { status: "all" }]) as { invoices: Array<{ flaggedAt: string | null }> };
      expect(list.invoices[0].flaggedAt).toBe(FLAGGED_AT);
    });
    expect((queryClient.getQueryData(["stats", { filed: false }]) as { flaggedCount: number }).flaggedCount).toBe(5);
  });

  it("removes the row from the Flagged view immediately on unflag and re-inserts it on rollback", async () => {
    const FLAGGED_AT = "2026-07-01T00:00:00.000Z";
    const flaggedKey = ["invoices", { flagged: true }];
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(flaggedKey, {
      invoices: [{ ...makeInvoice("doc-1", "Acme"), flaggedAt: FLAGGED_AT }],
      total: 1, page: 1, limit: 25, pages: 1,
    });

    let rejectPost: (error: unknown) => void = () => {};
    TM.api.post.mockImplementationOnce(() => new Promise((_res, rej) => { rejectPost = rej; }));

    const { result } = renderHook(() => useUnflagDocument(), { wrapper: Wrapper });
    act(() => { result.current.mutate({ id: "doc-1" }); });

    await waitFor(() => {
      const list = queryClient.getQueryData(flaggedKey) as { invoices: unknown[]; total: number };
      expect(list.invoices).toHaveLength(0);
      expect(list.total).toBe(0);
    });

    await act(async () => { rejectPost({ status: 403, message: "forbidden" }); await Promise.resolve(); });
    await waitFor(() => {
      const list = queryClient.getQueryData(flaggedKey) as { invoices: Array<{ id: string }>; total: number };
      expect(list.invoices.map((row) => row.id)).toEqual(["doc-1"]);
      expect(list.total).toBe(1);
    });
  });

  it("seeds the saved detail and exact server verdict without a follow-up GET", async () => {
    const invoice = Object.assign(makeInvoice("inv-edit", "Edited Vendor"), {
      gl_account: "5450",
      gl_date: "2026-07-20",
    });
    const approvalVerdict = {
      path: "1" as const,
      requiredFields: [],
      blockers: [],
      unbilledBalance: 500,
      asOf: "2026-07-28T00:00:00.000Z",
      codingDefaults: { glAccount: "5450", costType: "S", phaseCode: null, routingCode: "D", glDate: "2026-07-20" },
      suggestedRoutingCode: null,
      suggestedRoutingPm: null,
    };
    TM.api.patch.mockResolvedValueOnce({
      invoice,
      action: { actionId: "edit-action", type: "edit", undoable: false },
      approvalVerdict,
    });

    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result, rerender } = renderHook(
      ({ currentInvoice }: { currentInvoice: typeof invoice | undefined }) => ({
        update: useUpdateInvoice(),
        verdict: useValidateApproval(currentInvoice),
      }),
      { wrapper: Wrapper, initialProps: { currentInvoice: undefined as typeof invoice | undefined } },
    );

    await act(async () => {
      await result.current.update.mutateAsync({ id: "inv-edit", payload: { vendorCode: "EDIT01" } });
    });

    rerender({ currentInvoice: invoice });
    await waitFor(() => expect(result.current.verdict.data).toEqual(approvalVerdict));

    expect(queryClient.getQueryData(["invoice", "inv-edit"])).toEqual(invoice);
    expect(queryClient.getQueryData(approvalVerdictQueryKey(invoice))).toEqual(approvalVerdict);
    expect(TM.api.get).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoice", "inv-edit"] });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["invoices"],
      refetchType: "none",
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoice-neighbors"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["stats"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["trash"] });
  });

  it("approves once from the PATCH-seeded verdict without a validate-approval GET", async () => {
    const initialInvoice = makeInvoice("inv-seeded", "Before Save");
    const savedInvoice = Object.assign(makeInvoice("inv-seeded", "After Save"), { gl_account: "5450" });
    const verdict = {
      path: "1" as const, requiredFields: [], blockers: [], unbilledBalance: null,
      asOf: "2026-07-28T00:00:00.000Z",
      codingDefaults: { glAccount: "5450", costType: "S", phaseCode: null, routingCode: "D", glDate: null },
      suggestedRoutingCode: null, suggestedRoutingPm: null,
    };
    TM.api.patch.mockResolvedValueOnce({
      invoice: savedInvoice,
      action: { actionId: "save-action", type: "edit", undoable: false },
      approvalVerdict: verdict,
    });
    TM.api.get.mockResolvedValueOnce(verdict);
    TM.api.post.mockResolvedValueOnce({ invoice: savedInvoice, action: { actionId: "approve-action", type: "approve", undoable: true } });
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(approvalVerdictQueryKey(initialInvoice), verdict);

    function Harness() {
      const [invoice, setInvoice] = React.useState(initialInvoice);
      const update = useUpdateInvoice();
      const formRef: React.RefObject<InvoiceDetailFormHandle | null> = { current: {
        hasEdits: true,
        isSaving: false,
        triggerSave: (onSuccess) => {
          update.mutate({ id: invoice.id, payload: { vendorName: "After Save" } }, {
            onSuccess: () => {
              setInvoice(savedInvoice);
              setTimeout(() => onSuccess?.(), 0);
            },
          });
        },
        getApprovalPreview: () => ({ invoiceNumber: "", amount: 0, invoiceDate: "", vendorCode: "", jobNumber: "", subcontractNumber: "" }),
        getPendingPayload: () => ({}),
        notes: "",
        notesDirty: false,
        setNotes: () => undefined,
      } };
      return React.createElement(InvoiceActionBar, {
        invoiceId: invoice.id, invoice, classification: "invoice", formRef,
        hasUnsavedChanges: true,
      });
    }

    render(React.createElement(Harness), { wrapper: Wrapper });
    await userEvent.setup().click(screen.getByRole("button", { name: /save & approve/i }));

    await waitFor(() => expect(TM.api.post).toHaveBeenCalledWith("/api/invoices/inv-seeded/approve", expect.any(Object)));
    expect(TM.api.post).toHaveBeenCalledTimes(1);
    expect(TM.api.get).not.toHaveBeenCalledWith("/api/validate-approval/inv-seeded");
  });

  // ── F1a: surface every non-2xx PATCH via a toast (scoped) ──────────────────
  it("surfaces a failed invoice PATCH via toast.error with the server message (F1a)", async () => {
    const err = { status: 409, message: "Invoice is financially locked.", code: "SUBMITTED_FINANCIAL_LOCKED" };
    TM.api.patch.mockRejectedValueOnce(err);
    const { Wrapper } = makeMutationWrapper();
    const { result } = renderHook(() => useUpdateInvoice(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "inv-edit", payload: { amount: 5 } }).catch(() => {});
    });

    expect(TM.toast.error).toHaveBeenCalledTimes(1);
    expect(TM.toast.error).toHaveBeenCalledWith("Invoice is financially locked.", expect.any(Object));
  });

  it("suppresses the error toast on the document-panel path (suppressErrorToast) — no double-toast (F1a)", async () => {
    const err = { status: 409, message: "Invoice is financially locked.", code: "X" };
    TM.api.patch.mockRejectedValueOnce(err);
    const { Wrapper } = makeMutationWrapper();
    const { result } = renderHook(() => useUpdateInvoice(), { wrapper: Wrapper });

    await act(async () => {
      await result.current
        .mutateAsync({ id: "inv-edit", payload: { amount: 5 }, suppressErrorToast: true })
        .catch(() => {});
    });

    expect(TM.toast.error).not.toHaveBeenCalled();
  });

  it("refreshes all membership caches after approval", async () => {
    TM.api.post.mockResolvedValueOnce({
      invoice: makeInvoice("inv-approve", "Approve Vendor"),
      action: { actionId: "approve-action", type: "approve", undoable: true },
    });

    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useApproveInvoice(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "inv-approve" });
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice", "inv-approve"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice-neighbors"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["stats"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["trash"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice-orphan-waivers"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["lien-waiver-orphan-invoices"] });
  });

  it("refreshes orphan namespaces after unapproval", async () => {
    TM.api.post.mockResolvedValueOnce(makeInvoice("inv-unapprove", "Unapprove Vendor"));
    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUnapproveInvoice(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "inv-unapprove" });
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice-orphan-waivers"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["lien-waiver-orphan-invoices"] });
  });

  it("keeps successful state mutations and invalidation without duplicate browser audit emission", async () => {
    TM.api.post
      .mockResolvedValueOnce({ invoice: makeInvoice("inv-1", "Acme"), action: { actionId: "approve-action", type: "approve", undoable: true } })
      .mockResolvedValueOnce(makeInvoice("inv-2", "Beta"))
      .mockResolvedValueOnce({ restored: true, id: "inv-4", status: "pending" });
    TM.api.del
      .mockResolvedValueOnce({ deleted: true, id: "inv-3" })
      .mockResolvedValueOnce({ deleted: true, permanent: true, id: "inv-5" });

    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const approveHook = renderHook(() => useApproveInvoice(), { wrapper: Wrapper });
    const rejectHook = renderHook(() => useRejectInvoice(), { wrapper: Wrapper });
    const deleteHook = renderHook(() => useDeleteInvoice(), { wrapper: Wrapper });
    const restoreHook = renderHook(() => useRestoreInvoice(), { wrapper: Wrapper });
    const permanentDeleteHook = renderHook(() => usePermanentDelete(), { wrapper: Wrapper });

    await act(async () => {
      await approveHook.result.current.mutateAsync({ id: "inv-1" });
      await rejectHook.result.current.mutateAsync({ id: "inv-2", reason: "Missing backup" });
      await deleteHook.result.current.mutateAsync({ id: "inv-3" });
      await restoreHook.result.current.mutateAsync({ id: "inv-4" });
      await permanentDeleteHook.result.current.mutateAsync({ id: "inv-5" });
    });

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["stats"] }));
    expect(TM.emitAuditEvent).not.toHaveBeenCalled();
  });

  it("emits Spectrum submission and split-created audit events for successful targets", async () => {
    TM.api.post
      .mockResolvedValueOnce({
        success: true,
        submitted: 1,
        message: "Submitted",
        results: [
          { id: "inv-10", success: true, invoiceNumber: "1001" },
          { id: "inv-failed", success: false, error: "Rejected" },
        ],
      })
      .mockResolvedValueOnce({
        parentId: "split-parent",
        childIds: ["split-child-1", "split-child-2"],
        discardedPages: [],
        status: "split",
        message: "Split confirmed",
      });

    const { Wrapper } = makeMutationWrapper();
    const submitHook = renderHook(() => useSubmitToSpectrum(), { wrapper: Wrapper });
    const splitHook = renderHook(() => useConfirmSplit(), { wrapper: Wrapper });

    await act(async () => {
      await submitHook.result.current.mutateAsync({ ids: ["inv-10", "inv-failed"] });
      await splitHook.result.current.mutateAsync({
        id: "split-parent",
        payload: { groups: [], discardPages: [] },
      });
    });

    expect(TM.emitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "invoice.submitted_spectrum",
      target: expect.objectContaining({ type: "invoice", id: "inv-10", label: "1001" }),
    }));
    expect(TM.emitAuditEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({ id: "inv-failed" }),
    }));
    expect(TM.emitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "invoice.split_created",
      target: expect.objectContaining({ type: "invoice", id: "split-child-1" }),
    }));
    expect(TM.emitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "invoice.split_created",
      target: expect.objectContaining({ type: "invoice", id: "split-child-2" }),
    }));
  });

  it("does not emit audit events when a mutation fails", async () => {
    TM.api.post.mockRejectedValueOnce(new Error("offline"));

    const { Wrapper } = makeMutationWrapper();
    const { result } = renderHook(() => useApproveInvoice(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ id: "inv-1" })).rejects.toThrow("offline");
    });

    expect(TM.emitAuditEvent).not.toHaveBeenCalled();
  });

  it("invalidates invoices, stats, and trash after a successful bulk action", async () => {
    TM.api.post.mockResolvedValueOnce({ success: true, updated: 1, action: "discard" });

    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useBulkAction(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ ids: ["inv-1"], action: "discard" });
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice-neighbors"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["stats"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["trash"] });
  });

  it("refreshes action history after discarding an invoice", async () => {
    TM.api.post.mockResolvedValueOnce({
      invoice: makeInvoice("doc-discard", "Discard Vendor"),
      action: {
        actionId: "discard-action",
        type: "discard",
        undoable: true,
        undoEndpoint: "/api/invoices/doc-discard/undiscard",
      },
    });

    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDiscardInvoice(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "doc-discard" });
    });

    expect(TM.api.post).toHaveBeenCalledWith("/api/invoices/doc-discard/discard", undefined);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice", "doc-discard"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice-neighbors"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["stats"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["audit", "doc-discard"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoiceActions", "doc-discard"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["trash"] });
  });

  it("posts undo actions and refreshes invoice, list, stats, audit, and action caches", async () => {
    TM.api.post.mockResolvedValueOnce({
      invoice: makeInvoice("doc-undo", "Undo Vendor"),
      undoneActionId: "action-1",
    });

    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUndoInvoiceAction(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "doc-undo", actionId: "action-1" });
    });

    expect(TM.api.post).toHaveBeenCalledWith("/api/invoices/doc-undo/actions/action-1/undo");
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice", "doc-undo"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice-neighbors"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["stats"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["trash"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["audit", "doc-undo"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoiceActions", "doc-undo"] });
  });

  it("adds statement lines through the contracted endpoint and refreshes document caches", async () => {
    TM.api.post.mockResolvedValueOnce({
      invoice: makeInvoice("statement-1", "Statement Vendor"),
      statementLines: [{
        id: "manual-1",
        invoiceNumber: "INV-77",
        date: "2026-06-30",
        amount: 125.5,
        status: "matched",
        source: "manual",
      }],
      addedLine: {
        id: "manual-1",
        invoiceNumber: "INV-77",
        date: "2026-06-30",
        amount: 125.5,
        status: "matched",
        source: "manual",
      },
    });

    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useAddStatementLine(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: "statement-1",
        payload: { invoiceNumber: "INV-77", date: "2026-06-30", amount: 125.5 },
      });
    });

    expect(TM.api.post).toHaveBeenCalledWith("/api/invoices/statement-1/statement-lines", {
      invoiceNumber: "INV-77",
      date: "2026-06-30",
      amount: 125.5,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice", "statement-1"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoice-neighbors"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["stats"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["trash"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["audit", "statement-1"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoiceActions", "statement-1"] });
  });

  it("updates statement lines through the contracted endpoint and refreshes document caches", async () => {
    TM.api.patch.mockResolvedValueOnce({
      invoice: makeInvoice("statement-1", "Statement Vendor"),
      statementLines: [{
        id: "line-1",
        invoiceNumber: "INV-78",
        date: "2026-06-30",
        amount: 125.5,
        status: "matched",
        source: "manual",
      }],
      updatedLine: {
        id: "line-1",
        invoiceNumber: "INV-78",
        date: "2026-06-30",
        amount: 125.5,
        status: "matched",
        source: "manual",
      },
    });

    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateStatementLine(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: "statement-1",
        lineId: "line-1",
        payload: { invoiceNumber: "INV-78" },
      });
    });

    expect(TM.api.patch).toHaveBeenCalledWith("/api/invoices/statement-1/statement-lines/line-1", {
      invoiceNumber: "INV-78",
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice", "statement-1"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoice-neighbors"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["stats"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["trash"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["audit", "statement-1"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoiceActions", "statement-1"] });
  });

  it("deletes statement lines through the contracted endpoint and refreshes document caches", async () => {
    TM.api.del.mockResolvedValueOnce({
      invoice: makeInvoice("statement-1", "Statement Vendor"),
      statementLines: [],
      removedLine: {
        id: "line-1",
        invoiceNumber: "INV-77",
        date: "2026-06-30",
        amount: 125.5,
        status: "not_received",
        source: "manual",
      },
    });

    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteStatementLine(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: "statement-1",
        lineId: "line-1",
      });
    });

    expect(TM.api.del).toHaveBeenCalledWith("/api/invoices/statement-1/statement-lines/line-1");
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice", "statement-1"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoice-neighbors"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["stats"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["trash"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["audit", "statement-1"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoiceActions", "statement-1"] });
  });

  it("seeds the exact rematch invoice without a recovery GET", async () => {
    const canonicalInvoice = Object.assign(makeInvoice("statement-1", "Statement Vendor"), {
      statementLines: [{
        id: "line-1",
        invoiceNumber: "INV-77",
        date: "2026-06-30",
        amount: 125.5,
        status: "matched",
        source: "manual",
      }],
    });
    TM.api.post.mockResolvedValueOnce({
      invoice: canonicalInvoice,
      statementLines: [{
        id: "line-1",
        invoiceNumber: "INV-77",
        date: "2026-06-30",
        amount: 125.5,
        status: "matched",
        source: "manual",
      }],
      statusChanges: [{
        lineId: "line-1",
        invoiceNumber: "INV-77",
        status: ["not_received", "matched"],
      }],
    });

    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoice", "statement-1"], makeInvoice("statement-1", "Before rematch"));
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRematchStatementLines(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "statement-1" });
    });

    expect(TM.api.post).toHaveBeenCalledWith("/api/invoices/statement-1/statement-lines/rematch");
    expect(queryClient.getQueryData(["invoice", "statement-1"])).toEqual(canonicalInvoice);
    expect(TM.api.get).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoice", "statement-1"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoice-neighbors"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["stats"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["trash"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["audit", "statement-1"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoiceActions", "statement-1"] });
  });

  it("persists and removes statement line resolutions through canonical endpoints", async () => {
    TM.api.post.mockResolvedValue({
      invoice: makeInvoice("statement-1", "Statement Vendor"),
      statementLines: [],
      updatedLine: { id: "line-1" },
    });
    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const resolve = renderHook(() => useResolveStatementLine(), { wrapper: Wrapper });
    const unresolve = renderHook(() => useUnresolveStatementLine(), { wrapper: Wrapper });

    await act(async () => {
      await resolve.result.current.mutateAsync({ id: "statement-1", lineId: "line-1", payload: { resolutionType: "accept_line" } });
      await unresolve.result.current.mutateAsync({ id: "statement-1", lineId: "line-1" });
    });

    expect(TM.api.post).toHaveBeenNthCalledWith(1, "/api/invoices/statement-1/statement-lines/line-1/resolve", { resolutionType: "accept_line" });
    expect(TM.api.post).toHaveBeenNthCalledWith(2, "/api/invoices/statement-1/statement-lines/line-1/unresolve");
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice", "statement-1"] });
  });

  it("queues COI uploads through the contracted Spectrum endpoint and refreshes document caches", async () => {
    TM.api.post.mockResolvedValueOnce({
      status: "queued",
      documentId: "coi-2028",
      vendorCode: "HALD01",
      expirationDate: "2027-07-04",
      attempt: 1,
      queuePosition: 0,
      message: "COI upload queued.",
    });

    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUploadCoiToSpectrum(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: "coi-2028",
        payload: { vendorCode: "HALD01", expirationDate: "2027-07-04" },
      });
    });

    expect(TM.api.post).toHaveBeenCalledWith("/api/documents/coi-2028/upload-to-spectrum", {
      vendorCode: "HALD01",
      expirationDate: "2027-07-04",
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice", "coi-2028"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice-neighbors"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["stats"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["trash"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["audit", "coi-2028"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoiceActions", "coi-2028"] });
  });

  it("applies server-returned compliance with POST and DELETE override cache updates", async () => {
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoice", "coi-1"], { ...makeInvoice("coi-1", "COI"), classification: "coi", coiOverrides: [] });
    const override = { id: "override-1", documentId: "coi-1", checkId: "certificate-holder", originalStatus: "warn" as const, reason: null, configVersionId: "v1", approvedBy: "leader", approvedAt: "2026-07-30T00:00:00Z", revokedBy: null, revokedAt: null };
    const appliedCompliance = { verdict: "compliant", evaluatedAt: "2026-07-30T00:00:00Z", configVersion: "v1", configVersionId: "v1", checks: [], coverageFailures: [], coverageExceptions: [], expiration: {}, vendorCode: {}, blockers: [], uploadReady: true };
    const revokedCompliance = { ...appliedCompliance, verdict: "non-compliant", uploadReady: false };
    TM.api.post.mockResolvedValueOnce({ override, activeOverrides: [override], compliance: appliedCompliance });
    TM.api.del.mockResolvedValueOnce({ revokedOverride: override, activeOverrides: [], compliance: revokedCompliance });
    const apply = renderHook(() => useApplyCoiOverride(), { wrapper: Wrapper });
    const revoke = renderHook(() => useRevokeCoiOverride(), { wrapper: Wrapper });
    await act(async () => { await apply.result.current.mutateAsync({ id: "coi-1", payload: { checkId: "certificate-holder" } }); });
    expect(queryClient.getQueryData<{ coiOverrides: unknown[] }>(["invoice", "coi-1"])?.coiOverrides).toEqual([override]);
    expect(queryClient.getQueryData<{ compliance: unknown }>(["invoice", "coi-1"])?.compliance).toEqual(appliedCompliance);
    await act(async () => { await revoke.result.current.mutateAsync({ id: "coi-1", checkId: "certificate-holder" }); });
    expect(TM.api.del).toHaveBeenCalledWith("/api/invoices/coi-1/coi-overrides/certificate-holder");
    expect(queryClient.getQueryData<{ coiOverrides: unknown[] }>(["invoice", "coi-1"])?.coiOverrides).toEqual([]);
    expect(queryClient.getQueryData<{ compliance: unknown }>(["invoice", "coi-1"])?.compliance).toEqual(revokedCompliance);
  });

  it("keeps persisted COI detail state unchanged when the real POST rejects with a literal 403", async () => {
    const { queryClient, Wrapper } = makeMutationWrapper();
    const existing = [{ id: "persisted", checkId: "certificate-holder" }];
    queryClient.setQueryData(["invoice", "coi-403"], { ...makeInvoice("coi-403", "COI"), classification: "coi", coiOverrides: existing });
    TM.api.post.mockRejectedValueOnce({ status: 403, message: "COI override permission is required" });
    const apply = renderHook(() => useApplyCoiOverride(), { wrapper: Wrapper });
    await expect(apply.result.current.mutateAsync({ id: "coi-403", payload: { checkId: "additional-insured" } })).rejects.toMatchObject({ message: "COI override permission is required" });
    expect(queryClient.getQueryData<{ coiOverrides: unknown[] }>(["invoice", "coi-403"])?.coiOverrides).toEqual(existing);
  });

  it("posts waiver override set and revert actions through the contracted endpoints", async () => {
    TM.api.post
      .mockResolvedValueOnce({
        invoice: makeInvoice("doc-waiver", "Waiver Vendor"),
        action: { actionId: "waiver-set", type: "waiver_override", undoable: true },
        waiverOverride: { active: true, at: "2026-07-03T12:00:00.000Z", by: "Alex Admin" },
      })
      .mockResolvedValueOnce({
        invoice: makeInvoice("doc-waiver", "Waiver Vendor"),
        action: { actionId: "waiver-revert", type: "waiver_override", undoable: true },
        waiverOverride: { active: false, at: null, by: null },
      });

    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const setHook = renderHook(() => useSetWaiverOverride(), { wrapper: Wrapper });
    const revertHook = renderHook(() => useRevertWaiverOverride(), { wrapper: Wrapper });

    await act(async () => {
      await setHook.result.current.mutateAsync({ invoiceId: "doc-waiver" });
      await revertHook.result.current.mutateAsync({ invoiceId: "doc-waiver" });
    });

    expect(TM.api.post).toHaveBeenNthCalledWith(1, "/api/invoices/doc-waiver/waiver-override");
    expect(TM.api.post).toHaveBeenNthCalledWith(2, "/api/invoices/doc-waiver/waiver-override/revert");
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoice", "doc-waiver"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoice-neighbors"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["stats"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["trash"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["audit", "doc-waiver"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoiceActions", "doc-waiver"] });
  });

  it("requests a waiver and replaces the exact cached document with the canonical response", async () => {
    const invoice = {
      ...makeInvoice("doc-waiver", "Waiver Vendor"),
      waiverRequestedAt: "2026-07-14T12:00:00.000Z",
      waiverActions: {
        request: { permitted: false, blockers: [{ code: "WAIVER_REQUEST_ALREADY_SENT", message: "already sent" }] },
        resend: { permitted: true, blockers: [] },
        markOnDocument: { permitted: true, blockers: [] },
        clearOnDocument: { permitted: false, blockers: [{ code: "WAIVER_NOT_ON_DOCUMENT", message: "not marked" }] },
        bypass: { permitted: true, blockers: [] },
        revertBypass: { permitted: false, blockers: [{ code: "WAIVER_ALREADY_REQUIRED", message: "required" }] },
        bypassHint: { count: 0, show: false },
      },
    };
    TM.api.post.mockResolvedValueOnce({
      success: true,
      sentTo: "vendor@example.com",
      requestedAt: "2026-07-14T12:00:00.000Z",
      invoice,
    });

    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoice", "doc-waiver"], makeInvoice("doc-waiver", "Stale invoice"));
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRequestWaiver(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ invoiceId: "doc-waiver" });
    });

    expect(TM.api.post).toHaveBeenCalledWith("/api/invoices/doc-waiver/request-waiver");
    expect(queryClient.getQueryData(["invoice", "doc-waiver"])).toEqual(invoice);
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoice", "doc-waiver"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["audit", "doc-waiver"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoiceActions", "doc-waiver"] });
  });

  it("explicitly opts in when resending a waiver request", async () => {
    TM.api.post.mockResolvedValueOnce({
      success: true,
      sentTo: "vendor@example.com",
      requestedAt: "2026-07-14T13:00:00.000Z",
      invoice: makeInvoice("doc-waiver", "Waiver Vendor"),
    });

    const { Wrapper } = makeMutationWrapper();
    const { result } = renderHook(() => useRequestWaiver(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ invoiceId: "doc-waiver", resend: true });
    });

    expect(TM.api.post).toHaveBeenCalledWith(
      "/api/invoices/doc-waiver/request-waiver",
      { resend: true },
    );
  });

  it("keeps the cached invoice unchanged when a waiver request fails", async () => {
    const existing = {
      ...makeInvoice("doc-waiver", "Persisted waiver state"),
      waiverActions: {
        request: { permitted: true, blockers: [] },
        resend: { permitted: false, blockers: [{ code: "WAIVER_REQUEST_NOT_SENT", message: "not sent" }] },
        markOnDocument: { permitted: true, blockers: [] },
        clearOnDocument: { permitted: false, blockers: [{ code: "WAIVER_NOT_ON_DOCUMENT", message: "not marked" }] },
        bypass: { permitted: true, blockers: [] },
        revertBypass: { permitted: false, blockers: [{ code: "WAIVER_ALREADY_REQUIRED", message: "required" }] },
        bypassHint: { count: 0, show: false },
      },
    };
    TM.api.post.mockRejectedValueOnce({ status: 409, message: "A waiver request was already sent" });

    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoice", "doc-waiver"], existing);
    const { result } = renderHook(() => useRequestWaiver(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync({ invoiceId: "doc-waiver" })).rejects.toMatchObject({
      message: "A waiver request was already sent",
    });

    expect(queryClient.getQueryData(["invoice", "doc-waiver"])).toEqual(existing);
  });

  it("passes a confirmed recipient override and invalidates its cached resolution", async () => {
    TM.api.post.mockResolvedValueOnce({
      success: true,
      sentTo: "ap@vendor.test",
      requestedAt: "2026-07-14T13:00:00.000Z",
      invoice: makeInvoice("doc-waiver", "Waiver Vendor"),
    });

    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRequestWaiver(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        invoiceId: "doc-waiver",
        resend: true,
        recipientOverride: "ap@vendor.test",
      });
    });

    expect(TM.api.post).toHaveBeenCalledWith(
      "/api/invoices/doc-waiver/request-waiver",
      { resend: true, recipientOverride: "ap@vendor.test" },
    );
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["waiverRecipient", "doc-waiver"] });
  });

  it("posts the strict contact body and replaces the recipient directory from the response", async () => {
    const initial: WaiverRecipientResponse = {
      recipientType: "manual",
      directEmail: null,
      candidates: [],
      cachedVendorEmail: null,
      emailFrom: "forward@example.com",
      reason: "Internal forward",
      directoryContacts: [{ email: "old@vendor.test", name: "Old", source: "observed", lastSeenAt: null }],
    };
    const authoritative = [{ email: "new@vendor.test", name: "New", source: "manual" as const, lastSeenAt: null }];
    TM.api.post.mockResolvedValueOnce({ success: true, directoryContacts: authoritative });

    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(waiverRecipientQueryKey("doc-contact"), initial);
    const { result } = renderHook(() => useAddWaiverContact(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ invoiceId: "doc-contact", email: "  new@vendor.test  ", name: "   " });
    });

    expect(TM.api.post).toHaveBeenCalledWith(
      "/api/invoices/doc-contact/waiver-contacts",
      { email: "new@vendor.test" },
    );
    expect(queryClient.getQueryData<WaiverRecipientResponse>(waiverRecipientQueryKey("doc-contact"))?.directoryContacts)
      .toEqual(authoritative);
  });

  it("posts reversible waiver bypass actions and replaces the canonical detail cache", async () => {
    const original = { ...makeInvoice("doc-bypass", "Bypass Vendor"), waiverActions: waiverActions() };
    const bypassed = {
      ...original,
      lienWaiverRequired: false,
      waiverActions: {
        ...original.waiverActions,
        bypass: { permitted: false, blockers: [{ code: "WAIVER_BYPASSED", message: "This waiver has already been bypassed." }] },
      },
    };
    const restored = { ...original, lienWaiverRequired: true, waiverActions: waiverActions() };
    TM.api.post.mockResolvedValueOnce({ invoice: bypassed }).mockResolvedValueOnce({ invoice: restored });
    const { queryClient, Wrapper } = makeMutationWrapper();
    queryClient.setQueryData(["invoice", original.id], original);
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const setHook = renderHook(() => useSetWaiverBypass(), { wrapper: Wrapper });
    const revertHook = renderHook(() => useRevertWaiverBypass(), { wrapper: Wrapper });

    await act(async () => { await setHook.result.current.mutateAsync({ invoiceId: original.id }); });
    expect(TM.api.post).toHaveBeenLastCalledWith(`/api/invoices/${original.id}/waiver-bypass`);
    expect(queryClient.getQueryData(["invoice", original.id])).toEqual(bypassed);

    await act(async () => { await revertHook.result.current.mutateAsync({ invoiceId: original.id }); });
    expect(TM.api.post).toHaveBeenLastCalledWith(`/api/invoices/${original.id}/waiver-bypass/revert`);
    expect(queryClient.getQueryData(["invoice", original.id])).toEqual(restored);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["validate-approval", original.id] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["invoice", original.id] });
  });
});

describe("classification mutations", () => {
  it("creates classifications and invalidates the classifications query", async () => {
    const classification = {
      name: "custom-doc",
      label: "Custom Doc",
      opensAs: "other",
      action: "view-only",
      builtIn: false,
      status: "active",
    };
    const payload = {
      name: "custom-doc",
      label: "Custom Doc",
      opensAs: "other",
    };
    TM.api.post.mockResolvedValueOnce(classification);

    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateClassification(), { wrapper: Wrapper });

    let response: unknown;
    await act(async () => {
      response = await result.current.mutateAsync(payload);
    });

    expect(TM.api.post).toHaveBeenCalledWith("/api/classifications", payload);
    expect(response).toEqual(classification);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["classifications"] });
  });

  it("batch-updates classifications and invalidates the classifications query", async () => {
    const payload = {
      updates: [
        {
          name: "custom-doc",
          label: "Custom Document",
          opensAs: "receipt",
          status: "active" as const,
        },
      ],
    };
    const updateResponse = {
      classifications: [
        {
          name: "custom-doc",
          label: "Custom Document",
          opensAs: "receipt",
          action: "view-only",
          builtIn: false,
          status: "active",
        },
      ],
    };
    TM.api.put.mockResolvedValueOnce(updateResponse);

    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateClassifications(), { wrapper: Wrapper });

    let response: unknown;
    await act(async () => {
      response = await result.current.mutateAsync(payload);
    });

    expect(TM.api.put).toHaveBeenCalledWith("/api/classifications", payload);
    expect(response).toEqual(updateResponse);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["classifications"] });
  });

  it("deletes classifications by name and invalidates the classifications query", async () => {
    const deleteResponse = { deleted: "custom-doc" };
    TM.api.del.mockResolvedValueOnce(deleteResponse);

    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteClassification(), { wrapper: Wrapper });

    let response: unknown;
    await act(async () => {
      response = await result.current.mutateAsync({ name: "custom-doc" });
    });

    expect(TM.api.del).toHaveBeenCalledWith("/api/classifications/custom-doc");
    expect(response).toEqual(deleteResponse);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["classifications"] });
  });

  it("preserves backend 409 messages when classification mutations fail", async () => {
    const duplicateError = { message: "Classification name already exists", status: 409 };
    const documentsExistError = { message: "Cannot delete classification with existing documents", status: 409 };
    TM.api.post.mockRejectedValueOnce(duplicateError);
    TM.api.del.mockRejectedValueOnce(documentsExistError);

    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const createHook = renderHook(() => useCreateClassification(), { wrapper: Wrapper });
    const deleteHook = renderHook(() => useDeleteClassification(), { wrapper: Wrapper });

    await act(async () => {
      await expect(createHook.result.current.mutateAsync({
        name: "custom-doc",
        label: "Custom Doc",
        opensAs: "other",
      })).rejects.toMatchObject(duplicateError);
      await expect(deleteHook.result.current.mutateAsync({ name: "custom-doc" }))
        .rejects.toMatchObject(documentsExistError);
    });

    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["classifications"] });
  });
});
