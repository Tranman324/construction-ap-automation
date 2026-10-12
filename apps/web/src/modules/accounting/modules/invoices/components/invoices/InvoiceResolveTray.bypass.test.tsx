import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DuplicateStatusResponse } from "@/modules/accounting/modules/invoices/types/api";
import { makeMutationWrapper } from "@/modules/accounting/modules/invoices/hooks/mutations.testUtils";
import { APPR, DEL, F_TBX, makeInvoice } from "./duplicateCardFixtures.testUtils";
import { InvoiceResolveTray } from "./InvoiceResolveTray";
import { getInvoiceResolveRows } from "./invoiceResolveModel";
import { useDuplicateCardActions } from "./useDuplicateCardActions";

// The real useDuplicateBypass and a real QueryClient; only the HTTP client is mocked (F1: outcome and in-flight state).
const m = vi.hoisted(() => ({ post: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/modules/shared/lib/api", () => ({
  api: { post: m.post, get: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn(), postForm: vi.fn() },
  isApiError: (e: unknown): boolean => typeof e === "object" && e !== null && "status" in e && "message" in e,
}));
vi.mock("@/modules/shared/components/ui/toaster", () => ({ toast: { success: m.success, error: m.error } }));
vi.mock("@/modules/shared/lib/auditEmitter", () => ({ emitAuditEvent: vi.fn() }));
vi.mock("@/modules/shared/lib/auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/modules/shared/hooks/usePermissions", () => ({ usePermissions: () => ({ hasAnyPermission: (keys: string[]) => keys.some((k) => k === DEL || k === APPR) }) }));

const invoice = makeInvoice({ id: "invoice-1", duplicateOf: "orig-1" });
const NONE: DuplicateStatusResponse = { ...F_TBX, state: "none", original: null, evidence: null };
const tray = (status: DuplicateStatusResponse) => (
  <InvoiceResolveTray invoice={invoice} rows={getInvoiceResolveRows(invoice, null, status)} duplicateStatus={status} discardPending={false} onDiscard={vi.fn()} />
);
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function setup() {
  const { Wrapper } = makeMutationWrapper();
  return render(tray(F_TBX), { wrapper: Wrapper });
}
const bypass = () => {
  fireEvent.click(screen.getByRole("button", { name: "Bypass" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm bypass" }));
};
/** TanStack starts mutationFn and settles callbacks on later microtasks. */
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => { m.post.mockReset(); m.success.mockReset(); m.error.mockReset(); });
afterEach(() => vi.useRealTimers());

describe("duplicate bypass outcome and in-flight guard (F1)", () => {
  it("FIX62-1 shows the error toast with the server message when the bypass is rejected", async () => {
    m.post.mockRejectedValueOnce(new Error("Approver required"));
    setup();
    bypass();
    await flush();
    expect(m.error).toHaveBeenCalledWith("Could not bypass duplicate flag", { description: "Approver required" });
    expect(m.success).not.toHaveBeenCalled();
  });

  it("FIX62-2 still reports the outcome after the controller unmounts mid-request (error and success)", async () => {
    const failing = deferred();
    m.post.mockReturnValueOnce(failing.promise);
    const view = setup();
    bypass();
    await flush();
    expect(m.post).toHaveBeenCalledTimes(1);
    view.rerender(tray(NONE));
    expect(screen.queryByTestId("duplicate-resolution-card")).toBeNull();
    await act(async () => { failing.reject(new Error("Server down")); });
    expect(m.error).toHaveBeenCalledWith("Could not bypass duplicate flag", { description: "Server down" });

    view.rerender(tray(F_TBX));
    const succeeding = deferred();
    m.post.mockReturnValueOnce(succeeding.promise);
    bypass();
    await flush();
    expect(m.post).toHaveBeenCalledTimes(2);
    view.rerender(tray(NONE));
    await act(async () => { succeeding.resolve({ duplicateBypassed: true }); });
    expect(m.success).toHaveBeenCalledWith("Duplicate flag bypassed");
  });

  it("FIX62-3 keeps Bypass pending after the row goes away and comes back while the POST is in flight", async () => {
    const pending = deferred();
    m.post.mockReturnValueOnce(pending.promise);
    const view = setup();
    bypass();
    await flush();
    view.rerender(tray(NONE));
    view.rerender(tray(F_TBX));
    const button = screen.getByTestId("duplicate-bypass");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Bypassing…");
    fireEvent.click(button);
    await flush();
    expect(m.post).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve({ duplicateBypassed: true }); });
    expect(screen.getByTestId("duplicate-bypass")).toBeEnabled();
  });

  it("FIX62-4 sends one request for a same-tick double click on Confirm bypass", async () => {
    const pending = deferred();
    m.post.mockReturnValue(pending.promise);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Bypass" }));
    const confirm = screen.getByRole("button", { name: "Confirm bypass" });
    act(() => { confirm.click(); confirm.click(); });
    await flush();
    expect(m.post).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve({ duplicateBypassed: true }); });
  });

  it("FIX62-5 the controller itself sends one request for two bypass calls in the same tick", async () => {
    const pending = deferred();
    m.post.mockReturnValue(pending.promise);
    const { Wrapper } = makeMutationWrapper();
    const { result } = renderHook(() => useDuplicateCardActions({ invoiceId: "invoice-1", model: null, onDiscard: vi.fn() }), { wrapper: Wrapper });
    act(() => { result.current.onAction("bypass"); result.current.onAction("bypass"); });
    await flush();
    expect(m.post).toHaveBeenCalledTimes(1);
    expect(result.current.bypassPending).toBe(true);
    await act(async () => { pending.resolve({ duplicateBypassed: true }); });
    expect(result.current.bypassPending).toBe(false);
  });
});
